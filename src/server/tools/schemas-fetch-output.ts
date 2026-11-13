/**
 * Shared zod `outputSchema` pieces for the HTTP fast-path fetch result,
 * reused by the fetch, fetch-batch, and crawl tool outputs.
 * @module server/tools/schemas-fetch-output
 */
import { z } from "zod";
import { DOC_SOURCES } from "../../net/doc-markdown.js";
import { PDF_ERRORS } from "../../interfaces/pdf.js";

/** A single rendered fetch (matches `agent/fetch-render.ts#RenderedFetch`). */
export const renderedFetchSchema = z.object({
  status: z.number(),
  url: z.string(),
  format: z.enum(["markdown", "text"]),
  escalated: z.boolean(),
  text: z.string(),
  /** Defuddle's word count for the markdown content. Markdown branch only. */
  wordCount: z.number().optional(),
  /** Which extraction path produced `text`. Markdown branch only. */
  extraction: z.enum(["primary", "recovered"]).optional(),
  /** Present (`true`) only when `text` is an anti-bot interstitial, not the page. */
  blocked: z.literal(true).optional(),
  /** Vendor slug of the interstitial (`cloudflare`, `datadome`, `aws-waf`, `unknown`). Only with `blocked`. */
  blockedBy: z.string().optional(),
  /** Next fuse-browser tools to use. Only with `blocked`. */
  hint: z.string().optional(),
  /** Page count of the whole PDF (the `text` carries `<!-- page N -->` markers). PDF responses only. */
  pageCount: z.number().optional(),
  /** Why a PDF gave no text: `too_large` (over the 10 MB download cap), `unreadable`, `timeout` (extraction budget exceeded), or `memory` (over `FUSE_PDF_MAX_MB`). PDF responses only. */
  pdfError: z.enum(PDF_ERRORS).optional(),
  /** `site-markdown`: the site's own markdown was used (Accept / Link alternate / `.md` twin); `html`: preferMarkdown found none. */
  source: z.enum(DOC_SOURCES).optional(),
  /** Best passages for `focus` (BM25 over the whole page; empty when nothing matches). Only when `focus` was given. */
  passages: z.array(z.object({ heading: z.string(), text: z.string(), score: z.number() })).optional(),
});

/** A batch/crawl entry that failed instead of resolving. */
export const urlErrorSchema = z.object({ url: z.string(), error: z.string() });

/** A crawled page (matches `agent/crawl.ts#CrawlPage`). */
export const crawlPageSchema = renderedFetchSchema.extend({ depth: z.number() });
