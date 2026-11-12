/**
 * `browser_fetch_batch` tool: fetch many URLs in parallel via the HTTP fast-path
 * (TLS impersonation, no browser launch). Bounded concurrency; each URL is
 * independent — a failed one yields `{ url, error }` without aborting the batch.
 * @module server/tools/fetch-batch
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetchBatch } from "../../agent/fetch-batch.js";
import { BUDGET_INPUT_SHAPE, BUDGET_OUTPUT_SHAPE, budgetResult } from "../output-budget.js";
import { progressReporter } from "../progress.js";
import { renderedFetchSchema, urlErrorSchema } from "./schemas-fetch-output.js";

/** `browser_fetch_batch` output shape: one rendered fetch or `{url,error}` per input URL. */
export const FETCH_BATCH_OUTPUT_SHAPE = {
  count: z.number(),
  results: z.array(z.union([renderedFetchSchema, urlErrorSchema])),
  ...BUDGET_OUTPUT_SHAPE,
};

/** Register `browser_fetch_batch`. */
export function registerFetchBatchTool(server: McpServer): void {
  server.registerTool(
    "browser_fetch_batch",
    {
      title: "HTTP fast fetch (batch)",
      description:
        "Fetch MANY URLs in parallel via the HTTP fast-path — browser TLS/HTTP2 impersonation, NO browser launch. Bounded concurrency (default 8). Each URL keeps the same semantics as browser_fetch: clean markdown for HTML, JSON/plain-text verbatim, optional browserFallback per URL for SPA/CSR shells; a URL answered by an anti-bot interstitial carries blocked:true, blockedBy and a hint (see browser_fetch); PDFs are read as page-marked text with pageCount, and a site's own markdown is used when offered (source, preferMarkdown — see browser_fetch). Results are returned in input order; a failed URL becomes { url, error } and never aborts the batch. Use this instead of N browser_fetch calls when an agent needs several pages at once.",
      inputSchema: {
        urls: z.array(z.string()),
        format: z.enum(["markdown", "text"]).optional(),
        maxChars: z.number().int().optional(),
        browserFallback: z.boolean().optional(),
        preferMarkdown: z.boolean().optional(),
        proxyUrl: z.string().optional(),
        concurrency: z.number().int().optional(),
        ...BUDGET_INPUT_SHAPE,
      },
      outputSchema: FETCH_BATCH_OUTPUT_SHAPE,
    },
    async (args, extra) => {
      const a = args as Record<string, unknown>;
      const urls = Array.isArray(a.urls) ? a.urls.map(String) : [];
      const results = await fetchBatch(urls, {
        format: typeof a.format === "string" ? a.format : undefined,
        maxChars: typeof a.maxChars === "number" ? a.maxChars : undefined,
        browserFallback: a.browserFallback === true,
        preferMarkdown: a.preferMarkdown === true,
        proxyUrl: typeof a.proxyUrl === "string" ? a.proxyUrl : undefined,
        concurrency: typeof a.concurrency === "number" ? a.concurrency : undefined,
        onProgress: progressReporter(extra),
      });
      return budgetResult("browser_fetch_batch", { count: results.length, results }, "results", a);
    },
  );
}
