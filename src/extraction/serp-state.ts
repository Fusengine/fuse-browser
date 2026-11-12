/**
 * Explain why a Google SERP yielded zero organic results, so an empty list is
 * never silent. Detection only (URL + DOM presence), no evasion.
 * @module extraction/serp-state
 */
import type { Page } from "playwright";
import type { SerpWarning } from "../interfaces/serp.js";
import { evalScript } from "../lib/evaluate.js";

const STATE_SCRIPT = `() => ({
  captcha: Boolean(document.querySelector('.g-recaptcha, iframe[src*="recaptcha"]')),
  consentForm: Boolean(document.querySelector('form[action*="consent.google"]')),
})`;

interface PageState {
  captcha: boolean;
  consentForm: boolean;
}

/**
 * Classify an empty SERP page.
 * - `blocked`: Google `/sorry/` interstitial or a reCAPTCHA on the page;
 * - `consent_wall`: a `consent.google.*` page or consent form;
 * - `no_results_extracted`: anything else (layout drift, or a query with no hits).
 *
 * @param page - The page whose extraction returned no organic result.
 */
export async function classifyEmptySerp(page: Page): Promise<SerpWarning> {
  let host = "";
  let path = "";
  try {
    const u = new URL(page.url());
    host = u.hostname;
    path = u.pathname;
  } catch {
    // unparseable URL: fall through to DOM signals
  }
  const state = await evalScript<PageState>(page, STATE_SCRIPT).catch(() => ({ captcha: false, consentForm: false }));
  if (path.startsWith("/sorry") || state.captcha) return "blocked";
  if (host.startsWith("consent.google.") || state.consentForm) return "consent_wall";
  return "no_results_extracted";
}
