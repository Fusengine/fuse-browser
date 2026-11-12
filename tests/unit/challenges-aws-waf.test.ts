import { describe, expect, test } from "bun:test";
import type { Page } from "playwright";
import { detectChallenges } from "../../src/extraction/challenges.js";

const noFlags = { recaptcha: false, turnstile: false, hcaptcha: false, password: false, awsWaf: false };

/** A page stub: `evaluate` returns canned DOM flags, `url()` is configurable. */
function makePage(url: string, flags = noFlags): Page {
  return { url: () => url, evaluate: async () => flags } as unknown as Page;
}

describe("detectChallenges — awsWaf (additive)", () => {
  test("true when the URL carries a chal_t= query param", async () => {
    const page = makePage("https://www.booking.com/searchresults.html?chal_t=abc123");
    const result = await detectChallenges(page, "");
    expect(result.awsWaf).toBe(true);
  });

  test("true when window.awsWafCookieDomainList is set (DOM flag)", async () => {
    const page = makePage("https://example.com/", { ...noFlags, awsWaf: true });
    const result = await detectChallenges(page, "");
    expect(result.awsWaf).toBe(true);
  });

  test("false when neither signal is present", async () => {
    const page = makePage("https://example.com/");
    const result = await detectChallenges(page, "");
    expect(result.awsWaf).toBe(false);
  });

  test("existing fields keep working unchanged (regression guardrail)", async () => {
    const page = makePage("https://example.com/");
    const result = await detectChallenges(page, "Please solve the captcha to continue");
    expect(result.captcha).toBe(false); // a word is not a widget (evidence-based since 2026-11-11)
    const withWidget = await detectChallenges(makePage("https://example.com/", { ...noFlags, recaptcha: true }), "");
    expect(withWidget.captcha).toBe(true);
    expect(result.awsWaf).toBe(false);
  });
});
