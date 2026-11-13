/**
 * `browser_map` engine: list a site's URLs from its sitemap(s), falling back to
 * llms.txt. No crawl, no browser. Every request goes through `fetchFast`, so the
 * SSRF guard applies as on the fast path; only same-origin files are fetched
 * (sitemap index children and robots `Sitemap:` lines on another origin are
 * ignored), and with `respectRobots` (default) URLs the origin's robots.txt
 * disallows are left out.
 * @module agent/map-site
 */
import type { MapOptions, MapResult, MapUrl } from "../interfaces/map.js";
import { type FastResponse, fetchFast } from "../net/fetch-fast.js";
import { PrivateNetworkBlockedError } from "../net/private-net-guard.js";
import { parseRobots, type RobotsMatcher } from "../net/robots.js";
import { pathFilter } from "./map-filter.js";
import { llmsLinks, parseSitemap, robotsSitemaps } from "./map-parse.js";

/** Default `limit`. */
export const DEFAULT_MAP_LIMIT = 1000;

/** Sitemap files fetched per call at most (an index can list thousands). */
export const MAX_SITEMAP_FILES = 50;

/** Product token used to select the robots group. */
const ROBOTS_UA = "fuse-browser";

/** Thrown for an unusable `url` input. */
export class MapInputError extends Error {
  readonly code = "invalid_url";
}

/**
 * Whether robots.txt allows `url`. Fails CLOSED: a path whose percent-escapes cannot be
 * decoded is refused, because `parseRobots` would otherwise fall back to checking "/"
 * and let it past any `Disallow`.
 */
function robotsAllows(matcher: RobotsMatcher, url: string): boolean {
  try {
    decodeURIComponent(new URL(url).pathname);
  } catch {
    return false;
  }
  return matcher.isAllowed(url, ROBOTS_UA);
}

/** GET `url`; the body of a 2xx answer, else null. A blocked private network is re-thrown, any other failure is "not there". */
async function fetchOk(url: string, proxyUrl?: string): Promise<FastResponse | null> {
  try {
    const r = await fetchFast(url, proxyUrl, { gunzip: true });
    return r.status >= 200 && r.status < 300 ? r : null;
  } catch (err) {
    if (err instanceof PrivateNetworkBlockedError) throw err;
    return null;
  }
}

/**
 * Map `url`'s site.
 *
 * @param url - Any http(s) URL of the site (its origin is mapped).
 * @param opts - Path filters, limit, robots handling, proxy.
 * @returns The URLs, their source (`sitemap`, else `llms-txt`), and `truncated` when cut by `limit`.
 * @throws MapInputError for a non-http(s) or malformed `url`; PrivateNetworkBlockedError from the SSRF guard.
 */
export async function mapSite(url: string, opts: MapOptions = {}): Promise<MapResult> {
  let origin: string;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("scheme");
    origin = u.origin;
  } catch {
    throw new MapInputError(`browser_map: "${url}" is not an http(s) URL`);
  }
  const limit = typeof opts.limit === "number" && opts.limit > 0 ? Math.floor(opts.limit) : DEFAULT_MAP_LIMIT;
  const keep = pathFilter(opts.includePaths, opts.excludePaths);
  const sameOrigin = (u: string): boolean => {
    try {
      return new URL(u).origin === origin;
    } catch {
      return false;
    }
  };

  // A site published under a sub-path of a shared host (https://user.github.io/project/) keeps its files there.
  const base = new URL(url).pathname.replace(/\/+$/, "");
  const tried: string[] = [];
  const get = (u: string): Promise<FastResponse | null> => {
    tried.push(u);
    return fetchOk(u, opts.proxyUrl);
  };

  const robots = await get(`${origin}/robots.txt`);
  const matcher = robots && opts.respectRobots !== false ? parseRobots(robots.html) : null;
  const wanted = (u: string): boolean => keep(u) && (!matcher || robotsAllows(matcher, u));

  const seen = new Set<string>();
  const offOrigin = new Set<string>();
  const urls: MapUrl[] = [];
  const add = (entry: MapUrl): void => {
    if (seen.has(entry.url)) return;
    // sitemaps.org: every URL of a Sitemap must be on the Sitemap's own protocol + host (+ port); others are invalid and dropped.
    // Counted, not listed — and never reaches the robots check, which only knows this origin's rules.
    if (!sameOrigin(entry.url)) {
      offOrigin.add(entry.url);
      return;
    }
    if (!wanted(entry.url)) return;
    seen.add(entry.url);
    urls.push(entry);
  };

  const listed = robots ? robotsSitemaps(robots.html).filter(sameOrigin) : [];
  const queue = listed.length > 0 ? [...listed] : [`${origin}/sitemap.xml`];
  const queued = new Set(queue);
  // What the site itself advertises (robots `Sitemap:` lines, and the children those sitemaps list) is fetched even if
  // robots.txt disallows its path; any file WE pick (/sitemap.xml, <path>/sitemap.xml, llms.txt) must be allowed by robots.
  const advertised = new Set(listed);
  let skippedByRobots = 0;
  const robotsBlocks = (u: string): boolean => matcher !== null && !advertised.has(u) && !robotsAllows(matcher, u);
  let sawSitemapEntries = false;
  let i = 0;
  let files = 0;
  /** Walk the queued sitemap files. Every ATTEMPT counts against the budget (a dead child costs a request too), not only the 2xx ones. */
  const walk = async (): Promise<void> => {
    for (; i < queue.length && files < MAX_SITEMAP_FILES && urls.length <= limit; i++) {
      if (robotsBlocks(queue[i] ?? "")) {
        skippedByRobots++;
        continue;
      }
      files++;
      const doc = await get(queue[i] ?? "");
      // fetchFast follows redirects: the file actually served must still be on the seed's origin.
      if (!doc || !sameOrigin(doc.url)) continue;
      const parsed = parseSitemap(doc.html);
      for (const e of parsed.entries) {
        if (parsed.kind === "index") {
          if (sameOrigin(e.loc) && !queued.has(e.loc)) {
            queued.add(e.loc);
            advertised.add(e.loc); // listed by a sitemap we were allowed to fetch
            queue.push(e.loc);
          }
        } else {
          sawSitemapEntries = true;
          add(e.lastmod ? { url: e.loc, lastmod: e.lastmod } : { url: e.loc });
        }
      }
    }
  };
  await walk();
  // The walk stopped on the file budget with files still queued: the list is incomplete.
  const cutByBudget = (): boolean => i < queue.length && urls.length <= limit;

  if (!sawSitemapEntries && base && !cutByBudget()) {
    const sub = `${origin}${base}/sitemap.xml`;
    if (!queued.has(sub)) {
      queued.add(sub);
      queue.push(sub);
      await walk();
    }
  }

  let source: MapResult["source"] = "sitemap";
  let sawLlms = false;
  if (!sawSitemapEntries && !cutByBudget()) {
    // No usable sitemap at all (not "a sitemap whose entries were all filtered out"): try llms.txt, then <path>/llms.txt.
    for (const llmsUrl of base ? [`${origin}/llms.txt`, `${origin}${base}/llms.txt`] : [`${origin}/llms.txt`]) {
      if (robotsBlocks(llmsUrl)) {
        skippedByRobots++;
        continue;
      }
      const doc = await get(llmsUrl);
      const links = doc && sameOrigin(doc.url) ? llmsLinks(doc.html, llmsUrl) : [];
      if (links.length === 0) continue;
      sawLlms = true;
      source = "llms-txt";
      for (const link of links) add({ url: link });
      break;
    }
  }

  const truncated = urls.length > limit || cutByBudget();
  const out = truncated ? urls.slice(0, limit) : urls;
  const result: MapResult = {
    source,
    count: out.length,
    urls: out,
    ...(truncated ? { truncated: true as const } : {}),
    ...(offOrigin.size > 0 ? { offOrigin: offOrigin.size } : {}),
    ...(skippedByRobots > 0 ? { skippedByRobots } : {}),
  };
  if (out.length > 0) return result;
  // Never an empty list without a reason.
  const found = sawSitemapEntries || sawLlms;
  const warning = cutByBudget() ? "budget_exhausted" : found ? "all_filtered" : skippedByRobots > 0 ? "blocked_by_robots" : "no_sitemap_found";
  return { ...result, warning, tried };
}
