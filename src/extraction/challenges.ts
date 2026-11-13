/**
 * Detection of anti-bot and authentication challenges. Flags fire on challenge
 * evidence (widgets, vendor markers, login-wall wording), not on a bare word in
 * the page content — see `challenge-evidence`.
 * @module extraction/challenges
 */
import type { Page } from "playwright";
import type { Challenges } from "../interfaces/extraction.js";
import { hasCloudflareChallenge, hasLoginWall, readDomFlags } from "./challenge-evidence.js";

/** Combine DOM and text signals to detect captcha, Cloudflare, login, OTP. */
export async function detectChallenges(page: Page, text: string): Promise<Challenges> {
  const lowered = text.toLowerCase();
  const flags = await readDomFlags(page);
  const captcha = Boolean(flags.captchaWidget || flags.recaptcha || flags.hcaptcha);
  return {
    captcha,
    turnstile: Boolean(flags.turnstile),
    hcaptcha: Boolean(flags.hcaptcha),
    cloudflare: hasCloudflareChallenge(lowered, flags),
    login: Boolean(flags.password || hasLoginWall(lowered)),
    otp:
      lowered.includes("one-time") ||
      lowered.includes("verification code") ||
      lowered.includes("code de vérification"),
    awsWaf: Boolean(flags.awsWaf || page.url().includes("chal_t=")),
  };
}
