/**
 * Run several Google searches in ONE browser session, sequentially (lower
 * anti-bot risk than parallel), with a jittered delay between queries. Returns
 * one row per query (SERP organic + optional domain rank). For small batches;
 * high volume needs rotating proxies.
 * @module agent/serp-batch
 */
import { selectEngineForConfig } from "../engine/registry.js";
import { teardownOpened } from "../engine/teardown.js";
import { findDomainRanks } from "../extraction/serp-rank.js";
import type { SerpBatchRow } from "../interfaces/extraction.js";
import { sleep } from "../lib/retry.js";
import { randInt } from "../lib/text.js";
import { withBreaker } from "../net/breaker-guard.js";
import { DEFAULT_GOTO, gotoWithRetry } from "../net/navigate.js";
import type { ResolvedConfig } from "./config.js";
import { collectSerp } from "./serp-paged.js";

/** Options for {@link serpBatch}. */
export interface SerpBatchOptions {
  queries: string[];
  rankDomain?: string;
  pages?: number;
  hl?: string;
  gl?: string;
  /** Fixed inter-query delay (ms); defaults to a 2–4s jitter. */
  delayMs?: number;
  /** Called after each query settles (success or failure): `(done, total, query)`. */
  onProgress?: (done: number, total: number, label?: string) => void;
}

/** Build a Google search URL. */
function googleUrl(query: string, hl: string, gl: string): string {
  const u = new URL("https://www.google.com/search");
  u.searchParams.set("q", query);
  u.searchParams.set("hl", hl);
  u.searchParams.set("gl", gl);
  return u.toString();
}

/** Search each query sequentially in one context; one row per query. */
export async function serpBatch(config: ResolvedConfig, opts: SerpBatchOptions): Promise<SerpBatchRow[]> {
  const opened = await selectEngineForConfig(config).open(config);
  const page = opened.page ?? (await opened.context.newPage());
  const rows: SerpBatchRow[] = [];
  try {
    for (const [i, query] of opts.queries.entries()) {
      if (i > 0) await sleep(opts.delayMs ?? randInt(2_000, 4_000));
      try {
        const url = googleUrl(query, opts.hl ?? "en", opts.gl ?? "us");
        await withBreaker(url, config.circuitBreaker, () => gotoWithRetry(page, url, DEFAULT_GOTO, config.retry));
        const serp = await collectSerp(page, opts.pages ?? 1, config.retry);
        rows.push({
          query,
          results: serp.organic,
          rank: opts.rankDomain ? findDomainRanks(serp, opts.rankDomain) : undefined,
          ...(serp.warning ? { warning: serp.warning } : {}),
        });
      } catch (error) {
        rows.push({ query, results: [], error: String(error) });
      }
      opts.onProgress?.(i + 1, opts.queries.length, query);
    }
  } finally {
    await teardownOpened(opened);
  }
  return rows;
}
