/**
 * `browser_map` tool: list a site's URLs from sitemap.xml (incl. sitemap index and
 * .gz files), robots.txt `Sitemap:` lines and llms.txt — HTTP fast-path only, no
 * crawl, no browser launch. Read-only.
 * @module server/tools/map
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MapInputError, mapSite } from "../../agent/map-site.js";
import { MAP_WARNINGS } from "../../interfaces/map.js";
import { PrivateNetworkBlockedError } from "../../net/private-net-guard.js";
import { errorResult, jsonResult } from "../result.js";

/** `browser_map` output shape. */
export const MAP_OUTPUT_SHAPE = {
  source: z.enum(["sitemap", "llms-txt"]),
  count: z.number(),
  urls: z.array(z.object({ url: z.string(), lastmod: z.string().optional() })),
  /** `true` only when the list is incomplete: cut by `limit`, or the 50-sitemap-file budget ended the walk. */
  truncated: z.literal(true).optional(),
  /** Distinct listed URLs dropped for being on another origin than the sitemap. Absent when 0. */
  offOrigin: z.number().optional(),
  /** Candidate sitemap/llms.txt files not fetched because robots.txt disallows them. Absent when 0. */
  skippedByRobots: z.number().optional(),
  /** Only when `count` is 0: why the list is empty. */
  warning: z.enum(MAP_WARNINGS).optional(),
  /** Only when `count` is 0: every URL requested, in order. */
  tried: z.array(z.string()).optional(),
};

/** Register `browser_map`. */
export function registerMapTool(server: McpServer): void {
  server.registerTool(
    "browser_map",
    {
      title: "Map a site's URLs",
      description:
        "List the URLs of a site WITHOUT crawling it — HTTP fast-path, no browser launch. Reads robots.txt `Sitemap:` lines (else /sitemap.xml), follows sitemap indexes and .gz sitemaps (same origin only, at most 50 file attempts), and falls back to /llms.txt links when the site has no sitemap. Returns {source:\"sitemap\"|\"llms-txt\", count, urls:[{url, lastmod?}]} (truncated:true when the list is incomplete — cut by limit, default 1000, or by the file budget). includePaths/excludePaths filter on the URL path: `*` is a wildcard, a pattern without `*` also matches everything below it (`/docs` matches `/docs` and `/docs/a`). URLs disallowed by the origin's robots.txt are left out unless respectRobots:false. Use it to pick pages, then browser_fetch / browser_fetch_batch them.",
      inputSchema: {
        url: z.string(),
        includePaths: z.array(z.string()).optional(),
        excludePaths: z.array(z.string()).optional(),
        limit: z.number().int().positive().optional(),
        respectRobots: z.boolean().optional(),
        proxyUrl: z.string().optional(),
      },
      outputSchema: MAP_OUTPUT_SHAPE,
    },
    async (args) => {
      const a = args as Record<string, unknown>;
      const strings = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.map(String) : undefined);
      try {
        const result = await mapSite(String(a.url), {
          includePaths: strings(a.includePaths),
          excludePaths: strings(a.excludePaths),
          limit: typeof a.limit === "number" ? a.limit : undefined,
          respectRobots: a.respectRobots === false ? false : undefined,
          proxyUrl: typeof a.proxyUrl === "string" ? a.proxyUrl : undefined,
        });
        return jsonResult({ ...result });
      } catch (err) {
        if (err instanceof PrivateNetworkBlockedError || err instanceof MapInputError) return errorResult(err.message, err.code);
        throw err;
      }
    },
  );
}
