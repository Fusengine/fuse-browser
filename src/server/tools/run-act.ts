/**
 * `browser_act` dispatch: run the chosen action (by `ref` or text `target`),
 * with site-memory assist. Extracted from snapshot.ts to keep both < 90 lines.
 * @module server/tools/run-act
 */
import type { Page } from "playwright";
import { z } from "zod";
import { actByRef, isRef, type RefActionKind } from "../../actions/act-by-ref.js";
import { guardRef } from "../../actions/ref-guard.js";
import { sensitivePause } from "../../actions/sensitive-guard.js";
import { pickAutocomplete } from "../../actions/autocomplete.js";
import { isComboboxTrigger, openComboboxAndPick } from "../../actions/combobox.js";
import { drag, hover } from "../../actions/hover-drag.js";
import { resolveClickTarget } from "../../actions/resolve-click-target.js";
import { smartClick } from "../../actions/smart-click.js";
import { smartFill } from "../../actions/smart-fill.js";
import { type FilesInput, uploadFiles } from "../../actions/upload.js";
import type { RefNote } from "../../interfaces/safe-actions.js";
import type { ActionResult } from "../../interfaces/types.js";
import { runWithMemory } from "../../state/action-memory.js";

/** Allowed `browser_act` kinds. */
export const KIND = z.enum(["click", "fill", "select", "pick", "upload", "hover", "drag"]);

/**
 * Stale-ref check for the `ref` (and a drag destination `to`) of a `browser_act`
 * call. Must run BEFORE any snapshot walk: a walk renumbers duplicate stamps.
 *
 * @returns A `ref_stale` result to return instead of acting, or `null`.
 */
export async function guardActRefs(
  page: Page,
  a: Record<string, unknown>,
): Promise<{ stale: ActionResult | null; note?: RefNote }> {
  if (typeof a.ref !== "number" && typeof a.ref !== "string") return { stale: null };
  const to = a.to ? String(a.to) : "";
  let note: RefNote | undefined;
  const keep = (n: RefNote): void => {
    note ??= n;
  };
  const stale = (await guardRef(page, a.ref, keep)) ?? (a.kind === "drag" && isRef(to) ? await guardRef(page, to, keep) : null);
  return { stale: stale ? { ...stale, type: String(a.kind) } : null, note };
}

/**
 * Run the chosen action (by `ref` or text fallback), with site-memory assist.
 *
 * @param page - Active Playwright page.
 * @param a - Raw tool args (`kind`, `ref`/`target`, `value`, `option`, `files`).
 * @param human - Whether human-like cursor motion is enabled.
 * @param dir - Site-memory directory for strategy recall.
 * @returns Action result, or `null` when neither `ref` nor `target` is given.
 */
export async function runAct(
  page: Page,
  a: Record<string, unknown>,
  human: boolean,
  dir: string,
): Promise<ActionResult | null> {
  const kind = a.kind as RefActionKind;
  const value = a.value ? String(a.value) : "";
  const option = a.option ? String(a.option) : "";
  const to = a.to ? String(a.to) : "";
  const files = (a.files ?? a.value ?? "") as FilesInput;
  if (typeof a.ref === "number" || typeof a.ref === "string") {
    const pause = kind === "click" ? await sensitivePause(page, a) : null;
    return pause ?? actByRef(page, a.ref, kind, value, option, files, to);
  }
  if (typeof a.target !== "string") return null;
  const target = a.target;
  if (kind === "click") {
    const pause = await sensitivePause(page, a);
    if (pause) return pause;
  }
  if (kind === "pick") {
    // Resolve through the same text/heuristic resolver as smart-click (not a
    // raw CSS selector): a human-readable target (e.g. "Où allez-vous ?")
    // throws "Unexpected token" when parsed as CSS by `page.locator()`.
    const resolved = (await resolveClickTarget(page, target)) ?? { locator: page.locator(target).first(), strategy: "selector" };
    if (await isComboboxTrigger(resolved.locator)) return openComboboxAndPick(page, resolved.locator, value, option || value);
    return pickAutocomplete(page, resolved.locator, value, option);
  }
  if (kind === "upload") return uploadFiles(page, target, files);
  if (kind === "hover") return hover(page, target);
  if (kind === "drag") return drag(page, target, to);
  return runWithMemory(dir, page, { type: kind, target }, (act) => {
    const pref = String(act.preferredStrategy ?? "");
    return kind === "fill" ? smartFill(page, target, value, pref, human) : smartClick(page, target, pref, human);
  });
}
