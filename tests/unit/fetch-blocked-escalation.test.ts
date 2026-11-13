import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { fetchAndRender } from "../../src/agent/fetch-orchestrate.js";
import type { BrowserProbe } from "../../src/interfaces/block.js";
import { NOT_BLOCKED, REAL_BLOCKED, SYNTHETIC_BLOCKED, article } from "./helpers/block-pages.js";
import { type FixtureServer, loadHtml, serveFixtures } from "./helpers/fixture-server.js";

// Escalation semantics through the public entry point (`fetchAndRender`), with the
// browser replaced by an injected probe so no real browser launches.

let server: FixtureServer;
beforeAll(() => {
  server = serveFixtures({
    "/cf-managed": REAL_BLOCKED["/cf-managed"]?.route as never,
    "/datadome": REAL_BLOCKED["/datadome"]?.route as never,
    "/aws-waf": SYNTHETIC_BLOCKED["/aws-waf"]?.route as never,
    "/spa-shell": NOT_BLOCKED["/spa-shell"] as never,
    "/article": NOT_BLOCKED["/article"] as never,
  });
});
afterAll(() => server.stop());
afterEach(() => {
  delete process.env.FUSE_FETCH_ESCALATE_BLOCKED;
});

/** Wrap a probe so every URL it is asked to render is recorded in `calls`. */
function recording(calls: string[], inner: BrowserProbe): BrowserProbe {
  return async (url, proxyUrl) => {
    calls.push(url);
    return inner(url, proxyUrl);
  };
}

const clean: BrowserProbe = async (url) => ({ url, html: article("Real page"), text: "Real page" });
const stillBlocked: BrowserProbe = async (url) => ({
  url,
  html: REAL_BLOCKED["/cf-managed"]?.route.body ?? "",
  text: "Checking your connection",
});

describe("escalation — opt-in via browserFallback (or FUSE_FETCH_ESCALATE_BLOCKED=1)", () => {
  test("default: a blocked response never launches a browser", async () => {
    const calls: string[] = [];
    const { rendered } = await fetchAndRender(`${server.origin}/cf-managed`, { probe: recording(calls, clean) });
    expect(calls).toEqual([]);
    expect(rendered.blocked).toBe(true);
    expect(rendered.escalated).toBe(false);
  });

  test("browserFallback:true + browser gets the real page → escalated, not blocked", async () => {
    const { rendered } = await fetchAndRender(`${server.origin}/cf-managed`, { browserFallback: true, probe: clean });
    expect(rendered.escalated).toBe(true);
    expect(rendered.blocked).toBeUndefined();
    expect(rendered.hint).toBeUndefined();
    expect(rendered.text).toContain("committee reviewed");
  });

  test("browserFallback:true + browser is blocked too → blocked:true, escalated:true, handoff hint", async () => {
    const { rendered } = await fetchAndRender(`${server.origin}/cf-managed`, { browserFallback: true, probe: stillBlocked });
    expect(rendered.escalated).toBe(true);
    expect(rendered.blocked).toBe(true);
    expect(rendered.hint).toContain("browser_handoff");
    expect(rendered.hint).toContain("browser_open");
  });

  test("FUSE_FETCH_ESCALATE_BLOCKED=1 escalates a block without browserFallback", async () => {
    process.env.FUSE_FETCH_ESCALATE_BLOCKED = "1";
    const calls: string[] = [];
    const { rendered } = await fetchAndRender(`${server.origin}/datadome`, { probe: recording(calls, clean) });
    expect(calls).toHaveLength(1);
    expect(rendered.escalated).toBe(true);
    expect(rendered.blocked).toBeUndefined();
  });

  test("FUSE_FETCH_ESCALATE_BLOCKED=1 does NOT turn on SPA-shell escalation or touch normal pages", async () => {
    process.env.FUSE_FETCH_ESCALATE_BLOCKED = "1";
    const calls: string[] = [];
    const probe = recording(calls, clean);
    await fetchAndRender(`${server.origin}/spa-shell`, { probe });
    await fetchAndRender(`${server.origin}/article`, { probe });
    expect(calls).toEqual([]);
  });
});

describe("after escalation — which verdict survives the render", () => {
  test("header-only block (AWS WAF): a render as thin as an interstitial inherits blocked; a real page does not", async () => {
    const thin: BrowserProbe = async (url) => ({ url, html: "<html><body>Verifying…</body></html>", text: "Verifying…" });
    const stuck = await fetchAndRender(`${server.origin}/aws-waf`, { browserFallback: true, probe: thin });
    expect(stuck.rendered.escalated).toBe(true);
    expect(stuck.rendered.blocked).toBe(true);
    expect(stuck.rendered.blockedBy).toBe("aws-waf");
    const passed = await fetchAndRender(`${server.origin}/aws-waf`, { browserFallback: true, probe: clean });
    expect(passed.rendered.escalated).toBe(true);
    expect(passed.rendered.blocked).toBeUndefined();
  });

  test("A(i): Cloudflare-blocked fast path + a genuinely short page rendered fine → NOT blocked, content returned", async () => {
    const login: BrowserProbe = async (url) => ({ url, html: loadHtml("sparse-login.html"), text: "Sign in" });
    const { rendered } = await fetchAndRender(`${server.origin}/cf-managed`, { browserFallback: true, probe: login });
    expect(rendered.escalated).toBe(true);
    expect(rendered.blocked).toBeUndefined();
    expect(rendered.hint).toBeUndefined();
    expect(rendered.text.length).toBeGreaterThan(0);
  });

  test("A(iii): Cloudflare-blocked + a thin render that still carries the challenge marker → blocked", async () => {
    const challenged: BrowserProbe = async (url) => ({
      url,
      html: "<html><body>Checking…<script>window._cf_chl_opt = {cType: 'managed'};</script></body></html>",
      text: "Checking…",
    });
    const { rendered } = await fetchAndRender(`${server.origin}/cf-managed`, { browserFallback: true, probe: challenged });
    expect(rendered.escalated).toBe(true);
    expect(rendered.blocked).toBe(true);
    expect(rendered.blockedBy).toBe("cloudflare");
  });
});
