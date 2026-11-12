/**
 * Types for `browser_map`: listing a site's URLs from its sitemap(s) or llms.txt.
 * @module interfaces/map
 */

/** Where the URL list came from. */
export type MapSource = "sitemap" | "llms-txt";

/** One listed URL. */
export interface MapUrl {
  url: string;
  /** `<lastmod>` of the sitemap entry, verbatim. Sitemaps only. */
  lastmod?: string;
}

/** Why a map came back empty. */
export const MAP_WARNINGS = ["no_sitemap_found", "all_filtered", "budget_exhausted", "blocked_by_robots"] as const;

/** One of {@link MAP_WARNINGS}. */
export type MapWarning = (typeof MAP_WARNINGS)[number];

/** Result of mapping a site. */
export interface MapResult {
  source: MapSource;
  count: number;
  urls: MapUrl[];
  /** Distinct listed URLs dropped because they are not on the sitemap's own origin (protocol + host + port; sitemaps.org). Absent when 0. */
  offOrigin?: number;
  /** Sitemap / llms.txt files `browser_map` chose itself and did NOT fetch because robots.txt disallows them (sitemaps the site advertises are always fetched). Absent when 0. */
  skippedByRobots?: number;
  /** Only when `count` is 0: `no_sitemap_found` (nothing usable at any tried URL), `all_filtered` (entries existed but include/exclude/robots removed them all), `budget_exhausted` (the 50-file budget ended the walk first), `blocked_by_robots` (the candidate files were not fetched because robots.txt disallows them). */
  warning?: MapWarning;
  /** Only when `count` is 0: every URL requested, in order. */
  tried?: string[];
  /** Present (`true`) only when the list is incomplete: cut by `limit`, or the sitemap-file budget ended the walk. */
  truncated?: true;
}

/** Options of {@link mapSite}. */
export interface MapOptions {
  /** Keep only URLs whose path matches one of these patterns (`*` wildcard; a pattern without `*` also matches everything below it). */
  includePaths?: string[];
  /** Drop URLs whose path matches one of these patterns. */
  excludePaths?: string[];
  /** Max URLs returned (default 1000). */
  limit?: number;
  /** Drop URLs disallowed by the origin's robots.txt (default true). */
  respectRobots?: boolean;
  proxyUrl?: string;
}

/** One `<url>`/`<sitemap>` entry of a parsed sitemap. */
export interface SitemapEntry {
  loc: string;
  lastmod?: string;
}

/** A parsed sitemap document. */
export interface ParsedSitemap {
  /** `index` lists other sitemaps, `urlset` lists pages, `unknown` is neither. */
  kind: "index" | "urlset" | "unknown";
  entries: SitemapEntry[];
}
