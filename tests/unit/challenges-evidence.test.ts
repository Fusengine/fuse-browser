/**
 * `detectChallenges` on real rendered pages (real Chromium, no network): flags
 * must fire on challenge evidence, not on a word in content.
 * False-positive matrix: prose naming Cloudflare/Turnstile/hCaptcha, a "Sign in"
 * nav link, a real Google results page. True-positive matrix: real captured
 * blocked pages, a Turnstile widget, an hCaptcha widget, login walls.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright";
import { resolveConfig } from "../../src/agent/config.js";
import { detectChallenges } from "../../src/extraction/challenges.js";
import { SessionManager } from "../../src/session/manager.js";
import type { Challenges } from "../../src/interfaces/extraction.js";

const FIX = join(import.meta.dir, "../fixtures");
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

/** Render `html` as the document of `url` (sub-resources aborted) and run the detector on it. */
async function detect(html: string, url = "https://www.example.com/page", status = 200): Promise<Challenges> {
  await page.unroute("**/*");
  await page.route("**/*", (route) =>
    route.request().resourceType() === "document"
      ? route.fulfill({ status, contentType: "text/html; charset=utf-8", body: html })
      : route.abort(),
  );
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const text = await page.evaluate("document.body ? document.body.innerText : ''");
  return detectChallenges(page, String(text));
}

const PROSE = "The committee reviewed the annual report and discussed the findings at length. ".repeat(12);
const captured = (name: string): { html: string; status: number } =>
  JSON.parse(readFileSync(join(FIX, "blocked", `${name}.json`), "utf8"));
const googleResults = readFileSync(join(FIX, "serp/google-results-2026-11-11.html"), "utf8");

describe("false positives: a word in content is not a challenge", () => {
  test("article that discusses Cloudflare, Turnstile and hCaptcha", async () => {
    const c = await detect(
      `<html><body><article><p>${PROSE}</p><p>Cloudflare shipped Turnstile, an alternative to hCaptcha, last year.</p></article></body></html>`,
    );
    expect(c.cloudflare).toBe(false);
    expect(c.turnstile).toBe(false);
    expect(c.hcaptcha).toBe(false);
  });

  test("article quoting the Cloudflare challenge snippet in a <pre> block", async () => {
    const c = await detect(`<html><body><article><p>${PROSE}</p><pre>window._cf_chl_opt = {cvId: '3'};</pre></article></body></html>`);
    expect(c.cloudflare).toBe(false);
  });

  test("prose naming captcha vendors and 'I'm not a robot' sets no captcha flag", async () => {
    const c = await detect(
      `<html><body><article><p>${PROSE}</p><p>reCAPTCHA, hCaptcha, FunCaptcha and a captcha image: click "I'm not a robot".</p></article></body></html>`,
    );
    expect(c.captcha).toBe(false);
    expect(c.hcaptcha).toBe(false);
  });

  test("a <form> with an unrelated image and a text input is not a captcha form", async () => {
    const c = await detect(`<html><body><form><img src="/logo.png" alt="logo"><input type="text" name="q"></form></body></html>`);
    expect(c.captcha).toBe(false);
  });

  test("long article quoting 'Error 1020' and 'Ray ID' in prose", async () => {
    const c = await detect(
      `<html><body><article><p>${PROSE}</p><p>Visitors who see Error 1020: Access denied should note the Ray ID and contact the site owner.</p></article></body></html>`,
    );
    expect(c.cloudflare).toBe(false);
  });

  test("short page mentioning only 'Ray ID' (no Cloudflare error code) or only an error code", async () => {
    expect((await detect(`<html><body><p>Ray ID is a tracing concept.</p></body></html>`)).cloudflare).toBe(false);
    expect((await detect(`<html><body><h1>Error 1020</h1><p>Invalid part number.</p></body></html>`)).cloudflare).toBe(false);
  });

  test("page with a 'Sign in' / 'Log in' nav link is not a login wall", async () => {
    const c = await detect(
      `<html><body><nav><a href="/signin">Sign in</a> <a href="/login">Log in</a></nav><article><p>${PROSE}</p></article></body></html>`,
    );
    expect(c.login).toBe(false);
  });

  test("real Google results page (Sign in link, results naming Cloudflare)", async () => {
    const withMention = googleResults.replace("</body>", "<p>Cloudflare Turnstile hCaptcha announcement</p></body>");
    const c = await detect(withMention, "https://www.google.com/search?q=x&hl=en");
    expect(c.cloudflare).toBe(false);
    expect(c.turnstile).toBe(false);
    expect(c.hcaptcha).toBe(false);
    expect(c.login).toBe(false);
  });
});

describe("true positives: challenge evidence", () => {
  for (const name of ["cloudflare-just-a-moment-stockx", "cloudflare-managed-miraheze", "cloudflare-security-glassdoor"]) {
    test(`real captured Cloudflare page ${name} -> cloudflare`, async () => {
      const f = captured(name);
      expect((await detect(f.html, "https://www.example.com/", f.status)).cloudflare).toBe(true);
    });
  }

  for (const name of ["cloudflare-error-1020-synthetic", "cloudflare-error-1015-synthetic"]) {
    test(`Cloudflare hard-block error page ${name} (no _cf_chl_opt) -> cloudflare`, async () => {
      const html = readFileSync(join(FIX, "challenges", `${name}.html`), "utf8");
      expect((await detect(html, "https://www.example.com/", 403)).cloudflare).toBe(true);
    });
  }

  test("real captured DataDome page is not reported as Cloudflare", async () => {
    const f = captured("datadome-g2");
    expect((await detect(f.html, "https://www.example.com/", f.status)).cloudflare).toBe(false);
  });

  const CAPTCHA_WIDGETS: Record<string, string> = {
    "reCAPTCHA v2 widget": `<form><div class="g-recaptcha" data-sitekey="k"></div><textarea name="g-recaptcha-response"></textarea></form>`,
    "reCAPTCHA iframe": `<iframe src="https://www.google.com/recaptcha/api2/anchor?k=x"></iframe>`,
    "Arkose / FunCaptcha iframe": `<iframe src="https://client-api.arkoselabs.com/fc/gc/?x=1"></iframe>`,
    "DataDome captcha-delivery iframe": `<iframe src="https://geo.captcha-delivery.com/captcha/?x=1"></iframe>`,
    "generic form with captcha image and text input": `<form><img src="/captcha.php?id=3" alt="code"><input type="text" name="code"></form>`,
  };
  for (const [label, markup] of Object.entries(CAPTCHA_WIDGETS)) {
    test(`${label} -> captcha`, async () => {
      expect((await detect(`<html><body>${markup}</body></html>`)).captcha).toBe(true);
    });
  }

  test("real captured DataDome block page -> captcha", async () => {
    const f = captured("datadome-g2");
    expect((await detect(f.html, "https://www.example.com/", f.status)).captcha).toBe(true);
  });

  test("a Turnstile widget -> turnstile", async () => {
    const c = await detect(
      `<html><body><form><p>${PROSE}</p><div class="cf-turnstile" data-sitekey="x"></div><input type="hidden" name="cf-turnstile-response"></form></body></html>`,
    );
    expect(c.turnstile).toBe(true);
  });

  test("an hCaptcha widget -> hcaptcha and captcha", async () => {
    const c = await detect(`<html><body><form><div class="h-captcha" data-sitekey="x"></div></form></body></html>`);
    expect(c.hcaptcha).toBe(true);
    expect(c.captcha).toBe(true);
  });

  test("password field -> login", async () => {
    expect((await detect(`<html><body><form><input type="password"></form></body></html>`)).login).toBe(true);
  });

  test("login wall wording without a password field (SSO) -> login", async () => {
    const c = await detect(`<html><body><h1>Please sign in to continue</h1><button>Sign in with Google</button></body></html>`);
    expect(c.login).toBe(true);
  });

  test("username-first SSO step (heading and subtitle on separate lines, no password field)", async () => {
    const gmail = await detect(`<html><body><h1>Sign in</h1><div>to continue to Gmail</div><input type="email"></body></html>`);
    expect(gmail.login).toBe(true);
    const user = await detect(`<html><body><h1>Sign In</h1><input name="u" autocomplete="username"><button>Next</button></body></html>`);
    expect(user.login).toBe(true);
  });

  test("the sparse login fixture -> login", async () => {
    expect((await detect(readFileSync(join(FIX, "sparse-login.html"), "utf8"))).login).toBe(true);
  });
});
