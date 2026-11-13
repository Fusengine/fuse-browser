/**
 * `browser_crawl` tool: bounded same-origin crawl from a seed URL via the HTTP
 * fast-path — BFS, parallel per depth level, each page rendered to markdown.
 * Conservative defaults (25 pages, depth 2, robots honored) keep it polite.
 * @module server/tools/crawl
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { crawl } from "../../agent/crawl.js";
import { BUDGET_INPUT_SHAPE, BUDGET_OUTPUT_SHAPE, budgetResult } from "../output-budget.js";
import { progressReporter } from "../progress.js";
import { crawlPageSchema } from "./schemas-fetch-output.js";

/** `browser_crawl` output shape: the discovered pages, in crawl order. */
export const CRAWL_OUTPUT_SHAPE = { count: z.number(), pages: z.array(crawlPageSchema), ...BUDGET_OUTPUT_SHAPE };

/** Register `browser_crawl`. */
export function registerCrawlTool(server: McpServer): void {
  server.registerTool(
    "browser_crawl",
    {
      title: "HTTP crawl (fast-path)",
      description:
        "Crawl a site from a seed URL via the HTTP fast-path — NO browser launch. Breadth-first, fetching each depth level in parallel, returning clean markdown per page. Same-origin and robots.txt-honored by default; bounded by maxPages (default 25) and maxDepth (default 2). Use this to grab a whole docs section / blog / set of pages in one call. For JS/SPA pages set browserFallback:true (renders empty shells in a real browser, per page). A page answered by an anti-bot interstitial is returned with blocked:true, blockedBy and a hint (see browser_fetch) and its links are not followed. A PDF page is read as page-marked text with pageCount (no links are followed out of it).",
      inputSchema: {
        url: z.string(),
        maxPages: z.number().int().optional(),
        maxDepth: z.number().int().optional(),
        sameOrigin: z.boolean().optional(),
        concurrency: z.number().int().optional(),
        format: z.enum(["markdown", "text"]).optional(),
        maxChars: z.number().int().optional(),
        browserFallback: z.boolean().optional(),
        respectRobots: z.boolean().optional(),
        throttleMs: z.number().int().optional(),
        proxyUrl: z.string().optional(),
        ...BUDGET_INPUT_SHAPE,
      },
      outputSchema: CRAWL_OUTPUT_SHAPE,
    },
    async (args, extra) => {
      const a = args as Record<string, unknown>;
      const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
      const result = await crawl(String(a.url), {
        onProgress: progressReporter(extra),
        maxPages: num(a.maxPages),
        maxDepth: num(a.maxDepth),
        sameOrigin: a.sameOrigin === false ? false : undefined,
        concurrency: num(a.concurrency),
        format: typeof a.format === "string" ? a.format : undefined,
        maxChars: num(a.maxChars),
        browserFallback: a.browserFallback === true,
        respectRobots: a.respectRobots === false ? false : undefined,
        throttleMs: num(a.throttleMs),
        proxyUrl: typeof a.proxyUrl === "string" ? a.proxyUrl : undefined,
      });
      return budgetResult("browser_crawl", { ...result }, "pages", a);
    },
  );
}
