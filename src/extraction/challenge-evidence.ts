/**
 * Evidence for the challenge flags: a flag fires on what the page IS (a widget,
 * a challenge marker, a login wall), never on a word that merely appears in
 * content (an article, or a search result, that mentions Cloudflare).
 * The Cloudflare marker is the `html:cf-chl-opt` row of the fast-path signal
 * table, matched against `<script>` elements only (prose quoting it does not count).
 * @module extraction/challenge-evidence
 */
import type { Page } from "playwright";
import { evalScriptArg } from "../lib/evaluate.js";
import { BLOCK_SIGNALS } from "../net/block-signals.js";
import { THIN_TEXT_CHARS } from "../net/thin-shell.js";

/** DOM evidence read in one evaluate call. */
export interface DomFlags {
  /** Any vendor captcha widget (see {@link CAPTCHA_WIDGET_SELECTORS}) or a captcha form. */
  captchaWidget: boolean;
  /** A VISIBLE captcha/Turnstile widget element or iframe is on the page (invisible reCAPTCHA excluded). */
  widgetElement: boolean;
  /** Count of visitor-fillable fields (captcha response fields excluded). */
  userInputs: number;
  recaptcha: boolean;
  turnstile: boolean;
  hcaptcha: boolean;
  password: boolean;
  awsWaf: boolean;
  /** Cloudflare challenge marker (`_cf_chl_opt = {`) in a script, or live as a global. */
  cfChallenge: boolean;
}

/**
 * Selector table for the generic `captcha` flag: one row per vendor widget (element,
 * iframe, script or response field). Turnstile is deliberately absent (its own flag).
 * A new vendor is one more row.
 */
export const CAPTCHA_WIDGET_SELECTORS: readonly string[] = [
  ".g-recaptcha", 'iframe[src*="recaptcha"]', 'script[src*="google.com/recaptcha"]', 'textarea[name="g-recaptcha-response"]',
  ".h-captcha", 'iframe[src*="hcaptcha"]', 'script[src*="hcaptcha.com"]', 'textarea[name="h-captcha-response"]',
  'iframe[src*="arkoselabs"]', 'iframe[src*="funcaptcha"]', 'script[src*="arkoselabs.com"]', 'input[name="fc-token"]',
  'iframe[src*="captcha-delivery.com"]', 'script[src*="captcha-delivery.com"]',
  'script[src*="awswaf.com"][src*="captcha"]',
];

/**
 * AWS WAF interstitial marker read from `<script>` elements: `page.evaluate` cannot see page
 * globals on the default patchright engine (measured), so the global alone never fires there.
 * Deliberately NOT markers (AWS documents them for NORMAL protected pages, not only for the
 * interstitial): the integration SDK `AwsWafIntegration.getToken/hasToken/fetch` and its
 * `awswaf.com` `jsapi.js` script (waf-js-challenge-api-get-token.html). `AwsWafCaptcha.renderCaptcha`
 * is a customer-embedded puzzle API (waf-js-captcha-api-specification.html): it sets `captcha`, not `awsWaf`.
 * `awsWafCookieDomainList` is not in the docs fetched: kept from the previous detector (supposed).
 */
const AWS_WAF_SCRIPT_TEXT = "awsWafCookieDomainList";

/** A `<form>` showing a captcha image next to a text input (home-grown captchas). */
const CAPTCHA_FORM_IMG = 'img[src*="captcha" i], img[alt*="captcha" i], img[id*="captcha" i]';

/** Candidate captcha / Turnstile widget elements or iframes (a bare `<script>` tag is not one); filtered to VISIBLE, non-invisible ones in the script. */
const WIDGET_ELEMENTS =
  '.g-recaptcha, .h-captcha, .cf-turnstile, iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], iframe[src*="arkoselabs"], iframe[src*="funcaptcha"], iframe[src*="captcha-delivery.com"]';

/** Fields a visitor fills in, excluding captcha response fields: none on a bare interstitial. */
const USER_INPUTS =
  'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([name*="response" i]):not([name*="captcha" i]), textarea:not([name*="response" i]), select';

/** Widget / marker selectors only — no text. Argument: source of the Cloudflare marker pattern. */
const DOM_FLAGS_SCRIPT = `(cfMarker) => {
  const marker = new RegExp(cfMarker);
  const awsText = new RegExp(${JSON.stringify(AWS_WAF_SCRIPT_TEXT)});
  const inScripts = (re) => Array.from(document.scripts).some((s) => re.test(s.textContent || ""));
  return {
    captchaWidget:
      Boolean(document.querySelector(${JSON.stringify(CAPTCHA_WIDGET_SELECTORS.join(", "))})) ||
      inScripts(/AwsWafCaptcha/) ||
      Array.from(document.forms).some((f) => f.querySelector(${JSON.stringify(CAPTCHA_FORM_IMG)}) && f.querySelector('input[type="text"], input:not([type])')),
    widgetElement: Array.from(document.querySelectorAll(${JSON.stringify(WIDGET_ELEMENTS)})).some((el) => {
      // Invisible reCAPTCHA is not a human step: a <button class="g-recaptcha">, a v3 badge, size=invisible, or a zero-size frame.
      if (el.tagName === "BUTTON" || el.closest(".grecaptcha-badge") || el.getAttribute("data-size") === "invisible") return false;
      // A widget CONTAINER (div.cf-turnstile / .h-captcha / .g-recaptcha) counts even before its iframe renders.
      if (el.tagName !== "IFRAME") return true;
      if (/size=invisible/.test(el.getAttribute("src") || "")) return false;
      const r = el.getBoundingClientRect();
      return r.width > 2 && r.height > 2;
    }),
    userInputs: document.querySelectorAll(${JSON.stringify(USER_INPUTS)}).length,
    recaptcha: Boolean(document.querySelector('.g-recaptcha, iframe[src*="recaptcha"]')),
    turnstile: Boolean(document.querySelector('input[name="cf-turnstile-response"], .cf-turnstile, iframe[src*="turnstile"], script[src*="challenges.cloudflare.com/turnstile"]')),
    hcaptcha: Boolean(document.querySelector('.h-captcha, iframe[src*="hcaptcha"]')),
    password: Boolean(document.querySelector('input[type="password"], input[autocomplete="username"]')),
    awsWaf: Boolean(window.awsWafCookieDomainList) || inScripts(awsText),
    cfChallenge: Boolean(window._cf_chl_opt) || inScripts(marker),
  };
}`;

const CF_MARKER = BLOCK_SIGNALS.find((s) => s.id === "html:cf-chl-opt")?.pattern.source ?? "_cf_chl_opt\\s*=\\s*\\{";

/** Read the DOM evidence of `page`. */
export function readDomFlags(page: Page): Promise<DomFlags> {
  return evalScriptArg<DomFlags, string>(page, DOM_FLAGS_SCRIPT, CF_MARKER);
}

/** Phrases of a login WALL ("sign in to continue"); a bare "Sign in" nav link is not one. */
const LOGIN_WALL =
  /\b(?:sign|log)[\s-]?in\s+(?:to|with|or|required)\b|\bplease\s+(?:sign|log)[\s-]?in\b|\byou\s+(?:must|need\s+to)\s+(?:be\s+)?(?:signed|logged)[\s-]?in\b/;

/** True when the (lowercased) page text reads as a login wall. */
export function hasLoginWall(lowered: string): boolean {
  return LOGIN_WALL.test(lowered);
}

/**
 * Text evidence of a Cloudflare page, evaluated on a THIN page only (a block page
 * is small; a long article quoting these words never qualifies). Every pattern of a
 * rule must match. Cloudflare's docs state that 1xxx errors render in the HTML body
 * and show the visitor the error code and a Ray ID
 * (support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1020/);
 * they publish no default-page markup, so these are text rules, not selectors.
 */
const CF_THIN_TEXT_RULES: readonly (readonly RegExp[])[] = [
  [/checking if the site connection is secure/],
  [/\berror\s+10(?:0\d|1[0-5]|20)\b/, /\bray id\b/],
];

/**
 * True on Cloudflare challenge/block evidence: the `_cf_chl_opt` marker (script
 * or global), or a thin page matching a {@link CF_THIN_TEXT_RULES} rule.
 */
export function hasCloudflareChallenge(lowered: string, flags: DomFlags): boolean {
  if (flags.cfChallenge) return true;
  return lowered.length < THIN_TEXT_CHARS && CF_THIN_TEXT_RULES.some((rule) => rule.every((p) => p.test(lowered)));
}
