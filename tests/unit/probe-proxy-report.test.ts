/**
 * Which challenge results make a probe report its pool proxy as blocked
 * (`reportBlockedProxy`, the code behind `probe-run.ts`'s call). Challenges come
 * from the real `detectChallenges` on rendered AWS WAF fixtures, the reporter is a spy.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright";
import { resolveConfig } from "../../src/agent/config.js";
import { reportBlockedProxy } from "../../src/agent/probe-run.js";
import { detectChallenges } from "../../src/extraction/challenges.js";
import { SessionManager } from "../../src/session/manager.js";

const FIX = join(import.meta.dir, "../fixtures/challenges");
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

/** Render `body` as the document (sub-resources aborted) and run the real detector on it. */
async function challengesOfHtml(body: string, status: number) {
  await page.unroute("**/*");
  await page.route("**/*", (r) =>
    r.request().resourceType() === "document" ? r.fulfill({ status, contentType: "text/html", body }) : r.abort(),
  );
  await page.goto("https://www.example.com/", { waitUntil: "domcontentloaded" });
  return detectChallenges(page, String(await page.evaluate("document.body ? document.body.innerText : ''")));
}

const challengesOf = (file: string, status: number) => challengesOfHtml(readFileSync(join(FIX, file), "utf8"), status);

const pool = { proxySource: "pool", proxyUrl: "http://10.0.0.1:8080" } as const;

/** Run the real decision with a spy reporter; returns the URLs it was called with. */
function reported(config: Parameters<typeof reportBlockedProxy>[0], challenges: Parameters<typeof reportBlockedProxy>[1]): string[] {
  const calls: string[] = [];
  reportBlockedProxy(config, challenges, (u) => calls.push(u));
  return calls;
}

describe("pool proxy is reported on a WAF block page", () => {
  test("AWS WAF CAPTCHA interstitial -> reported", async () => {
    expect(reported(pool, await challengesOf("aws-waf-captcha-synthetic.html", 405))).toEqual([pool.proxyUrl]);
  });

  test("AWS WAF Challenge interstitial (awsWaf only, no captcha) -> reported", async () => {
    const c = await challengesOf("aws-waf-challenge-synthetic.html", 202);
    expect(c.captcha).toBe(false);
    expect(reported(pool, c)).toEqual([pool.proxyUrl]);
  });

  test("Cloudflare hard-block page -> reported", async () => {
    expect(reported(pool, await challengesOf("cloudflare-error-1020-synthetic.html", 403))).toEqual([pool.proxyUrl]);
  });
});

describe("no report when it must not fire", () => {
  test("not a pool proxy", async () => {
    const c = await challengesOf("aws-waf-captcha-synthetic.html", 405);
    expect(reported({ proxySource: "env", proxyUrl: pool.proxyUrl } as never, c)).toEqual([]);
    expect(reported({ proxySource: "pool", proxyUrl: null } as never, c)).toEqual([]);
  });

  test("normal page using the AWS WAF integration SDK (getToken) is not a block", async () => {
    const body =
      `<html><head><script src="https://0000.edge.sdk.awswaf.com/0000/0000/jsapi.js"></script></head>` +
      `<body><script>AwsWafIntegration.getToken().then(() => {});</script></body></html>`;
    expect(reported(pool, await challengesOfHtml(body, 200))).toEqual([]);
  });

  test("clean page", async () => {
    expect(reported(pool, await challengesOfHtml("<html><body><p>hello</p></body></html>", 200))).toEqual([]);
  });

  test("challenges not detected ({})", () => {
    expect(reported(pool, {})).toEqual([]);
  });
});
