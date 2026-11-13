/**
 * Accessibility-style snapshot: tag each interactive element with a stable
 * `data-fuse-ref` and return an indexed list the LLM can reason about. The walk
 * runs in EVERY frame (`page.frames()`) and pierces open Shadow DOM, so refs
 * cover iframes (same- and cross-origin) and web components. Each element's
 * `ref` is frame-scoped (`"<frame>:<local>"`, bare `"<local>"` for the main
 * frame) and resolves via {@link refLocator}.
 * @module extraction/snapshot
 */
import type { Page } from "playwright";
import type { InteractiveElement } from "../interfaces/extraction.js";
import type { CapturedSnapshot } from "../interfaces/safe-actions.js";
import { evalScriptArg } from "../lib/evaluate.js";
import { MAX_PER_FRAME, SNAPSHOT_SCRIPT } from "./snapshot-walk.js";

export { REF_ATTRIBUTE } from "./snapshot-walk.js";

/** Soft cap on total elements across all frames, to bound output size. */
export const MAX_ELEMENTS = 400;

/**
 * Browser-returned element plus the internal `prunable` scratch flag (the C4
 * decision from `snapshot-hidden.ts`). Never exposed on the final {@link
 * InteractiveElement} output — used only to decide pruning, then stripped in
 * {@link captureSnapshot}.
 */
type RawElement = InteractiveElement & { prunable?: boolean };

/**
 * Whether a raw element survives pruning: kept unless `prune` is on AND the
 * element was flagged prunable (genuinely hidden, or decorative under an
 * `aria-hidden` ancestor and not focusable — see `snapshot-hidden.ts`).
 * A visible+focusable element under an `aria-hidden` ancestor (e.g. inside an
 * open modal dialog) is NOT prunable and is always kept. Exported for unit
 * testing.
 */
export function shouldKeep(prunable: boolean | undefined, prune: boolean): boolean {
  return !(prune && prunable === true);
}

/**
 * Capture the indexed interactive snapshot across all frames, tagging each
 * element with a (frame-local) ref attribute and exposing a frame-scoped `ref`.
 * Detached frames and frames that reject evaluation (e.g. mid-navigation) are
 * skipped rather than aborting the whole snapshot. When `prune` is `true`,
 * elements that are genuinely hidden (`Element.checkVisibility()` false —
 * `display:none`, `content-visibility:hidden`, `visibility:hidden`/`collapse`)
 * OR decorative under an `aria-hidden` ancestor (present but NOT focusable)
 * are dropped. A visible AND focusable element under an `aria-hidden`
 * ancestor — e.g. an open modal `<dialog>`/`[role=dialog]` whose SPA also
 * marks a sibling/root wrapper `aria-hidden` — is always kept. Default
 * `false` keeps the output identical to the pre-pruning behavior.
 */
export async function captureSnapshot(
  page: Page,
  selectors = false,
  prune = false,
): Promise<InteractiveElement[]> {
  return (await captureSnapshotFull(page, selectors, prune)).elements;
}

/** Ref id space reserved per tab of a session (the first tab snapshotted keeps ids from 0). */
export const REF_SPACE = 10_000_000;

const bases = new WeakMap<Page, number>();
const nextSlot = new WeakMap<object, number>();

/**
 * First ref id of a new document on `page`: a slot assigned once, in order of the
 * tab's first snapshot, times {@link REF_SPACE}. Slots are never reused (a closed
 * tab's slot stays taken), so two tabs of one session never share a ref number and
 * a ref copied from another tab cannot match here. Mocks without a context get 0.
 */
function pageRefBase(page: Page): number {
  const known = bases.get(page);
  if (known !== undefined) return known;
  let base = 0;
  try {
    const ctx = page.context();
    const slot = nextSlot.get(ctx) ?? 0;
    nextSlot.set(ctx, slot + 1);
    base = slot * REF_SPACE;
  } catch {
    // Page-like mock without a context: single namespace.
  }
  bases.set(page, base);
  return base;
}

/** Walk output of one frame (see `SNAPSHOT_SCRIPT`). */
interface FrameWalk {
  doc: string;
  els: Array<RawElement & { refId: string }>;
  dropped: number;
  matched?: number;
  scopeError?: string;
}

/** `within` argument as the walk takes it: a snapshot ref (frame ordinal + local id) or a CSS selector. */
type Within = { css: string } | { local: string };

/** Split `within` into a ref (`"5"`, `"3:4"`) with its frame ordinal, or a CSS selector. */
function parseWithin(within: string): { frame: number | null; within: Within } {
  if (/^\d+(:\d+)?$/.test(within)) {
    const sep = within.indexOf(":");
    return sep === -1
      ? { frame: 0, within: { local: within } }
      : { frame: Number(within.slice(0, sep)), within: { local: within.slice(sep + 1) } };
  }
  return { frame: null, within: { css: within } };
}

/**
 * Like {@link captureSnapshot} but also reports the per-frame document tokens
 * and the cap accounting (`truncated`, `dropped`): the caps (200 per frame, 400
 * in total) are no longer silent. Refs are stamped once per element, so a
 * re-capture never renumbers an element the agent already saw.
 *
 * @param within - Optional scope: a snapshot ref (its element and descendants) or a
 *   CSS selector (every match, in every frame). Absent = the whole page, unchanged.
 */
export async function captureSnapshotFull(
  page: Page,
  selectors = false,
  prune = false,
  within?: string,
): Promise<CapturedSnapshot> {
  const frames = page.frames();
  const base = pageRefBase(page);
  const all: InteractiveElement[] = [];
  const docs: Record<number, string> = {};
  const scoped = within === undefined ? null : parseWithin(within);
  const scope = scoped ? { matched: 0 } : undefined;
  let scopeError: string | undefined;
  let dropped = 0;
  let global = 0;
  for (let f = 0; f < frames.length; f++) {
    const frame = frames[f];
    if (!frame || frame.isDetached()) continue;
    if (scoped && scoped.frame !== null && scoped.frame !== f) continue;
    let walk: FrameWalk;
    try {
      const arg = {
        selectors,
        limit: Math.min(MAX_PER_FRAME, MAX_ELEMENTS - all.length),
        base,
        cap: base + REF_SPACE,
        ...(scoped ? { within: scoped.within } : {}),
      };
      walk = await evalScriptArg<FrameWalk, typeof arg>(frame, SNAPSHOT_SCRIPT, arg);
    } catch {
      continue;
    }
    if (!Array.isArray(walk?.els)) continue;
    docs[f] = walk.doc;
    dropped += walk.dropped;
    if (scope) scope.matched += walk.matched ?? 0;
    scopeError ??= walk.scopeError;
    for (const raw of walk.els) {
      const { prunable, refId, ...el } = raw;
      if (!shouldKeep(prunable, prune)) continue;
      el.ref = f === 0 ? refId : `${f}:${refId}`;
      if (f > 0) el.frame = f;
      el.index = global++;
      all.push(el);
    }
  }
  const snap: CapturedSnapshot = { elements: all, docs, truncated: dropped > 0, dropped };
  if (scope) snap.scope = scopeError ? { ...scope, error: scopeError } : scope;
  return snap;
}
