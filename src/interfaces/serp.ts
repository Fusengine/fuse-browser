/**
 * Types for Google SERP parsing and rank tracking.
 * @module interfaces/serp
 */

/** A single Google SERP entry (organic result or ad). */
export interface SerpResult {
  position: number;
  title: string;
  url: string;
  displayUrl?: string;
  snippet?: string;
  /**
   * True when `url` is a Google redirect wrapper (`google.com/goto?url=<opaque>`),
   * not the destination: the destination is not in the DOM. `displayUrl` is the
   * (possibly abbreviated) breadcrumb Google shows. Following the wrapper reaches the destination.
   */
  redirect?: boolean;
}

/** Why a SERP came back with zero results (never silent). */
export type SerpWarning = "no_results_extracted" | "consent_wall" | "blocked";

/** Where a domain ranks within a SERP. */
export interface DomainRank {
  domain: string;
  organic: number[];
  ads: number[];
  best: number | null;
  found: boolean;
}

/** Parsed Google search results page. */
export interface Serp {
  organic: SerpResult[];
  ads: SerpResult[];
  related: string[];
  rank?: DomainRank;
  /** Set only when no organic result was extracted. */
  warning?: SerpWarning;
}

/** One query's outcome in a SERP batch. */
export interface SerpBatchRow {
  query: string;
  rank?: DomainRank;
  results: SerpResult[];
  error?: string;
  /** Set only when `results` is empty without an `error`. */
  warning?: SerpWarning;
}
