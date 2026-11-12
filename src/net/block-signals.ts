/**
 * Signal table for anti-bot interstitial detection. Data only — `detectBlock`
 * (net/block-detect.ts) holds the combination rules. A new vendor is one entry.
 *
 * Provenance of each strong signal:
 * - `cf-mitigated: challenge` — documented by Cloudflare ("Detect a Challenge Page
 *   response": set for every challenge page type; `challenge` is its only value).
 * - `x-amzn-waf-action: challenge|captcha` — documented by AWS WAF ("CAPTCHA and
 *   Challenge action behavior": HTTP 202 / 405 plus an interstitial script).
 * - `_cf_chl_opt = {` — the inline script assignment present in all three real
 *   Cloudflare challenge pages captured 2026-11-11 (matched as an ASSIGNMENT, so
 *   prose that merely names the option does not match); absent from the DataDome
 *   block page that only carries Cloudflare's `/cdn-cgi/challenge-platform/.../jsd/main.js`
 *   script (so that path is deliberately NOT a signal).
 * - `src="…captcha-delivery.com…"` — DataDome's challenge host loaded as a script/frame
 *   source; present in the real block page captured 2026-11-11 (g2.com), absent from a
 *   normal 200 DataDome-protected page captured the same day (hermes.com, which only
 *   carries the `x-datadome` header). A CSP meta or prose mentioning the host does not match.
 *
 * Weak signals count toward the quorum by DISTINCT hint: a phrase must live in exactly
 * one signal (e.g. "verify you are human" is a text hint only, not also a title hint).
 * @module net/block-signals
 */
import type { BlockSignal } from "../interfaces/block.js";

/** The default signal table. */
export const BLOCK_SIGNALS: readonly BlockSignal[] = [
  { id: "header:cf-mitigated", vendor: "cloudflare", kind: "header", strength: "strong", header: "cf-mitigated", pattern: /^challenge$/i },
  { id: "header:x-amzn-waf-action", vendor: "aws-waf", kind: "header", strength: "strong", header: "x-amzn-waf-action", pattern: /^(?:challenge|captcha)$/i },
  { id: "html:cf-chl-opt", vendor: "cloudflare", kind: "html", strength: "strong", pattern: /\b_cf_chl_opt\s*=\s*\{/ },
  { id: "html:captcha-delivery", vendor: "datadome", kind: "html", strength: "strong", pattern: /\bsrc=["'][^"']*captcha-delivery\.com/i },
  // Weak: only meaningful together (three distinct hints), and only on a thin non-2xx page.
  // `x-datadome` is on every response of a DataDome-protected site: attribution only.
  { id: "header:x-datadome", vendor: "datadome", kind: "header", strength: "weak", header: "x-datadome", pattern: /./, presenceOnly: true },
  { id: "html:meta-refresh", vendor: "generic", kind: "html", strength: "weak", pattern: /<meta[^>]+http-equiv=["']?refresh/i },
  {
    id: "title:challenge",
    vendor: "generic",
    kind: "title",
    strength: "weak",
    pattern: /^\s*(?:just a moment|checking your (?:connection|browser)|attention required|pardon our interruption|access denied|security check|one more step|robot check)/i,
  },
  {
    id: "text:js-required",
    vendor: "generic",
    kind: "text",
    strength: "weak",
    pattern: /enable javascript(?: and cookies)? to (?:continue|proceed)|please enable (?:js|javascript)|verify(?:ing)? you are (?:a )?human|unusual (?:activity|traffic)/i,
  },
];
