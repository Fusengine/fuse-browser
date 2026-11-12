/**
 * One "is this live page an anti-bot interstitial?" verdict for SESSION routes
 * (`browser_navigate`, `browser_extract`), consistent with the fast path's
 * `blocked` / `blockedBy` / `hint`. Detection only: it never solves or evades anything.
 * Combines the fast-path table detector (`net/block-detect`) on the rendered HTML with the
 * challenge evidence of `challenge-evidence`. A rendered page has no HTTP status or headers,
 * so only evidence that stands on its own counts (see {@link detectSessionBlock}).
 * @module extraction/challenge-verdict
 */
import type { Page } from "playwright";
import { logger } from "../lib/logger.js";
import { detectBlock } from "../net/block-detect.js";
import { THIN_TEXT_CHARS } from "../net/thin-shell.js";
import { type DomFlags, hasCloudflareChallenge, readDomFlags } from "./challenge-evidence.js";

/** The fields added to a session tool's output when the page is a challenge. */
export interface SessionBlock {
  blocked: true;
  /** `cloudflare | datadome | aws-waf | unknown`. */
  blockedBy: string;
  /** One-line, actionable next steps (real tool names; never a solver). */
  hint: string;
}

const HEADED = 'browser_open {headless:false, engine:"playwright", channel:"chrome"}';

/** Next steps for a blocked live page; names the human step only when a widget is on the page. */
function sessionBlockHint(vendor: string, humanStep: boolean): string {
  const who = vendor === "unknown" ? "unidentified vendor" : vendor;
  const base = `Blocked by an anti-bot interstitial (${who}) — this is not the page content. Wait a few seconds and call browser_extract again (some challenges clear on their own); if it persists, retry from a headed session: ${HEADED} → browser_navigate.`;
  return humanStep ? `${base} The page shows a human step (CAPTCHA/Turnstile): call browser_handoff so a person completes it.` : base;
}

/** Visible text of the page body (empty when there is none). */
async function bodyText(page: Page): Promise<string> {
  return (await page.evaluate("document.body ? document.body.innerText : ''").catch(() => "")) as string;
}

/** True when the page carries a human-step widget (captcha / Turnstile). */
function hasHumanStep(flags: DomFlags): boolean {
  return Boolean(flags.captchaWidget || flags.turnstile || flags.hcaptcha || flags.recaptcha);
}

/**
 * Decide whether the live page is an anti-bot interstitial.
 * - `cloudflare`: challenge marker in a script or a Cloudflare 1xxx block page;
 * - `aws-waf`: AWS WAF interstitial marker or `chal_t=` in the URL;
 * - on a THIN page only: the fast-path table (`datadome`, `cloudflare`, ...), or a bare
 *   captcha/Turnstile widget (`unknown`). A long page with a widget (a signup form) is not a block.
 *
 * The thin-page measure is always the full body text, so every session route agrees.
 * Any failure to inspect the page (navigation in flight, page closed) means "no verdict"
 * (tool output unchanged) and is logged once at warn level.
 *
 * @param page - The live page.
 * @returns The block fields to spread into the tool output, or `null` for a normal page.
 */
export async function detectSessionBlock(page: Page): Promise<SessionBlock | null> {
  try {
    return await decide(page);
  } catch (error) {
    logger.warn("session block check failed", { err: String(error) });
    return null;
  }
}

/** The verdict proper; may throw when the page cannot be inspected. */
async function decide(page: Page): Promise<SessionBlock | null> {
  const flags = await readDomFlags(page);
  const lowered = (await bodyText(page)).toLowerCase();
  let vendor: string | null = null;
  if (hasCloudflareChallenge(lowered, flags)) vendor = "cloudflare";
  else if (flags.awsWaf || page.url().includes("chal_t=")) vendor = "aws-waf";
  else if (lowered.length < THIN_TEXT_CHARS) {
    const verdict = detectBlock({ html: await page.content().catch(() => ""), isHtml: true });
    vendor = verdict?.vendor ?? (flags.widgetElement && flags.userInputs === 0 ? "unknown" : null);
  }
  if (!vendor) return null;
  return { blocked: true, blockedBy: vendor, hint: sessionBlockHint(vendor, hasHumanStep(flags)) };
}
