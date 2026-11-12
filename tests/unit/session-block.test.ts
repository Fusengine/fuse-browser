/**
 * Session routes (`browser_navigate`, `browser_extract`) say when the live page is
 * an anti-bot interstitial, like the fast path does. Tested through the REAL tools
 * (in-memory MCP client, real headless Chromium) against a local fixture server that
 * serves the real captured blocked pages with their real status/headers.
 * Third-party hosts (e.g. challenges.cloudflare.com) are aborted.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { call, withClient } from "../integration/helpers/safe-actions-harness.js";
import { detectSessionBlock } from "../../src/extraction/challenge-verdict.js";
import { REAL_BLOCKED, article } from "./helpers/block-pages.js";
import { type FixtureServer, serveFixtures } from "./helpers/fixture-server.js";

const CH = join(import.meta.dir, "../fixtures/challenges");
const read = (f: string): string => readFileSync(join(CH, f), "utf8");
const PROSE = "The committee reviewed the annual report and discussed the findings at length. ".repeat(12);

let site: FixtureServer;
beforeAll(() => {
  site = serveFixtures({
    "/cf-moment": REAL_BLOCKED["/cf-moment"]!.route,
    "/cf-managed": REAL_BLOCKED["/cf-managed"]!.route,
    "/cf-security": REAL_BLOCKED["/cf-security"]!.route,
    "/datadome": REAL_BLOCKED["/datadome"]!.route,
    "/aws-captcha": { status: 405, headers: { "x-amzn-waf-action": "captcha" }, body: read("aws-waf-captcha-synthetic.html") },
    "/aws-challenge": { status: 202, headers: { "x-amzn-waf-action": "challenge" }, body: read("aws-waf-challenge-synthetic.html") },
    "/cf-1020": { status: 403, body: read("cloudflare-error-1020-synthetic.html") },
    // a RENDERED Turnstile widget: its container holds the 300x65 iframe (an empty 0x0 div is not a rendered widget)
    "/turnstile-thin": {
      status: 200,
      body: `<html><body><div class="cf-turnstile" data-sitekey="x"><iframe src="https://challenges.cloudflare.com/cdn-cgi/challenge-platform/turnstile/if" width="300" height="65"></iframe></div></body></html>`,
    },
    "/turnstile-form": {
      status: 200,
      body: `<html><body><article><p>${PROSE}</p></article><form><div class="cf-turnstile" data-sitekey="x"></div></form></body></html>`,
    },
    "/login-recaptcha": {
      status: 200,
      body: `<html><body><form><input type="text" name="user"><input type="password" name="p"><div class="g-recaptcha" data-sitekey="k"></div><button>Go</button></form></body></html>`,
    },
    "/contact-recaptcha-v3": {
      status: 200,
      body: `<html><head><script src="https://www.google.com/recaptcha/api.js?render=k"></script></head><body><h1>Contact</h1><form><input type="text" name="n"></form></body></html>`,
    },
    "/spa-turnstile-script": {
      status: 200,
      body: `<html><head><script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script></head><body><div id="app">Loading...</div></body></html>`,
    },
    "/long-nav-main-widget": {
      status: 200,
      body: `<html><body><nav>${PROSE}</nav><main><div class="g-recaptcha" data-sitekey="k"></div></main></body></html>`,
    },
    "/article": { status: 200, body: article("Quarterly report") },
    "/prose": {
      status: 200,
      body: article("Bot walls", "Cloudflare shipped Turnstile; hCaptcha and reCAPTCHA exist; Error 1020 shows a Ray ID; AWS WAF returns 405."),
    },
  });
});
afterAll(() => site.stop());

/** Run `fn` with a session whose third-party requests are aborted. */
async function inSession(fn: (c: Client, sessionId: string) => Promise<void>): Promise<void> {
  await withClient(async (c, id, page) => {
    await page.context().route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    await fn(c, id);
  }, "about:blank");
}

const BLOCKED: [string, string][] = [
  ["/cf-moment", "cloudflare"],
  ["/cf-managed", "cloudflare"],
  ["/cf-security", "cloudflare"],
  ["/datadome", "datadome"],
  ["/aws-captcha", "aws-waf"],
  ["/aws-challenge", "aws-waf"],
  ["/cf-1020", "cloudflare"],
  ["/turnstile-thin", "unknown"],
];

describe("blocked pages are reported by browser_navigate and browser_extract", () => {
  for (const [path, vendor] of BLOCKED) {
    test(`${path} -> blockedBy ${vendor}`, async () => {
      await inSession(async (c, sessionId) => {
        const nav = await call(c, "browser_navigate", { sessionId, url: `${site.origin}${path}` });
        expect(nav.blocked).toBe(true);
        expect(nav.blockedBy).toBe(vendor);
        expect(typeof nav.hint).toBe("string");
        const ext = await call(c, "browser_extract", { sessionId, kind: "text" });
        expect(ext.blocked).toBe(true);
        expect(ext.blockedBy).toBe(vendor);
        expect(ext.hint).toBe(nav.hint);
      });
    }, 60_000);
  }

  test("hint names real next steps and never a solver", async () => {
    await inSession(async (c, sessionId) => {
      const nav = await call(c, "browser_navigate", { sessionId, url: `${site.origin}/turnstile-thin` });
      const hint = String(nav.hint);
      expect(hint).toContain("browser_handoff");
      expect(hint).toContain("browser_open");
      expect(hint.toLowerCase()).not.toContain("solve");
      expect(hint).not.toContain("captcha:");
    });
  }, 60_000);
});

describe("an inspection failure is logged and leaves the output verdict-free", () => {
  test("closed page -> null verdict plus exactly one warn line on stderr", async () => {
    await withClient(async (_c, _id, page) => {
      const extra = await page.context().newPage();
      await extra.close();
      const lines: string[] = [];
      const orig = process.stderr.write.bind(process.stderr);
      process.stderr.write = ((chunk: string | Uint8Array) => {
        lines.push(String(chunk));
        return true;
      }) as typeof process.stderr.write;
      try {
        expect(await detectSessionBlock(extra)).toBeNull();
      } finally {
        process.stderr.write = orig;
      }
      const warns = lines.filter((l) => l.includes("session block check failed"));
      expect(warns.length).toBe(1);
      expect(JSON.parse(warns[0] ?? "{}").level).toBe("warn");
    }, "about:blank");
  }, 60_000);
});

describe("browser_extract maxTokens (token-diet wiring) keeps the block verdict", () => {
  test("blocked page + maxTokens: text truncated, blocked/blockedBy/hint still present", async () => {
    await inSession(async (c, sessionId) => {
      await call(c, "browser_navigate", { sessionId, url: `${site.origin}/cf-1020` });
      const ext = await call(c, "browser_extract", { sessionId, kind: "text", maxTokens: 5 });
      expect(ext.blocked).toBe(true);
      expect(ext.blockedBy).toBe("cloudflare");
      expect(ext.nextOffset).toBeDefined();
    });
  }, 60_000);

  test("normal page + maxTokens on a long text: truncated, no block keys", async () => {
    await inSession(async (c, sessionId) => {
      await call(c, "browser_navigate", { sessionId, url: `${site.origin}/article` });
      const ext = await call(c, "browser_extract", { sessionId, kind: "text", maxTokens: 20 });
      expect(ext.nextOffset).toBeDefined();
      expect(ext.blocked).toBeUndefined();
    });
  }, 60_000);
});

describe("normal pages stay byte-identical (no blocked/blockedBy/hint keys)", () => {
  for (const path of [
    "/article",
    "/prose",
    "/turnstile-form",
    "/login-recaptcha",
    "/contact-recaptcha-v3",
    "/spa-turnstile-script",
    "/long-nav-main-widget",
  ]) {
    test(`${path}`, async () => {
      await inSession(async (c, sessionId) => {
        const nav = await call(c, "browser_navigate", { sessionId, url: `${site.origin}${path}` });
        expect(Object.keys(nav).sort()).toEqual(["title", "url"]);
        const ext = await call(c, "browser_extract", { sessionId, kind: "text" });
        expect(Object.keys(ext).sort()).toEqual(["text", "url"]);
        const all = await call(c, "browser_extract", { sessionId });
        expect(Object.keys(all).sort()).toEqual(["challenges", "hotelOffers", "prices", "text", "url"]);
      });
    }, 60_000);
  }
});
