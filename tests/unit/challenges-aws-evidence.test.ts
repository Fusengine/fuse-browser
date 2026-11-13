/**
 * `detectChallenges` on AWS WAF interstitials rendered in the DEFAULT engine
 * (patchright, where `page.evaluate` cannot see page globals). Fixtures are
 * synthetic, built from AWS's developer guide (see each file's header).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright";
import { resolveConfig } from "../../src/agent/config.js";
import { detectChallenges } from "../../src/extraction/challenges.js";
import { SessionManager } from "../../src/session/manager.js";

const sessions = new SessionManager();
let page: Page;
let sessionId = "";

beforeAll(async () => {
  const s = await sessions.open(resolveConfig({ headless: true, engine: "patchright" }));
  page = s.page;
  sessionId = s.id;
}, 120_000);
afterAll(async () => {
  await sessions.close(sessionId);
});

async function detect(html: string, status: number) {
  await page.unroute("**/*");
  await page.route("**/*", (r) =>
    r.request().resourceType() === "document" ? r.fulfill({ status, contentType: "text/html", body: html }) : r.abort(),
  );
  await page.goto("https://www.example.com/", { waitUntil: "domcontentloaded" });
  return detectChallenges(page, String(await page.evaluate("document.body ? document.body.innerText : ''")));
}

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dir, "../fixtures/challenges", `${name}.html`), "utf8");

/** The integration pattern AWS documents for NORMAL protected pages (waf-js-challenge-api-get-token.html). */
const NORMAL_SDK_PAGE =
  `<html><head><script src="https://0000.edge.sdk.awswaf.com/0000/0000/jsapi.js" defer></script></head><body>` +
  `<form id="login-form" action="/web/login" method="POST"><input type="text" name="u"><input type="password" name="p"></form>` +
  `<script>document.querySelector("#login-form").addEventListener("submit", (e) => { if (!AwsWafIntegration.hasToken()) { e.preventDefault(); AwsWafIntegration.getToken().then(() => e.target.submit()); } });</script></body></html>`;

describe("AWS WAF interstitials", () => {
  test("CAPTCHA (405) -> awsWaf and captcha", async () => {
    const c = await detect(fixture("aws-waf-captcha-synthetic"), 405);
    expect(c.awsWaf).toBe(true);
    expect(c.captcha).toBe(true);
  });

  test("CAPTCHA page whose text also says 'captcha' keeps captcha:true (HEAD behaviour)", async () => {
    const html = fixture("aws-waf-captcha-synthetic").replace("<h1>Solve the puzzle</h1>", "<h1>Please solve this CAPTCHA</h1>");
    expect((await detect(html, 405)).captcha).toBe(true);
  });

  test("Challenge (202) -> awsWaf, no captcha", async () => {
    const c = await detect(fixture("aws-waf-challenge-synthetic"), 202);
    expect(c.awsWaf).toBe(true);
    expect(c.captcha).toBe(false);
  });

  test("normal protected page embedding the integration SDK (jsapi.js, getToken/hasToken) -> awsWaf false", async () => {
    const c = await detect(NORMAL_SDK_PAGE, 200);
    expect(c.awsWaf).toBe(false);
    expect(c.captcha).toBe(false);
  });

  test("page rendering a customer-embedded AwsWafCaptcha puzzle -> captcha, but not an awsWaf block", async () => {
    const c = await detect(
      `<html><body><div id="c"></div><script>AwsWafCaptcha.renderCaptcha(document.querySelector("#c"), {apiKey: "k"});</script></body></html>`,
      200,
    );
    expect(c.captcha).toBe(true);
    expect(c.awsWaf).toBe(false);
  });

  test("article quoting the AWS WAF API names in a <pre> block -> no flag", async () => {
    const prose = "The committee reviewed the annual report and discussed the findings at length. ".repeat(12);
    const c = await detect(
      `<html><body><article><p>${prose}</p><pre>AwsWafCaptcha.renderCaptcha(el, {}); window.awsWafCookieDomainList = [];</pre></article></body></html>`,
      200,
    );
    expect(c.awsWaf).toBe(false);
    expect(c.captcha).toBe(false);
  });
});
