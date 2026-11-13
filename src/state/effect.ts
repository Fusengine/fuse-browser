/**
 * Cheap effect report for an action: did the URL or the DOM change? Reuses the
 * DOM signature of the probe path. When nothing changed immediately, waits one
 * short tick so an async update is not mistaken for a no-op.
 * @module state/effect
 */
import type { Page } from "playwright";
import type { EffectReport } from "../interfaces/safe-actions.js";
import { domSignature } from "./dom-signature.js";

const TICK_MS = 150;

/** Signature, or `null` while the page is navigating / unreadable. */
async function sig(page: Page): Promise<string | null> {
  return domSignature(page).catch(() => null);
}

/**
 * Run `fn` and report its effect. `ok` of the action is untouched: this only
 * adds what happened on the page. `settle=false` skips the extra tick (used by
 * `browser_scroll` and `browser_wait`: a scroll rarely mutates the DOM by itself
 * and a wait already is the settle).
 */
export async function withEffect<T>(
  page: Page,
  fn: () => Promise<T>,
  settle = true,
): Promise<{ value: T; effect: EffectReport }> {
  const urlBefore = page.url();
  const before = await sig(page);
  const value = await fn();
  let after = await sig(page);
  let settleMs = 0;
  if (settle && after === before && page.url() === urlBefore) {
    await page.waitForTimeout(TICK_MS).catch(() => {});
    settleMs = TICK_MS;
    after = await sig(page);
  }
  const urlChanged = page.url() !== urlBefore;
  return { value, effect: { urlChanged, domChanged: after !== before, settleMs } };
}
