/**
 * Fetch many URLs in parallel via the HTTP fast-path. Bounded concurrency, each
 * URL resolved independently (fast-path + optional SPA browser escalation) and
 * rendered to the shared `RenderedFetch` shape. A failed URL becomes an error
 * entry instead of aborting the batch.
 * @module agent/fetch-batch
 */
import { mapConcurrent } from "../net/concurrent.js";
import { fetchAndRender } from "./fetch-orchestrate.js";
import type { RenderedFetch } from "./fetch-render.js";

/** Default parallelism — polite for mixed hosts, multiplexes over HTTP/2. */
const DEFAULT_CONCURRENCY = 8;

/** Options for a batch fetch (per-URL semantics mirror `browser_fetch`). */
export interface FetchBatchOptions {
  format?: string;
  maxChars?: number;
  browserFallback?: boolean;
  proxyUrl?: string;
  /** Also try each URL's `.md` twin (see `net/doc-markdown`). */
  preferMarkdown?: boolean;
  concurrency?: number;
  /** Called after each URL settles (success or failure): `(done, total, url)`. */
  onProgress?: (done: number, total: number, label?: string) => void;
}

/** One batch result: a rendered fetch, or `{ url, error }` on failure. */
export type FetchBatchItem = RenderedFetch | { url: string; error: string };

/**
 * Fetch `urls` concurrently and return one item per input, in order.
 *
 * @param urls - URLs to fetch.
 * @param opts - Shared per-URL options + `concurrency` (default 8).
 * @returns Results aligned to `urls`; failures are `{ url, error }`.
 */
export async function fetchBatch(urls: string[], opts: FetchBatchOptions = {}): Promise<FetchBatchItem[]> {
  const concurrency = opts.concurrency && opts.concurrency > 0 ? opts.concurrency : DEFAULT_CONCURRENCY;
  let done = 0;
  const outcomes = await mapConcurrent(urls, concurrency, async (url) => {
    try {
      const { rendered } = await fetchAndRender(url, {
        browserFallback: opts.browserFallback,
        proxyUrl: opts.proxyUrl,
        preferMarkdown: opts.preferMarkdown,
        format: opts.format,
        maxChars: opts.maxChars,
      });
      return rendered;
    } finally {
      opts.onProgress?.(++done, urls.length, url);
    }
  });
  return outcomes.map((o, i) => (o.ok ? o.value : { url: urls[i] ?? "", error: String(o.error) }));
}
