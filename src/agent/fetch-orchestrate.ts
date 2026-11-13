/**
 * Orchestrate a single fetch-and-render pass: HTTP fast-path → optional
 * pre-fetch thin-shell escalation (`resolveFetchBody`) → Defuddle extraction
 * (`renderFetch`) → optional POST-extraction escalation when the fast path
 * came back empty on a JS-rendered shell (`shouldEscalateEmptyExtraction`).
 * Single source of truth shared by `browser_fetch` and `browser_fetch_batch`.
 * @module agent/fetch-orchestrate
 */
import type { BrowserProbe } from "../interfaces/block.js";
import { applyDocLadder } from "../net/doc-markdown.js";
import { fetchFast } from "../net/fetch-fast.js";
import { isEmptyExtraction, recoverFromRawText, shouldEscalateEmptyExtraction } from "./fetch-escalate.js";
import { passageFields, renderFetch, type RenderedFetch, type RenderFetchOptions } from "./fetch-render.js";
import { browserBody, resolveFetchBody, type ResolvedBody } from "./fetch-resolve.js";

/** Default `text` truncation, mirrors `renderFetch`'s own default. */
const DEFAULT_MAX_CHARS = 20_000;

/** Options for a full fetch-and-render pass (fast-path escalation + render options). */
export interface FetchAndRenderOptions extends RenderFetchOptions {
  browserFallback?: boolean;
  proxyUrl?: string;
  /** Also try the site's `.md` twin of the URL (see `net/doc-markdown`). */
  preferMarkdown?: boolean;
  /** Browser renderer override (tests); defaults to a Patchright probe. */
  probe?: BrowserProbe;
}

/** A resolved body plus its rendered result — `body` still exposes raw html/text for callers that also run price/contact extraction. */
export interface FetchAndRenderResult {
  body: ResolvedBody;
  rendered: RenderedFetch;
}

/**
 * Fetch `url` and render it, escalating to a real browser when needed.
 *
 * @param url - The URL to fetch.
 * @param opts - Escalation toggle + proxy + render options.
 * @returns The resolved body and its rendered result.
 */
export async function fetchAndRender(url: string, opts: FetchAndRenderOptions = {}): Promise<FetchAndRenderResult> {
  const main = await fetchFast(url, opts.proxyUrl);
  // Docs-native ladder: the site's own markdown, when it offers one (≤ 1 extra request).
  const { response: r, source } = await applyDocLadder(main, { preferMarkdown: opts.preferMarkdown, proxyUrl: opts.proxyUrl });
  let body = await resolveFetchBody(url, r, { browserFallback: opts.browserFallback, proxyUrl: opts.proxyUrl, probe: opts.probe });
  let rendered = await renderFetch(body, opts);
  if (shouldEscalateEmptyExtraction(opts.browserFallback, body.escalated, rendered, r.html)) {
    body = await browserBody(url, r.status, { proxyUrl: opts.proxyUrl, probe: opts.probe }, r.html);
    rendered = await renderFetch(body, opts);
    if (isEmptyExtraction(rendered)) {
      // Even a real browser render found nothing Defuddle could extract (e.g.
      // a dense e-commerce grid with no single content container) — ship the
      // browser's own raw text rather than near-empty markdown.
      const maxChars = typeof opts.maxChars === "number" ? opts.maxChars : DEFAULT_MAX_CHARS;
      rendered = { ...recoverFromRawText(rendered, body.text, maxChars), ...passageFields(body.text, opts) };
    }
  }
  return { body, rendered: source ? { ...rendered, source } : rendered };
}
