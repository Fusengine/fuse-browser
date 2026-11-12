/**
 * Execute an action on an element referenced by its `data-fuse-ref`
 * (produced by {@link captureSnapshot}). Deterministic counterpart to the
 * text/heuristic targeting of smart-click/smart-fill.
 * @module actions/act-by-ref
 */
import type { Locator, Page } from "playwright";
import type { ActionResult } from "../interfaces/types.js";
import { pickAutocomplete } from "./autocomplete.js";
import { isComboboxTrigger, openComboboxAndPick } from "./combobox.js";
import { fillRange, sliderKind } from "./fill-range.js";
import { dragLocator, hoverLocator } from "./hover-drag.js";
import { parseRef, refLocator } from "./ref-locator.js";
import { robustClick } from "./robust-click.js";
import { type FilesInput, setFiles } from "./upload.js";

/** Action kinds that can target a snapshot ref. */
export type RefActionKind = "click" | "fill" | "select" | "pick" | "upload" | "hover" | "drag";

/** Snapshot refs are numeric (`"5"` or frame-scoped `"3:4"`); anything else is a CSS selector. */
export function isRef(value: string): boolean {
  return /^\d+(:\d+)?$/.test(value);
}

/** Resolve a drag destination: a snapshot ref via {@link refLocator}, else a CSS selector. */
function destLocator(page: Page, to: string): Locator {
  return (isRef(to) ? refLocator(page, to) : null) ?? page.locator(to).first();
}

/**
 * Run `kind` on the element carrying the frame-scoped `ref`.
 *
 * @param page - Active Playwright page.
 * @param ref - Snapshot ref (bare or frame-scoped).
 * @param kind - Action to perform.
 * @param value - Text for fill/select/pick (ignored for click/upload).
 * @param option - Suggestion text for `pick`.
 * @param files - Paths for `upload` (string, CSV string, or array).
 * @param to - Destination ref/selector for `drag` (ref string/number or CSS selector).
 * @returns Action result tagged with the `ref`.
 */
export async function actByRef(
  page: Page,
  ref: string | number,
  kind: RefActionKind,
  value = "",
  option = "",
  files: FilesInput = "",
  to = "",
): Promise<ActionResult> {
  const locator = refLocator(page, ref);
  try {
    if (!locator || (await locator.count()) === 0) {
      return { type: kind, ok: false, ref, error: "ref_not_found" };
    }
    if (kind === "pick") {
      if (await isComboboxTrigger(locator)) return { ...(await openComboboxAndPick(page, locator, value, option || value)), ref };
      return { ...(await pickAutocomplete(page, locator, value, option)), ref };
    }
    if (kind === "upload") return { ...(await setFiles(locator, files)), ref };
    if (kind === "hover") return { ...(await hoverLocator(locator)), ref };
    if (kind === "drag") {
      return { ...(await dragLocator(locator, destLocator(page, to))), ref, to };
    }
    if (kind === "click") {
      // Frame-scoped refs ("<frame>:<local>") resolve outside the main frame
      // (parseRef's `frame` ordinal into `page.frames()`, main frame = 0) —
      // the hit-test's coordinate space only matches the main frame.
      const isMainFrame = parseRef(ref).frame === 0;
      const clicked = await robustClick(page, locator, 5_000, isMainFrame);
      if (!clicked.ok) return { type: kind, ok: false, ref, error: clicked.error ?? "click_failed" };
      return { type: kind, ok: true, ref, strategy: "ref", rung: clicked.rung };
    }
    if (kind === "fill") {
      const slider = await sliderKind(locator);
      if (slider) {
        const snapped = await fillRange(page, locator, value, slider);
        return { type: kind, ok: snapped.reached, ref, strategy: "range", value: snapped.value, reached: snapped.reached };
      }
      await locator.fill(value, { timeout: 5_000 });
    } else {
      await locator.selectOption(value, { timeout: 5_000 });
    }
    return { type: kind, ok: true, ref, strategy: "ref" };
  } catch (err) {
    return { type: kind, ok: false, ref, error: String(err).split("\n")[0] ?? "error" };
  }
}
