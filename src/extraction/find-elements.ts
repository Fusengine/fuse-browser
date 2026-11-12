/**
 * Model-free lookup of interactive elements by accessible name / role / text, for
 * `browser_find`. Pure and browser-free: every whitespace-separated token of the
 * query must appear in the element's searchable fields; exact and prefix hits on
 * the visible name rank first, DOM order breaks ties.
 * @module extraction/find-elements
 */
import type { InteractiveElement } from "../interfaces/extraction.js";

/** Result of a lookup: the best `limit` matches and the total number of matches. */
export interface FindResult {
  matches: InteractiveElement[];
  total: number;
}

const lower = (v: string | null | undefined): string => (v ?? "").toLowerCase();

/** 0 exact name, 1 name prefix, 2 name contains, 3 matched only through role/tag/id/value; `null` = no match. */
function rank(el: InteractiveElement, query: string, tokens: string[]): number | null {
  const names = [lower(el.text), lower(el.name), lower(el.placeholder)];
  const hay = [...names, lower(el.role), el.tag, lower(el.id), lower(el.value), lower(el.type)].join("\n");
  if (!tokens.every((t) => hay.includes(t))) return null;
  if (names.some((n) => n === query)) return 0;
  if (names.some((n) => n.startsWith(query))) return 1;
  if (tokens.every((t) => names.some((n) => n.includes(t)))) return 2;
  return 3;
}

/**
 * Find elements matching `query`.
 *
 * @param elements - Interactive elements of the current page (a snapshot capture).
 * @param query - Free text; every token must match (case-insensitive).
 * @param limit - Maximum matches returned.
 * @returns The best `limit` matches (best rank first) and the total match count.
 */
export function findElements(elements: InteractiveElement[], query: string, limit: number): FindResult {
  const q = query.trim().toLowerCase();
  const tokens = q.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return { matches: [], total: 0 };
  const ranked: Array<{ el: InteractiveElement; r: number }> = [];
  for (const el of elements) {
    const r = rank(el, q, tokens);
    if (r !== null) ranked.push({ el, r });
  }
  ranked.sort((a, b) => a.r - b.r || a.el.index - b.el.index);
  return { matches: ranked.slice(0, limit).map((x) => x.el), total: ranked.length };
}
