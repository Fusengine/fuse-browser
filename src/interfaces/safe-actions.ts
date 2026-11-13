/**
 * Types for the safe-actions layer: stale-ref identity, snapshot truncation,
 * effect report and the sensitive-click pause.
 * @module interfaces/safe-actions
 */
import type { InteractiveElement } from "./extraction.js";

/** What the agent saw for one ref, remembered to detect a node that changed under it. */
export interface RefIdentity {
  tag: string;
  role: string | null;
  id: string | null;
  name: string | null;
  type: string | null;
  href: string | null;
  text: string;
  /** Owning frame ordinal in `page.frames()` (0 = main). */
  frame: number;
}

/** Non-blocking signal: the referenced node is the same but its label changed. */
export interface RefNote {
  nameChanged: { from: string; to: string };
}

/** Result of one frame walk plus the page-wide cap accounting. */
export interface CapturedSnapshot {
  elements: InteractiveElement[];
  /** Per-frame document token (changes when the frame navigates / is replaced). */
  docs: Record<number, string>;
  /** True when a cap hid matching elements. */
  truncated: boolean;
  /** Matching elements not returned because of the caps (an upper bound: may include prunable ones). */
  dropped: number;
  /** Present for a scoped capture (`within`): how many scope roots matched, and a selector error. */
  scope?: { matched: number; error?: string };
}

/** Cheap post-action signals. `ok` of the action keeps its own meaning. */
export interface EffectReport {
  urlChanged: boolean;
  domChanged: boolean;
  /** Extra wait spent before the DOM was re-read (ms). */
  settleMs: number;
}

/** Sensitive-click vocabulary entry. */
export interface SensitiveRule {
  category: "destructive" | "payment";
  pattern: RegExp;
}
