/**
 * Resolve the body for `browser_fetch`: return the HTTP fast-path result, or —
 * when `browserFallback` is set and the response looks like an unrendered SPA
 * shell or an anti-bot interstitial — escalate to a real browser (Patchright)
 * and return the rendered HTML/text. This is how a single fetch call can "see
 * everything", even on client-rendered pages, without making the browser the
 * default path. A detected block is ALWAYS recorded on the body (`blocked`),
 * escalated or not, so the caller can report it instead of passing an
 * interstitial off as the page.
 * @module agent/fetch-resolve
 */
import type { BlockVerdict, BrowserProbe } from "../interfaces/block.js";
import type { PdfError } from "../interfaces/pdf.js";
import { detectBlock, isHeaderOnlyBlock, isThinHtml } from "../net/block-detect.js";
import type { FastResponse } from "../net/fetch-fast.js";
import { pdfToText } from "../net/pdf-extract.js";
import { isThinShell } from "../net/thin-shell.js";
import { BrowserAgent } from "./browser-agent.js";

/** A resolved fetch body, flagged when it required a browser render. */
export interface ResolvedBody {
  status: number;
  url: string;
  html: string;
  text: string;
  isHtml: boolean;
  /** True when the HTTP shell was escalated to a real browser render. */
  escalated: boolean;
  /** Set when this body is (still) an anti-bot interstitial rather than the page. */
  blocked?: BlockVerdict;
  /** Set when the body is a PDF read by `pdfToText` (`text` is page-marked). */
  pdf?: { pageCount?: number; error?: PdfError };
}

/** Escalation toggle + proxy passed through to the browser. */
export interface ResolveOptions {
  browserFallback?: boolean;
  proxyUrl?: string;
  /** Browser renderer; defaults to a Patchright `BrowserAgent` probe. Injectable for tests. */
  probe?: BrowserProbe;
}

/** The real renderer: one headless `BrowserAgent` probe returning the rendered HTML. */
const defaultProbe: BrowserProbe = (url, proxyUrl) => new BrowserAgent({ proxyUrl }).probe(url, { returnHtml: true });

/**
 * True when `FUSE_FETCH_ESCALATE_BLOCKED=1`: a detected anti-bot block escalates
 * to a real browser even without `browserFallback`. Off by default — a browser
 * launch per blocked URL is costly on a fast path that promises none.
 */
export function escalateBlockedByEnv(): boolean {
  return process.env.FUSE_FETCH_ESCALATE_BLOCKED === "1";
}

/**
 * Render `url` in a real browser and wrap it as an escalated body, re-checking
 * the rendered page for a block (a browser can be challenged too).
 *
 * @param url - The URL to render.
 * @param status - HTTP status of the fast-path response being replaced.
 * @param opts - Proxy + renderer.
 * @param fallbackHtml - HTML to keep when the renderer returns none.
 * @param prior - Verdict of the fast-path response being replaced. Inherited only
 *   for a block recognisable by response headers only (e.g. AWS WAF — `isHeaderOnlyBlock`)
 *   AND a render as thin as an interstitial: a rendered page carries no headers, so
 *   such a block would otherwise be passed off as the page. A vendor with its own HTML
 *   marker (Cloudflare, DataDome) is not inherited — a still-challenged render keeps
 *   its marker and is caught directly; a short legitimate page rendered fine is not
 *   re-flagged.
 */
export async function browserBody(
  url: string,
  status: number,
  opts: ResolveOptions,
  fallbackHtml: string,
  prior?: BlockVerdict,
): Promise<ResolvedBody> {
  const report = await (opts.probe ?? defaultProbe)(url, opts.proxyUrl);
  const html = report.html ?? fallbackHtml;
  const own = detectBlock({ html, isHtml: true });
  const inherit = prior !== undefined && isHeaderOnlyBlock(prior) && isThinHtml(html);
  const blocked = own ?? (inherit ? prior : null);
  return { status, url: report.url, html, text: report.text, isHtml: true, escalated: true, ...(blocked ? { blocked } : {}) };
}

/**
 * Return `r` as-is (annotated when it is an anti-bot block), or escalate to a
 * browser render when it's a thin SPA shell or an opted-in block.
 *
 * @param url - The URL to render if escalation triggers.
 * @param r - The HTTP fast-path response.
 * @param opts - Escalation toggle + proxy.
 * @returns The resolved body, with `escalated` set when a browser was used.
 */
export async function resolveFetchBody(url: string, r: FastResponse, opts: ResolveOptions = {}): Promise<ResolvedBody> {
  if (r.pdf) {
    // A PDF is never an interstitial nor an SPA shell: read its text layer, no escalation.
    const { text, pageCount, error } = await pdfToText(r.pdf.bytes, r.pdf.truncated);
    return { status: r.status, url: r.url, html: "", text, isHtml: false, escalated: false, pdf: { pageCount, error } };
  }
  const blocked = detectBlock({ status: r.status, headers: r.headers, html: r.html, isHtml: r.isHtml });
  const escalateBlock = blocked !== null && (Boolean(opts.browserFallback) || escalateBlockedByEnv());
  const escalateShell = Boolean(opts.browserFallback) && isThinShell(r.html);
  if (!escalateBlock && !escalateShell) {
    return { status: r.status, url: r.url, html: r.html, text: r.text, isHtml: r.isHtml, escalated: false, ...(blocked ? { blocked } : {}) };
  }
  return browserBody(url, r.status, opts, r.html, blocked ?? undefined);
}
