/**
 * Render a resolved fetch body to the public `{ status, url, format, escalated,
 * text }` shape — the single source of truth shared by `browser_fetch`, the
 * `fetch` CLI, and `browser_fetch_batch`. Markdown is produced only for HTML;
 * non-HTML (JSON, plain text) and `format:"text"` return the body verbatim.
 * The markdown branch also runs hollow-extraction recovery: when Defuddle
 * silently captures only a sliver of the page's real prose, the raw body
 * text is recovered instead (gated — see `extraction/serialize/recover.ts`).
 * @module agent/fetch-render
 */
import { rankPassages } from "../extraction/passages-bm25.js";
import { chooseRecovery } from "../extraction/serialize/recover.js";
import { htmlToMarkdown, renderMarkdown } from "../extraction/serialize/to-markdown.js";
import type { Passage } from "../interfaces/passages.js";
import type { PdfError } from "../interfaces/pdf.js";
import type { ExtractionKind } from "../interfaces/serialize.js";
import { blockHint } from "../net/block-detect.js";
import type { DocSource } from "../net/doc-markdown.js";
import type { ResolvedBody } from "./fetch-resolve.js";

/** Public, LLM-ready shape of a single fetch result. */
export interface RenderedFetch {
  status: number;
  url: string;
  format: "markdown" | "text";
  escalated: boolean;
  text: string;
  /** Defuddle's word count for the markdown content. Markdown branch only. */
  wordCount?: number;
  /** Which extraction path produced `text`. Markdown branch only. */
  extraction?: ExtractionKind;
  /** Present (always `true`) only when `text` is an anti-bot interstitial, not the page. */
  blocked?: true;
  /** Vendor slug of the interstitial (e.g. `"cloudflare"`, `"datadome"`, `"unknown"`). Only with `blocked`. */
  blockedBy?: string;
  /** One-line next step naming the fuse-browser tools to use. Only with `blocked`. */
  hint?: string;
  /** Page count of the whole PDF. Only when the body is a PDF that could be read. */
  pageCount?: number;
  /** Why a PDF body gave no text (`too_large` over the download cap, `unreadable` if corrupt/encrypted, `timeout` over the extraction budget, `memory` over `FUSE_PDF_MAX_MB`). PDF only. */
  pdfError?: PdfError;
  /** `"site-markdown"` when the site's own markdown was used; `"html"` when `preferMarkdown` found none. Set by `fetchAndRender`. */
  source?: DocSource;
  /** Best BM25 passages for `focus` (possibly empty). Only when `focus` was given. */
  passages?: Passage[];
}

/** `renderFetch` options: format/length + the `browser_fetch`-only content-selector escape hatch. */
export interface RenderFetchOptions {
  format?: string;
  maxChars?: number;
  contentSelector?: string;
  /** Question/keywords: return the best-matching passages of the page (BM25, model-free). Off when absent or blank. */
  focus?: string;
  /** Passages returned for `focus` (default 3). */
  topK?: number;
}

/** The `blocked`/`blockedBy`/`hint` fields for a blocked body; nothing at all otherwise (normal results stay byte-identical). */
function blockFields(body: ResolvedBody): Pick<RenderedFetch, "blocked" | "blockedBy" | "hint"> {
  if (!body.blocked) return {};
  return { blocked: true, blockedBy: body.blocked.vendor, hint: blockHint(body.blocked, body.escalated) };
}

/** `pageCount`/`pdfError` for a PDF body; nothing at all otherwise. */
function pdfFields(body: ResolvedBody): Pick<RenderedFetch, "pageCount" | "pdfError"> {
  if (!body.pdf) return {};
  return { ...(body.pdf.pageCount !== undefined ? { pageCount: body.pdf.pageCount } : {}), ...(body.pdf.error ? { pdfError: body.pdf.error } : {}) };
}

/**
 * `passages` for a `focus` query, ranked over the WHOLE page text (not the
 * `maxChars` slice); nothing at all without a non-blank `focus` (output stays
 * byte-identical).
 *
 * @param fullText - Untruncated markdown or plain text of the page.
 * @param opts - `focus` / `topK`.
 */
export function passageFields(fullText: string, opts: Pick<RenderFetchOptions, "focus" | "topK">): Pick<RenderedFetch, "passages"> {
  const focus = opts.focus?.trim();
  return focus ? { passages: rankPassages(fullText, focus, opts.topK) } : {};
}

/**
 * Render `body` to markdown or raw text.
 *
 * @param body - The resolved (possibly browser-escalated) body.
 * @param opts - `format` ("text" forces raw), `maxChars` (default 20000), and
 *   `contentSelector` (markdown branch only — bypasses Defuddle auto-detection).
 * @returns The rendered result.
 */
export async function renderFetch(body: ResolvedBody, opts: RenderFetchOptions = {}): Promise<RenderedFetch> {
  const max = typeof opts.maxChars === "number" ? opts.maxChars : 20_000;
  const format = opts.format === "text" || !body.isHtml ? "text" : "markdown";
  if (format === "text") {
    return { status: body.status, url: body.url, format, escalated: body.escalated, text: body.text.slice(0, max), ...blockFields(body), ...pdfFields(body), ...passageFields(body.text, opts) };
  }
  const doc = await htmlToMarkdown(body.html, { url: body.url, contentSelector: opts.contentSelector });
  const wordCount = doc.meta.wordCount ?? 0;
  const recovery = chooseRecovery({ html: body.html, c1Text: doc.markdown, wordCount, rawText: body.text });
  const text = renderMarkdown({ ...doc, markdown: recovery.text }, max);
  return { status: body.status, url: body.url, format, escalated: body.escalated, text, wordCount, extraction: recovery.extraction, ...blockFields(body), ...passageFields(recovery.text, opts) };
}
