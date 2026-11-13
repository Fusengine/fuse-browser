/**
 * Per-page memory of what the agent was shown for each ref, so an action can
 * refuse (`ref_stale`) instead of acting on another element when the page moved.
 * Keyed by page: a new tab, a recovered page or a navigation starts clean.
 * @module actions/ref-registry
 */
import type { Page } from "playwright";
import type { InteractiveElement } from "../interfaces/extraction.js";
import type { CapturedSnapshot, RefIdentity } from "../interfaces/safe-actions.js";

/** Identity of an element as listed in a snapshot. */
export function identityOf(el: InteractiveElement): RefIdentity {
  return {
    tag: el.tag,
    role: el.role,
    id: el.id,
    name: el.name,
    type: el.type,
    href: el.href,
    text: el.text,
    frame: el.frame ?? 0,
  };
}

/** Refs the agent has been shown on one page, with the document token per frame. */
export class RefRegistry {
  /** Bumped by every agent-facing snapshot; 0 = none taken yet. */
  generation = 0;
  private entries = new Map<string, RefIdentity>();
  private docs = new Map<number, string>();

  /** An agent-facing snapshot: replaces everything and starts a new generation. */
  begin(snap: Pick<CapturedSnapshot, "elements" | "docs">): number {
    this.entries.clear();
    this.docs.clear();
    this.generation += 1;
    this.merge(snap);
    return this.generation;
  }

  /**
   * A scoped agent-facing snapshot (`within`): keeps every ref already accepted,
   * refreshes those it lists, and starts a new generation (a first snapshot behaves
   * like {@link begin}).
   */
  refresh(snap: Pick<CapturedSnapshot, "elements" | "docs">): number {
    if (!this.active) return this.begin(snap);
    const before = this.generation;
    this.merge(snap);
    if (this.generation === before) this.generation += 1;
    return this.generation;
  }

  /**
   * Register refs shown by `browser_find`: added to the accepted set. The
   * generation moves only if a frame's document changed since (ref numbers then
   * mean other elements).
   */
  add(snap: Pick<CapturedSnapshot, "elements" | "docs">): number {
    if (!this.active) return this.begin(snap);
    this.merge(snap);
    return this.generation;
  }

  /** Add refs the agent was shown outside a snapshot (diff.added, annotate marks). */
  merge(snap: Pick<CapturedSnapshot, "elements" | "docs">): void {
    for (const [frame, doc] of Object.entries(snap.docs)) {
      const f = Number(frame);
      const known = this.docs.get(f);
      if (known === doc) continue;
      // A frame whose document was replaced: its old numbers mean other elements now.
      if (known !== undefined) this.generation += 1;
      for (const [ref, id] of this.entries) if (id.frame === f) this.entries.delete(ref);
      this.docs.set(f, doc);
    }
    for (const el of snap.elements) if (el.ref !== undefined) this.entries.set(el.ref, identityOf(el));
  }

  /** Whether any agent-facing snapshot exists for this page. */
  get active(): boolean {
    return this.generation > 0;
  }

  /** Remembered identity for a ref. */
  get(ref: string): RefIdentity | undefined {
    return this.entries.get(ref);
  }

  /** Document token remembered for a frame ordinal. */
  docOf(frame: number): string | undefined {
    return this.docs.get(frame);
  }
}

const registries = new WeakMap<Page, RefRegistry>();

/** The registry of a page (created on first use). */
export function registryFor(page: Page): RefRegistry {
  let reg = registries.get(page);
  if (!reg) {
    reg = new RefRegistry();
    registries.set(page, reg);
  }
  return reg;
}
