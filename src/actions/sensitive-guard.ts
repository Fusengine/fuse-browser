/**
 * Opt-in pause before destructive or paid clicks: when enabled (`confirmSensitive`
 * argument or `FUSE_CONFIRM_SENSITIVE=1`), a click whose live element name matches
 * the sensitive vocabulary returns `confirmation_required` WITHOUT acting; the
 * agent repeats the call with `confirmed:true`. Default off: no behaviour change.
 * @module actions/sensitive-guard
 */
import type { Locator, Page } from "playwright";
import type { ActionResult } from "../interfaces/types.js";
import { evalScript } from "../lib/evaluate.js";
import { probeLive } from "./ref-guard.js";
import { refLocator } from "./ref-locator.js";
import { resolveClickTarget } from "./resolve-click-target.js";
import { sensitiveCategory } from "./sensitive-vocab.js";

/** Whether the pause is on for this call. */
export function confirmEnabled(a: Record<string, unknown>): boolean {
  return a.confirmSensitive === true || process.env.FUSE_CONFIRM_SENSITIVE === "1";
}

/** Accessible name of a locator's live element (text, aria-label, value, title). */
async function liveName(locator: Locator): Promise<{ tag: string; role: string | null; text: string; value: string } | null> {
  const live = await probeLive(locator);
  if (!live) return null;
  const value = await locator.inputValue({ timeout: 500 }).catch(() => "");
  const text = live.title && !live.text.includes(live.title) ? `${live.text} ${live.title}`.trim() : live.text;
  return { tag: live.tag, role: live.role, text, value: live.tag === "input" ? value : "" };
}

/**
 * Check a click about to run. Returns a `confirmation_required` result to
 * return instead of acting, or `null` to proceed.
 *
 * @param a - Raw tool args (`ref` or `target`, `confirmSensitive`, `confirmed`).
 */
export async function sensitivePause(page: Page, a: Record<string, unknown>): Promise<ActionResult | null> {
  if (!confirmEnabled(a) || a.confirmed === true) return null;
  const hasRef = typeof a.ref === "number" || typeof a.ref === "string";
  const locator = hasRef
    ? refLocator(page, a.ref as string | number)
    : typeof a.target === "string"
      ? ((await resolveClickTarget(page, a.target))?.locator ?? null)
      : null;
  const live = locator ? await liveName(locator) : null;
  const label = `${live?.text ?? ""} ${live?.value ?? ""} ${hasRef ? "" : String(a.target ?? "")}`.trim();
  const category = sensitiveCategory(label);
  if (!category) return null;
  return required(String(a.kind ?? "click"), category, {
    tag: live?.tag ?? null,
    role: live?.role ?? null,
    text: live?.text || String(a.target ?? ""),
    ...(hasRef ? { ref: a.ref } : {}),
  });
}

/** The `confirmation_required` result (nothing was done). */
function required(type: string, category: string, element: Record<string, unknown>): ActionResult {
  return {
    type,
    ok: false,
    error: "confirmation_required",
    category,
    element,
    hint: "This control looks destructive or paid. Nothing was done. Re-call with confirmed:true if the owner intends it.",
  };
}

/** Browser script: label of the focused element (`null` when nothing is focused). */
const FOCUS_SCRIPT = `() => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const text = (el.innerText || el.getAttribute('aria-label') || el.value || '').trim().slice(0, 120);
  return { tag: el.tagName.toLowerCase(), role: el.getAttribute('role'), text: (text + ' ' + (el.getAttribute('title') || '')).trim() };
}`;

/** Keys that activate a focused button/link. */
const ACTIVATE_KEYS = new Set(["Enter", "NumpadEnter", " ", "Space"]);

/**
 * `browser_press` Enter/Space on a focused sensitive control (it clicks it) gets
 * the same opt-in pause as a click. Other keys, or nothing sensitive focused: `null`.
 */
export async function sensitivePressPause(page: Page, a: Record<string, unknown>): Promise<ActionResult | null> {
  if (!confirmEnabled(a) || a.confirmed === true || !ACTIVATE_KEYS.has(String(a.key ?? ""))) return null;
  const focused = await evalScript<{ tag: string; role: string | null; text: string } | null>(page, FOCUS_SCRIPT).catch(() => null);
  const category = focused ? sensitiveCategory(focused.text) : null;
  return focused && category ? required("press", category, focused) : null;
}
