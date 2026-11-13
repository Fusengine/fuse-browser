/**
 * HTTP fast-path: fetch a URL with browser TLS/HTTP2 impersonation (impit) and
 * parse it server-side with linkedom — no browser launch. For server-rendered
 * HTML (price/index/SERP pages); JS/SPA pages still need `browser_probe`.
 * @module net/fetch-fast
 */
import { gunzipSync } from "node:zlib";
import { Impit } from "impit";
import { assertNetworkAllowed } from "./private-net-guard.js";
import { isPdf } from "./pdf-extract.js";
import { decodeCapped, readCappedBuffer } from "./read-body.js";

export { htmlToText, isHtmlContentType } from "./fetch-fast-text.js";
import { htmlToText, isHtmlContentType } from "./fetch-fast-text.js";

/** Hard cap on the downloaded body — guards against decompression bombs / runaway streams. */
const MAX_DOWNLOAD_BYTES = 10_485_760; // 10 MB

/** Content negotiation: prefer markdown (served verbatim), then HTML. */
const ACCEPT = "text/markdown, text/html, application/xhtml+xml, */*";

let shared: Impit | null = null;
function client(proxyUrl?: string): Impit {
  if (proxyUrl) return new Impit({ browser: "chrome", proxyUrl });
  shared ??= new Impit({ browser: "chrome" });
  return shared;
}

/** Per-call options of {@link fetchFast}. */
export interface FastOptions {
  /** Decompress a body that is gzip-compressed on disk (e.g. `sitemap.xml.gz`, served as `application/gzip`). Off by default. */
  gunzip?: boolean;
}

const isGzip = (b: Uint8Array): boolean => b[0] === 0x1f && b[1] === 0x8b;

/** Gunzip to UTF-8 text, output capped at 5x the download cap; "" if corrupt or over the cap. */
function gunzipText(b: Uint8Array): string {
  try {
    return gunzipSync(b, { maxOutputLength: MAX_DOWNLOAD_BYTES * 5 }).toString("utf8");
  } catch {
    return "";
  }
}

/** Result of a fast HTTP fetch. */
export interface FastResponse {
  status: number;
  url: string;
  html: string;
  text: string;
  /** Response `content-type` (lowercased, "" if absent). */
  contentType: string;
  /** Response headers, lowercase names (feeds anti-bot interstitial detection). */
  headers: Record<string, string>;
  /** Whether the body is HTML — drives markdown conversion vs. raw passthrough. */
  isHtml: boolean;
  /** Set (and `html`/`text` empty) when the body is a PDF: the raw bytes, to be read by `pdfToText`. */
  pdf?: { bytes: Uint8Array; truncated: boolean };
}

/**
 * Fetch `url` with Chrome impersonation; returns status, raw body, and body text.
 * Non-HTML payloads (JSON, plain text, …) are returned **verbatim** — running them
 * through the linkedom HTML parser would mangle them — so the fast-path also serves
 * JSON APIs. Callers must consult `isHtml` before any HTML→markdown conversion.
 *
 * Single choke point for every fast-path consumer (`browser_fetch`,
 * `browser_fetch_batch`, `browser_crawl`): `assertNetworkAllowed` is a no-op
 * unless `FUSE_BLOCK_PRIVATE_NETS=1` (see `net/private-net-guard.ts` for the
 * documented redirect/IP coverage gap).
 */
export async function fetchFast(url: string, proxyUrl?: string, opts: FastOptions = {}): Promise<FastResponse> {
  await assertNetworkAllowed(url);
  const res = await client(proxyUrl).fetch(url, { headers: { Accept: ACCEPT } });
  await assertNetworkAllowed(res.url || url);
  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
  const headers: Record<string, string> = {};
  res.headers.forEach((value: string, name: string) => {
    headers[name.toLowerCase()] = value;
  });
  const { buffer, truncated } = await readCappedBuffer(res, MAX_DOWNLOAD_BYTES);
  if (isPdf(contentType, buffer)) {
    // Binary: never decoded as text — `resolveFetchBody` turns it into page-marked text.
    return { status: res.status, url: res.url || url, html: "", text: "", contentType, headers, isHtml: false, pdf: { bytes: buffer, truncated } };
  }
  const body = opts.gunzip && isGzip(buffer) ? gunzipText(buffer) : decodeCapped(res, buffer, truncated);
  const isHtml = isHtmlContentType(contentType);
  // `text` is lazy + memoized: HTML→text parsing only runs if a consumer reads
  // it (e.g. extractPrices), so the common markdown path skips a linkedom parse.
  let textCache: string | undefined;
  return {
    status: res.status,
    url: res.url || url,
    html: body,
    contentType,
    headers,
    isHtml,
    get text(): string {
      return (textCache ??= isHtml ? htmlToText(body) : body);
    },
  };
}
