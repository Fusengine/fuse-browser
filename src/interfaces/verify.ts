/**
 * Types for `browser_verify`: the agent's expectations, the failures and the
 * evidence a verification returns.
 * @module interfaces/verify
 */

/** One expectation, supplied by the agent (no model decides anything). */
export type Expectation =
  | { text: string }
  | { visible: string }
  | { noConsoleErrors: true }
  | { noFailedRequests: true };

/** A failed expectation with a machine-readable reason. */
export interface VerifyFailure {
  expect: Record<string, unknown>;
  reason: string;
  /** Extra facts (failing URLs, console messages...). */
  detail?: unknown;
}

/** Pixel comparison of the verified page against the baseline. Informational: it never fails a verify. */
export interface DiffEvidence {
  /** Highlighted diff PNG (absent when the sizes differ). */
  image?: string;
  diffPixels: number;
  diffRatio: number;
  regions: number;
  changed: boolean;
  /** `dimension_mismatch` when the screenshots have different sizes (counts as changed). */
  error?: string;
}

/** Files written for one verification. */
export interface VerifyEvidence {
  /** The baseline screenshot used for the diff. */
  before?: string;
  after: string;
  diff?: DiffEvidence;
  consoleLog: string;
  networkLog: string;
  receiptMd: string;
}

/** How the page looks to the checks (browser access abstracted so the checks are unit-testable). */
export interface PageProbe {
  /** Visible text of the page body. */
  bodyText(): Promise<string>;
  /** State of the first element matching a CSS selector. */
  visibility(selector: string): Promise<"visible" | "hidden" | "missing" | "invalid">;
}

/** Log entries seen since the verification started. */
export interface VerifyLogs {
  network: Array<Record<string, unknown>>;
  console: Array<{ type: string; text: string }>;
  /** The default `patchright` engine disables the Console API upstream. */
  engine: string;
  /**
   * Every failed request seen during the verification (complete, no per-URL merge,
   * not subject to the session log cap). Absent when the page was not loaded by the
   * verification itself: then the session buffer is used.
   */
  failedRequests?: FailedRequest[];
  /** Uncaught exceptions / unhandled rejections seen during the verification. */
  pageErrors?: string[];
}

/** A request that failed: an HTTP status >= 400, or a network error. */
export interface FailedRequest {
  url: string;
  status?: number;
  error?: string;
}
