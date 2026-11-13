import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { crawl } from "../../src/agent/crawl.js";
import { fetchBatch } from "../../src/agent/fetch-batch.js";
import { fetchAndRender } from "../../src/agent/fetch-orchestrate.js";
import type { BrowserProbe } from "../../src/interfaces/block.js";
import { NOT_BLOCKED, REAL_BLOCKED, SYNTHETIC_BLOCKED, article } from "./helpers/block-pages.js";
import { type FixtureRoute, type FixtureServer, serveFixtures } from "./helpers/fixture-server.js";

// Public-entry-point tests: the REAL fast path (impit → fetchFast → resolve →
// render) runs against a local server replaying real response headers + bodies.
// Today (0.1.64) a Cloudflare/DataDome interstitial comes back as an ordinary
// result: status 403, wordCount 0 or a few chrome words, escalated:false and
// nothing an agent can branch on. Escalation semantics: fetch-blocked-escalation.test.ts.

const ALL_BLOCKED = { ...REAL_BLOCKED, ...SYNTHETIC_BLOCKED };
const routes: Record<string, FixtureRoute> = { ...NOT_BLOCKED };
for (const [path, b] of Object.entries(ALL_BLOCKED)) routes[path] = b.route;

// Crawl fixtures: a blocked seed and a normal hub, both linking to same-origin trap pages.
const TRAP_LINKS = '<a href="/trap-1">one</a> <a href="/trap-2">two</a>';
routes["/blocked-with-links"] = {
  status: 403,
  headers: { "cf-mitigated": "challenge" },
  body: `<html><head><title>Just a moment...</title></head><body><p>Checking your browser</p>${TRAP_LINKS}</body></html>`,
};
routes["/hub"] = { status: 200, body: article("Hub", TRAP_LINKS) };
routes["/trap-1"] = { status: 200, body: article("Trap one") };
routes["/trap-2"] = { status: 200, body: article("Trap two") };

let server: FixtureServer;
beforeAll(() => {
  server = serveFixtures(routes);
});
afterAll(() => server.stop());

/** Thin shells that `browserFallback` may legitimately escalate (SPA path, not the block path). */
const SPA_SHELLS = new Set(["/spa-shell", "/spa-csp-captcha-delivery"]);

const MARKDOWN_KEYS = ["escalated", "extraction", "format", "status", "text", "url", "wordCount"];
const TEXT_KEYS = ["escalated", "format", "status", "text", "url"];

describe("browser_fetch pipeline — a blocked interstitial is reported as blocked", () => {
  for (const [path, { route, vendor }] of Object.entries(ALL_BLOCKED)) {
    test(`${path}: blocked:true, blockedBy:${vendor}, hint names the next tools`, async () => {
      const { rendered } = await fetchAndRender(`${server.origin}${path}`);
      expect(rendered.blocked).toBe(true);
      expect(rendered.blockedBy).toBe(vendor);
      expect(rendered.status).toBe(route.status);
      expect(rendered.escalated).toBe(false);
      const hint = rendered.hint ?? "";
      for (const needle of ["browserFallback", "browser_open", "browser_navigate", "browser_extract", "browser_handoff"]) {
        expect(hint).toContain(needle);
      }
    });
  }

  test("the owner's case: a 403 with zero extracted words is no longer a normal result", async () => {
    const { rendered } = await fetchAndRender(`${server.origin}/cf-managed`);
    expect(rendered.status).toBe(403);
    expect(rendered.wordCount).toBe(0);
    expect(rendered.blocked).toBe(true);
  });
});

describe("false-positive matrix — these keep TODAY's exact result shape", () => {
  for (const [path, route] of Object.entries(NOT_BLOCKED)) {
    test(`${path} (${route.status}): no blocked/blockedBy/hint key at all`, async () => {
      const probes: string[] = [];
      const probe: BrowserProbe = async (url) => {
        probes.push(url);
        return { url, html: article("x"), text: "x" };
      };
      const { rendered } = await fetchAndRender(`${server.origin}${path}`, { browserFallback: true, probe });
      const isJson = route.contentType === "application/json";
      expect(Object.keys(rendered).sort()).toEqual(isJson ? TEXT_KEYS : MARKDOWN_KEYS);
      expect(rendered.status).toBe(route.status);
      // browserFallback may legitimately escalate an SPA shell, never anything else.
      if (!SPA_SHELLS.has(path)) expect(probes).toEqual([]);
    });
  }

  test("D2 through the public entry point, no browserFallback: a CSP mention of the DataDome host is not a block", async () => {
    const { rendered } = await fetchAndRender(`${server.origin}/spa-csp-captcha-delivery`);
    expect(rendered.status).toBe(200);
    expect(rendered.blocked).toBeUndefined();
  });

  test("sparse page keeps its clean extraction (login stays primary)", async () => {
    const { rendered } = await fetchAndRender(`${server.origin}/login`);
    expect(rendered.extraction).toBe("primary");
    expect(rendered.blocked).toBeUndefined();
  });
});

describe("fetch_batch and crawl share the same detection", () => {
  test("fetchBatch: per-URL blocked flag, normal URL untouched", async () => {
    const items = await fetchBatch([`${server.origin}/datadome`, `${server.origin}/article`]);
    const [bad, good] = items;
    expect(bad && "blocked" in bad && bad.blocked).toBe(true);
    expect(good && !("blocked" in good)).toBe(true);
    expect(good && !("error" in good) && Object.keys(good).sort()).toEqual(MARKDOWN_KEYS);
  });

  test("crawl: a blocked seed is flagged", async () => {
    const out = await crawl(`${server.origin}/cf-managed`, { respectRobots: false, throttleMs: 0, maxDepth: 1 });
    expect(out.count).toBe(1);
    expect(out.pages[0]?.blocked).toBe(true);
    expect(out.pages[0]?.hint).toContain("browser_open");
  });

  test("crawl: links found on a BLOCKED page are never requested; the same links on a normal page are", async () => {
    const blocked = await crawl(`${server.origin}/blocked-with-links`, { respectRobots: false, throttleMs: 0, maxDepth: 1 });
    expect(blocked.count).toBe(1);
    expect(blocked.pages[0]?.blocked).toBe(true);
    expect(server.hits.get("/trap-1")).toBeUndefined();
    expect(server.hits.get("/trap-2")).toBeUndefined();
    // Control: proves the harness would see a visit.
    const normal = await crawl(`${server.origin}/hub`, { respectRobots: false, throttleMs: 0, maxDepth: 1 });
    expect(normal.count).toBe(3);
    expect(server.hits.get("/trap-1")).toBe(1);
  });

  test("crawl: a normal page keeps today's exact page shape", async () => {
    const out = await crawl(`${server.origin}/article`, { respectRobots: false, throttleMs: 0, maxDepth: 0 });
    expect(Object.keys(out.pages[0] ?? {}).sort()).toEqual([...MARKDOWN_KEYS, "depth"].sort());
  });
});
