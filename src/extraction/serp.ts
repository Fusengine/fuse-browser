/**
 * Extract a Google search results page (organic, ads, related) from the live
 * DOM. Iterates `h3` titles and resolves each link defensively — the title
 * `h3` is the most stable hook across Google's frequent layout/class changes.
 * Dedup by result container so sitelinks don't inflate results.
 * @module extraction/serp
 */
import type { Page } from "playwright";
import type { Serp } from "../interfaces/extraction.js";
import { evalScript } from "../lib/evaluate.js";

const SERP_SCRIPT = `() => {
  const clean = (t) => (t || "").replace(/\\s+/g, " ").trim();
  const SNIPPET = "div.VwiC3b, div[data-content-feature='1'], .lEBKkf, .MUxGbd, span.st";
  const AD_ROOTS = "#tads, #tadsb, #bottomads";
  const host = (u) => { try { return new URL(u); } catch (e) { return null; } };
  const internal = (u) => { const x = host(u); return !x || x.hostname.endsWith("google.com"); };
  // Google's current layout wraps every organic link as google.com/goto?url=<opaque>: the
  // destination is NOT in the DOM, so the wrapper is kept and flagged instead of dropped.
  const redirect = (u) => { const x = host(u); return Boolean(x && x.hostname.endsWith("google.com") && x.pathname === "/goto" && x.searchParams.has("url")); };
  const linkFor = (h3) => {
    const inA = h3.closest("a[href]");
    if (inA) return inA;
    const c = h3.closest("div[data-hveid], div.g, div[data-sokoban-container]");
    return (c && c.querySelector("a[href^='http']")) || h3.parentElement?.querySelector("a[href]") || null;
  };
  const urlCite = (block) => {
    const cites = Array.from(block.querySelectorAll("cite")).map((c) => clean(c.textContent));
    return cites.find((t) => /^https?:\\/\\/\\S/.test(t)) || cites[0] || undefined;
  };
  const collect = (h3s, skipAds) => {
    const out = [];
    const seenBlocks = new Set();
    const seenUrls = new Set();
    h3s.forEach((h3) => {
      const a = linkFor(h3);
      if (!a || !a.href) return;
      const wrapped = redirect(a.href);
      // A wrapper counts only when the title itself is the link: a heading with no own link
      // (e.g. an "AI Mode" block) would otherwise borrow a neighbouring citation's wrapper.
      if (wrapped && !h3.closest("a[href]")) return;
      if (skipAds && ((internal(a.href) && !wrapped) || a.closest(AD_ROOTS))) return;
      const block = a.closest("div[data-sokoban-container]") || a.closest("div[data-hveid]") || h3.parentElement;
      if (!block || seenBlocks.has(block) || seenUrls.has(a.href)) return;
      seenBlocks.add(block);
      seenUrls.add(a.href);
      const item = {
        position: out.length + 1,
        title: clean(h3.textContent),
        url: a.href,
        displayUrl: urlCite(block),
        snippet: clean(block.querySelector(SNIPPET)?.textContent) || undefined,
      };
      if (wrapped) item.redirect = true;
      out.push(item);
    });
    return out;
  };
  const root = document.querySelector("#rso") || document.querySelector("#search") || document.body;
  const organic = collect(Array.from(root.querySelectorAll("h3")), true);
  const ads = collect(Array.from(document.querySelectorAll("#tads h3, #tadsb h3, #bottomads h3")), false);
  const related = Array.from(document.querySelectorAll(".s75CSd, #brs a, #bres a"))
    .map((e) => clean(e.textContent))
    .filter((t, i, arr) => t && arr.indexOf(t) === i);
  return { organic, ads, related };
}`;

/** Parse the current Google SERP into structured organic / ads / related lists. */
export function extractSerp(page: Page): Promise<Serp> {
  return evalScript<Serp>(page, SERP_SCRIPT);
}
