/**
 * `extractSerp` / `collectSerp` against a real Chromium page. Google is never
 * contacted: `page.route` serves a REAL Google results page captured
 * 2026-11-11 (sanitized, `tests/fixtures/serp/`) and small synthetic pages, so
 * `a.href` resolves against a real `https://www.google.com/...` origin.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright";
import { resolveConfig } from "../../src/agent/config.js";
import { collectSerp } from "../../src/agent/serp-paged.js";
import { extractSerp } from "../../src/extraction/serp.js";
import { findDomainRanks } from "../../src/extraction/serp-rank.js";
import { SessionManager } from "../../src/session/manager.js";

const FIXTURE = readFileSync(join(import.meta.dir, "../fixtures/serp/google-results-2026-11-11.html"), "utf8");
const config = resolveConfig({ headless: true, engine: "patchright" });
const sessions = new SessionManager();
let page: Page;
let sessionId = "";

/** Serve `body` for the next navigation to `url` (no network) and load it. */
async function load(url: string, body: string): Promise<void> {
  await page.unroute("**/*");
  await page.route("**/*", (route) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body }));
  await page.goto(url, { waitUntil: "domcontentloaded" });
}

const RESULTS_URL = "https://www.google.com/search?q=playwright+mcp+changelog&hl=en";

beforeAll(async () => {
  const s = await sessions.open(config);
  page = s.page;
  sessionId = s.id;
}, 120_000);
afterAll(async () => {
  await sessions.close(sessionId);
});

describe("real Google results page (goto redirect layout, captured 2026-11-11)", () => {
  test("every organic result is kept, flagged as a redirect, with its title and display URL", async () => {
    await load(RESULTS_URL, FIXTURE);
    const serp = await extractSerp(page);
    expect(serp.organic.length).toBe(9);
    expect(serp.organic.map((r) => r.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(serp.organic[0]?.title).toBe("Releases · microsoft/playwright-mcp");
    expect(serp.organic[0]?.displayUrl).toBe("https://github.com › microsoft › playwright-mcp › releases");
    for (const r of serp.organic) {
      expect(r.url.startsWith("https://www.google.com/goto?url=")).toBe(true);
      expect(r.redirect).toBe(true);
    }
    // the "AI Mode reply" heading is not a result (no link)
    expect(serp.organic.some((r) => r.title.startsWith("AI Mode"))).toBe(false);
    expect(serp.related.length).toBeGreaterThan(0);
  });

  test("domain rank works on a redirect result through its display host", async () => {
    await load(RESULTS_URL, FIXTURE);
    const serp = await extractSerp(page);
    const rank = findDomainRanks(serp, "github.com");
    expect(rank.found).toBe(true);
    expect(rank.organic).toEqual([1, 9]);
    expect(rank.best).toBe(1);
    expect(findDomainRanks(serp, "google.com").found).toBe(false);
  });
});

describe("classic layout (direct hrefs) keeps the real destination", () => {
  const CLASSIC =
    '<div id="rso"><div class="g" data-hveid="a"><a href="https://example.com/docs/a?x=1"><h3>Doc A</h3>' +
    '<cite>https://example.com › docs › a</cite></a><div class="VwiC3b">snippet a</div></div>' +
    '<div class="g" data-hveid="b"><a href="https://www.google.com/search?q=related"><h3>Related search</h3></a></div>' +
    '<div class="g" data-hveid="c"><a href="https://maps.google.com/maps?q=x"><h3>Maps</h3></a></div></div>';

  test("url is the destination, no redirect flag, Google-internal links are dropped", async () => {
    await load(RESULTS_URL, CLASSIC);
    const serp = await extractSerp(page);
    expect(serp.organic).toEqual([
      {
        position: 1,
        title: "Doc A",
        url: "https://example.com/docs/a?x=1",
        displayUrl: "https://example.com › docs › a",
        snippet: "snippet a",
      },
    ]);
  });
});

describe("an empty result list is never silent", () => {
  const retry = config.retry;

  test("results page with zero extractable results -> warning no_results_extracted", async () => {
    await load(RESULTS_URL, '<div id="rso"><div class="x">layout nobody handles</div></div>');
    const serp = await collectSerp(page, 1, retry);
    expect(serp.organic).toEqual([]);
    expect(serp.warning).toBe("no_results_extracted");
  });

  test("consent interstitial -> warning consent_wall", async () => {
    await load("https://consent.google.com/m?continue=https://www.google.com/search%3Fq%3Dx", "<form action='https://consent.google.com/save'><button>Accept all</button></form>");
    const serp = await collectSerp(page, 1, retry);
    expect(serp.warning).toBe("consent_wall");
  });

  test("Google /sorry/ block page -> warning blocked", async () => {
    await load("https://www.google.com/sorry/index?continue=https://www.google.com/search%3Fq%3Dx", "<p>Our systems have detected unusual traffic</p>");
    const serp = await collectSerp(page, 1, retry);
    expect(serp.warning).toBe("blocked");
  });

  test("a page WITH results carries no warning field", async () => {
    await load(RESULTS_URL, FIXTURE);
    const serp = await collectSerp(page, 1, retry);
    expect(serp.organic.length).toBe(9);
    expect("warning" in serp).toBe(false);
  });
});
