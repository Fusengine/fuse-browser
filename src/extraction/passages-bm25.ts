/**
 * Model-free passage retrieval: rank the heading-scoped passages of a page by
 * BM25 against a query. Lexical only (lowercased Unicode word tokens, no
 * stemming, no stop-word list — the IDF already discounts common words), so it
 * is deterministic and needs no model. Pure.
 * @module extraction/passages-bm25
 */
import type { Passage } from "../interfaces/passages.js";
import { splitPassages } from "./passages-split.js";

/** Passages returned when `topK` is not given. */
export const DEFAULT_TOP_K = 3;

/** BM25 term-frequency saturation. */
const K1 = 1.5;
/** BM25 length normalisation. */
const B = 0.75;

/** Lowercased letter/number runs of `s`. */
function tokens(s: string): string[] {
  return s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * Rank `markdown`'s passages against `query` with BM25 and return the best `topK`.
 * A passage's heading counts as part of its text for scoring. Only passages that
 * contain at least one query term are returned, so a query that matches nothing
 * gives `[]`.
 *
 * @param markdown - Extracted markdown or plain text (the whole page, not a truncated slice).
 * @param query - Free-text question or keywords.
 * @param topK - How many passages to return (default {@link DEFAULT_TOP_K}).
 * @returns Passages by descending score (ties keep document order); `score` is rounded to 4 decimals.
 */
export function rankPassages(markdown: string, query: string, topK: number = DEFAULT_TOP_K): Passage[] {
  const terms = [...new Set(tokens(query))];
  const chunks = splitPassages(markdown);
  if (terms.length === 0 || chunks.length === 0) return [];
  const docs = chunks.map((c) => tokens(`${c.heading} ${c.text}`));
  const avgLen = docs.reduce((n, d) => n + d.length, 0) / docs.length || 1;
  const df = new Map<string, number>();
  const tfs = docs.map((d) => {
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    return tf;
  });
  const n = docs.length;
  const scored = chunks.map((chunk, i) => {
    const len = docs[i]?.length ?? 0;
    let score = 0;
    for (const t of terms) {
      const f = tfs[i]?.get(t) ?? 0;
      if (f === 0) continue;
      const d = df.get(t) ?? 0;
      const idf = Math.log(1 + (n - d + 0.5) / (d + 0.5));
      score += (idf * f * (K1 + 1)) / (f + K1 * (1 - B + (B * len) / avgLen));
    }
    return { i, score, chunk };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, Math.max(1, Math.floor(topK)))
    .map((s) => ({ heading: s.chunk.heading, text: s.chunk.text, score: Math.round(s.score * 10_000) / 10_000 }));
}
