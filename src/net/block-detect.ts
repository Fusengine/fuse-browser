/**
 * Detect an anti-bot interstitial on a fast-path (or browser-rendered) response
 * so it is reported as `blocked` instead of being returned as a normal page.
 * Pure + table-driven (`BLOCK_SIGNALS`): detection only — it never solves or
 * evades anything, it only lets the caller route to a real browser session.
 *
 * Combination rules (no single vendor string decides alone on an ordinary page):
 * 1. a strong HEADER signal (vendor-documented) → blocked at any status;
 * 2. a strong HTML marker → blocked only on a non-2xx status or thin visible
 *    text, so an article or a healthy protected page that merely carries/quotes
 *    the marker stays untouched;
 * 3. weak signals → blocked only when at least three distinct PAGE-LEVEL hints
 *    match on a non-2xx page with thin visible text (any two are common on
 *    legitimate error/maintenance pages, e.g. an "Access denied" title plus a
 *    refresh). A `presenceOnly` signal (a vendor header present on normal
 *    responses, like `x-datadome`) never counts toward the three; it can still
 *    attribute the vendor once the page-level hints decide.
 * A body with no status (rendered by a real browser) is never "non-2xx": only
 * rules 1 and 2-with-thin-text can fire on it. Bodies over {@link MAX_SCAN_CHARS}
 * are never scanned (a challenge page is small; the visible-text pass is
 * superlinear on hostile markup) — only the header rule applies to them.
 * @module net/block-detect
 */
import type { BlockInput, BlockSignal, BlockVerdict } from "../interfaces/block.js";
import { BLOCK_SIGNALS } from "./block-signals.js";
import { THIN_TEXT_CHARS, visibleText } from "./thin-shell.js";

const TITLE = /<title[^>]*>([\s\S]*?)<\/title>/i;
const WEAK_QUORUM = 3;
/** Raw-body size above which HTML-based detection is skipped (1 MiB of characters). */
export const MAX_SCAN_CHARS = 1_048_576;

/**
 * True when `html` carries too little visible text to be a real page — the
 * shape of an interstitial. Same threshold as the SPA thin-shell check.
 *
 * @param html - Raw HTML.
 */
export function isThinHtml(html: string): boolean {
  return html.length <= MAX_SCAN_CHARS && visibleText(html).length < THIN_TEXT_CHARS;
}

/**
 * True when a block can ONLY be recognised from response headers: every signal
 * behind `verdict` is a header signal AND the table has no HTML marker for that
 * vendor. A browser-rendered page carries no headers, so such a block is invisible
 * on the render; a vendor with its own HTML marker (Cloudflare, DataDome) is
 * re-detected directly on the render and needs no inheritance.
 *
 * @param verdict - A verdict from {@link detectBlock}.
 * @param signals - Signal table; defaults to {@link BLOCK_SIGNALS}.
 */
export function isHeaderOnlyBlock(verdict: BlockVerdict, signals: readonly BlockSignal[] = BLOCK_SIGNALS): boolean {
  const kindOf = new Map(signals.map((s) => [s.id, s.kind]));
  const allHeaders = verdict.signals.length > 0 && verdict.signals.every((id) => kindOf.get(id) === "header");
  const hasOwnMarker = signals.some((s) => s.vendor === verdict.vendor && s.kind === "html" && s.strength === "strong");
  return allHeaders && !hasOwnMarker;
}

/** True for a 4xx/5xx status; an unknown status (browser-rendered body) is NOT an error. */
function isErrorish(status: number | undefined): boolean {
  return status !== undefined && status >= 400;
}

/** Vendor of the strongest evidence; falls back to a non-generic weak vendor, then "unknown". */
function pickVendor(strong: BlockSignal[], weak: BlockSignal[]): string {
  const hit = strong[0] ?? weak.find((s) => s.vendor !== "generic");
  return hit?.vendor ?? "unknown";
}

/**
 * Decide whether `input` is an anti-bot interstitial.
 *
 * @param input - Status, lowercase headers and raw body of the response.
 * @param signals - Signal table; defaults to {@link BLOCK_SIGNALS}.
 * @returns A verdict, or `null` for an ordinary response.
 */
export function detectBlock(input: BlockInput, signals: readonly BlockSignal[] = BLOCK_SIGNALS): BlockVerdict | null {
  const headers = input.headers ?? {};
  const matched: BlockSignal[] = signals.filter(
    (s) => s.kind === "header" && s.header !== undefined && s.pattern.test(headers[s.header] ?? ""),
  );
  const strongHeader = matched.filter((s) => s.strength === "strong");
  if (strongHeader.length > 0) return { vendor: pickVendor(strongHeader, []), signals: matched.map((s) => s.id) };
  if (!input.isHtml || input.html.length > MAX_SCAN_CHARS) return null;

  const title = TITLE.exec(input.html)?.[1] ?? "";
  for (const s of signals) {
    if (s.kind === "html" && s.pattern.test(input.html)) matched.push(s);
    else if (s.kind === "title" && s.pattern.test(title)) matched.push(s);
  }
  const errorish = isErrorish(input.status);
  const strongHtml = matched.filter((s) => s.strength === "strong");
  // Ordinary 2xx page with no strong marker: nothing can qualify, skip the visible-text pass.
  if (!errorish && strongHtml.length === 0) return null;

  const text = visibleText(input.html);
  const thin = text.length < THIN_TEXT_CHARS;
  if (errorish) for (const s of signals) if (s.kind === "text" && s.pattern.test(text)) matched.push(s);
  const weak = matched.filter((s) => s.strength === "weak");
  const strongHit = strongHtml.length > 0 && (errorish || thin);
  const weakHit = errorish && thin && weak.filter((s) => !s.presenceOnly).length >= WEAK_QUORUM;
  if (!strongHit && !weakHit) return null;
  return { vendor: pickVendor(strongHtml, weak), signals: matched.map((s) => s.id) };
}

/**
 * One-line, actionable next step for a blocked result — names real
 * fuse-browser tools and parameters only.
 *
 * @param verdict - The detection verdict.
 * @param escalated - True when a real-browser render was already attempted and is also blocked.
 */
export function blockHint(verdict: BlockVerdict, escalated: boolean): string {
  const who = verdict.vendor === "unknown" ? "unidentified vendor" : verdict.vendor;
  const headed = 'browser_open {headless:false, engine:"playwright", channel:"chrome"}';
  if (escalated) {
    return `Still blocked after a real-browser render (${who}). Read it in a session: ${headed} → browser_navigate → browser_extract; if the live page shows a human step (CAPTCHA/turnstile), call browser_handoff so a person completes it.`;
  }
  return `Blocked by an anti-bot interstitial (${who}) — this is not the page content. Retry with browserFallback:true, or read it in a session: browser_open → browser_navigate → browser_extract (if the default session is also challenged, use ${headed}); if the live page shows a human step (CAPTCHA/turnstile), call browser_handoff.`;
}
