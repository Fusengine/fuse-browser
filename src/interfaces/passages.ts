/**
 * Types for model-free passage retrieval (`browser_fetch {focus, topK}`).
 * @module interfaces/passages
 */

/** A passage candidate: its nearest heading and its text (before scoring). */
export interface PassageChunk {
  heading: string;
  text: string;
}

/** One ranked passage of a page. */
export interface Passage {
  /** Nearest heading above the passage ("" before the first heading). */
  heading: string;
  text: string;
  /** BM25 score (> 0; higher is more relevant). */
  score: number;
}
