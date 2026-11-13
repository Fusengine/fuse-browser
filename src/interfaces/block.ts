/**
 * Types for anti-bot interstitial ("blocked response") detection on the HTTP
 * fast-path.
 * @module interfaces/block
 */

/** What a signal inspects: a response header value, the raw HTML, the `<title>`, or the visible text. */
export type BlockSignalKind = "header" | "html" | "title" | "text";

/**
 * `strong` signals are specific to a challenge page and decide on their own
 * (an HTML marker still needs a non-2xx status or thin text, see `detectBlock`);
 * `weak` signals only count together with each other on a thin, non-2xx page.
 */
export type BlockStrength = "strong" | "weak";

/** One row of the signal table — a new vendor is one more entry. */
export interface BlockSignal {
  /** Stable id, reported in {@link BlockVerdict.signals} (e.g. `header:cf-mitigated`). */
  id: string;
  /** Vendor slug reported as `blockedBy`; `"generic"` for vendor-agnostic signals. */
  vendor: string;
  kind: BlockSignalKind;
  strength: BlockStrength;
  /** Header name (lowercase) — required when `kind` is `"header"`. */
  header?: string;
  /** Tested against the header value / raw HTML / title / visible text. */
  pattern: RegExp;
  /**
   * The signal only says "this vendor is in front of the site" and appears on
   * NORMAL responses too (e.g. `x-datadome`). It may attribute `blockedBy` once
   * other signals decide, but never counts toward the weak-signal quorum.
   */
  presenceOnly?: boolean;
}

/** What `detectBlock` inspects. */
export interface BlockInput {
  /** HTTP status of the fast-path response; omit for a browser-rendered body (unknown). */
  status?: number;
  /** Response headers, lowercase names. */
  headers?: Record<string, string>;
  /** Raw response body. */
  html: string;
  /** False for JSON/plain-text bodies: only header signals apply. */
  isHtml: boolean;
}

/** A positive detection. */
export interface BlockVerdict {
  /** Vendor slug of the strongest evidence, or `"unknown"` when only generic signals matched. */
  vendor: string;
  /** Ids of every signal that matched. */
  signals: string[];
}

/** A rendered browser page, as `browser_fetch` escalation needs it. */
export interface BrowserProbeResult {
  url: string;
  html?: string;
  text: string;
}

/** Renders `url` in a real browser; injectable so escalation is testable without launching one. */
export type BrowserProbe = (url: string, proxyUrl?: string) => Promise<BrowserProbeResult>;
