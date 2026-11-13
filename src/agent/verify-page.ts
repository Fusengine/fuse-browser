/**
 * Page access for `browser_verify`: the probe the checks use, the navigation,
 * and a recorder of what the page did while it loaded (failed requests,
 * uncaught exceptions) that is complete and independent of the session log cap.
 * @module agent/verify-page
 */
import type { Page, Request, Response } from "playwright";
import type { FailedRequest, PageProbe } from "../interfaces/verify.js";
import { DEFAULT_GOTO, gotoWithRetry } from "../net/navigate.js";

/** Browser-backed probe for the checks. */
export function pageProbe(page: Page): PageProbe {
  return {
    bodyText: async () => (await page.evaluate("document.body ? document.body.innerText : ''").catch(() => "")) as string,
    visibility: async (selector) => {
      try {
        const loc = page.locator(selector).first();
        if ((await loc.count()) === 0) return "missing";
        return (await loc.isVisible()) ? "visible" : "hidden";
      } catch {
        return "invalid";
      }
    },
  };
}

/** Navigate like `browser_navigate` (retry, best-effort network idle). */
export async function loadPage(page: Page, url: string): Promise<void> {
  await gotoWithRetry(page, url, DEFAULT_GOTO);
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
}

/** What the page did while the verification loaded it. */
export interface Recorded {
  failed: FailedRequest[];
  pageErrors: string[];
}

/** Record failed requests (status >= 400, or a network error other than a cancel) and uncaught exceptions until `stop()`. */
export function recordPage(page: Page): { rec: Recorded; stop: () => void } {
  const rec: Recorded = { failed: [], pageErrors: [] };
  const onResponse = (r: Response): void => {
    if (r.status() >= 400) rec.failed.push({ url: r.url(), status: r.status() });
  };
  const onFailed = (r: Request): void => {
    const error = r.failure()?.errorText ?? "failed";
    if (!error.includes("ERR_ABORTED")) rec.failed.push({ url: r.url(), error });
  };
  const onError = (e: Error): void => void rec.pageErrors.push(e.message);
  page.on("response", onResponse);
  page.on("requestfailed", onFailed);
  page.on("pageerror", onError);
  return {
    rec,
    stop: () => {
      page.off("response", onResponse);
      page.off("requestfailed", onFailed);
      page.off("pageerror", onError);
    },
  };
}
