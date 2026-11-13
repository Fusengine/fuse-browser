/**
 * Collect a Google SERP across multiple pages (start=0,10,...), merging organic
 * results by URL with continuous positions. Page 1 is the already-loaded page.
 * @module agent/serp-paged
 */
import type { Page } from "playwright";
import { extractSerp } from "../extraction/serp.js";
import { classifyEmptySerp } from "../extraction/serp-state.js";
import type { Serp, SerpResult } from "../interfaces/extraction.js";
import type { RetryConfig } from "../interfaces/net.js";
import { DEFAULT_GOTO, gotoWithRetry } from "../net/navigate.js";

/** Build the URL for SERP page offset `start`. */
function withStart(url: string, start: number): string {
  const u = new URL(url);
  u.searchParams.set("start", String(start));
  return u.toString();
}

/** Extract the SERP over `pages` pages (>=1), merging organic by URL (first wins). */
export async function collectSerp(page: Page, pages: number, retry: RetryConfig): Promise<Serp> {
  const merged = await extractSerp(page);
  if (merged.organic.length === 0) merged.warning = await classifyEmptySerp(page);
  if (pages <= 1) return merged;
  // A redirect wrapper carries a per-page token: dedup those on what the user sees instead.
  const key = (r: SerpResult): string => (r.redirect ? `${r.displayUrl ?? ""}|${r.title}` : r.url);
  const seen = new Set(merged.organic.map(key));
  const base = page.url();
  for (let i = 1; i < pages; i += 1) {
    await gotoWithRetry(page, withStart(base, i * 10), DEFAULT_GOTO, retry);
    const next = await extractSerp(page);
    for (const r of next.organic) {
      if (seen.has(key(r))) continue;
      seen.add(key(r));
      merged.organic.push({ ...r, position: merged.organic.length + 1 });
    }
  }
  if (merged.organic.length > 0) delete merged.warning;
  return merged;
}
