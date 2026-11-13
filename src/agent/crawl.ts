/**
 * Bounded same-origin crawl: BFS from a seed URL, fetching each depth level in
 * parallel via the fast-path, rendering each page to markdown. Dedups URLs at
 * enqueue time and (by default) honors robots.txt. Reuses fetch-batch building
 * blocks; safe defaults keep it from turning into a runaway.
 * @module agent/crawl
 */
import { mapConcurrent } from "../net/concurrent.js";
import { extractLinks } from "../net/extract-links.js";
import { fetchFast } from "../net/fetch-fast.js";
import { createRobotsGuard } from "../net/robots-guard.js";
import { throttleHost } from "../net/throttle.js";
import { jitterMs } from "../lib/retry.js";
import { renderFetch, type RenderedFetch } from "./fetch-render.js";
import { resolveFetchBody } from "./fetch-resolve.js";

/** Crawl bounds and per-page fetch options. */
export interface CrawlOptions {
  maxPages?: number;
  maxDepth?: number;
  sameOrigin?: boolean;
  concurrency?: number;
  format?: string;
  maxChars?: number;
  browserFallback?: boolean;
  proxyUrl?: string;
  respectRobots?: boolean;
  throttleMs?: number;
  /** Called after each page settles (success or failure): `(done, maxPages, url)`. */
  onProgress?: (done: number, total: number, label?: string) => void;
}

/** A crawled page: its rendered content plus its BFS depth from the seed. */
export interface CrawlPage extends RenderedFetch {
  depth: number;
}

/**
 * Crawl from `seed` and return the pages found, in discovery order.
 *
 * @param seed - Starting URL.
 * @param opts - Bounds (maxPages 25, maxDepth 2, concurrency 5) + fetch options.
 *   `sameOrigin` and `respectRobots` default to **true**.
 * @returns `{ count, pages }` capped at `maxPages`.
 */
export async function crawl(seed: string, opts: CrawlOptions = {}): Promise<{ count: number; pages: CrawlPage[] }> {
  const maxPages = opts.maxPages ?? 25;
  const maxDepth = opts.maxDepth ?? 2;
  const sameOrigin = opts.sameOrigin !== false;
  const concurrency = opts.concurrency && opts.concurrency > 0 ? opts.concurrency : 5;
  const robots = opts.respectRobots === false ? null : createRobotsGuard(opts.proxyUrl);
  const throttleMs = opts.throttleMs ?? 250; // polite per-host gap (jittered per request); 0 disables
  const visited = new Set<string>([seed]);
  const pages: CrawlPage[] = [];
  let frontier = [seed];
  let done = 0;

  for (let depth = 0; depth <= maxDepth && frontier.length > 0 && pages.length < maxPages; depth++) {
    const batch = frontier.slice(0, maxPages - pages.length);
    const fetched = await mapConcurrent(batch, concurrency, async (url) => {
      try {
        if (robots && !(await robots.allowed(url))) throw new Error("robots-disallowed");
        await throttleHost(url, jitterMs(throttleMs));
        const r = await fetchFast(url, opts.proxyUrl);
        const body = await resolveFetchBody(url, r, { browserFallback: opts.browserFallback, proxyUrl: opts.proxyUrl });
        return { rendered: await renderFetch(body, { format: opts.format, maxChars: opts.maxChars }), html: body.html, url: body.url, blocked: body.blocked !== undefined };
      } finally {
        opts.onProgress?.(++done, maxPages, url);
      }
    });
    const next: string[] = [];
    for (const o of fetched) {
      if (!o.ok || pages.length >= maxPages) continue;
      pages.push({ ...o.value.rendered, depth });
      // An interstitial's links are challenge-page chrome, not the site: never follow them.
      if (depth < maxDepth && !o.value.blocked) {
        for (const link of extractLinks(o.value.html, o.value.url, sameOrigin)) {
          if (!visited.has(link)) {
            visited.add(link);
            next.push(link);
          }
        }
      }
    }
    frontier = next;
  }
  return { count: pages.length, pages };
}
