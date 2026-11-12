/**
 * `browser_verify`: expectations, blocked verdict, console availability.
 * Tested through the REAL tool (in-memory MCP client, real headless Chromium)
 * against local fixture pages.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { call } from "../integration/helpers/safe-actions-harness.js";
import type { FixtureServer } from "./helpers/fixture-server.js";
import { inSession, startSite, tmpDir } from "./helpers/verify-site.js";

let site: FixtureServer;
beforeAll(() => {
  site = startSite();
});
afterAll(() => site.stop());
const T = 120_000;

describe("browser_verify expectations", () => {
  test("a page that passes every expectation, with the evidence files and receipt", async () => {
    const dir = tmpDir();
    await inSession(async (c, sessionId) => {
      const r = await call(c, "browser_verify", {
        sessionId,
        url: `${site.origin}/good`,
        evidenceDir: dir,
        expect: [{ text: "Welcome" }, { visible: "#cta" }, { noFailedRequests: true }],
      });
      expect(r.pass).toBe(true);
      expect(r.failed).toEqual([]);
      for (const f of [r.evidence.after, r.evidence.consoleLog, r.evidence.networkLog, r.evidence.receiptMd]) {
        expect(f.startsWith(dir)).toBe(true);
        expect(existsSync(f)).toBe(true);
      }
      expect(readFileSync(r.evidence.receiptMd, "utf8")).toContain("PASS");
      expect(r.evidence.diff).toBeUndefined();
    });
  }, T);

  test("missing text, hidden selector, absent selector fail with a reason", async () => {
    await inSession(async (c, sessionId) => {
      const r = await call(c, "browser_verify", {
        sessionId,
        url: `${site.origin}/good`,
        evidenceDir: tmpDir(),
        expect: [{ text: "Goodbye" }, { visible: "#hidden" }, { visible: "#nope" }, { text: "Welcome" }],
      });
      expect(r.pass).toBe(false);
      expect(r.failed.map((f: { reason: string }) => f.reason)).toEqual(["text_not_found", "not_visible", "selector_not_found"]);
      expect(r.failed[0].expect).toEqual({ text: "Goodbye" });
    });
  }, T);

  test("a 404 subresource fails noFailedRequests and names the URL", async () => {
    await inSession(async (c, sessionId) => {
      const r = await call(c, "browser_verify", { sessionId, url: `${site.origin}/bad-img`, evidenceDir: tmpDir(), expect: [{ noFailedRequests: true }] });
      expect(r.pass).toBe(false);
      expect(r.failed[0].reason).toBe("failed_requests");
      expect(JSON.stringify(r.failed[0].detail)).toContain("/missing.png");
    });
  }, T);

  test("url alone opens and closes its own session", async () => {
    await inSession(async (c, sessionId) => {
      const before = (await call(c, "browser_status", {})).sessions.length;
      const r = await call(c, "browser_verify", { url: `${site.origin}/good`, evidenceDir: tmpDir(), expect: [{ text: "Welcome" }], headless: true });
      expect(r.pass).toBe(true);
      expect(r.sessionId).toBeUndefined();
      expect((await call(c, "browser_status", {})).sessions.length).toBe(before);
      expect(sessionId.length).toBeGreaterThan(0);
    });
  }, T);

  test("a blocked interstitial FAILS verify with the blocked reason, even when the text expectation would match", async () => {
    await inSession(async (c, sessionId) => {
      const r = await call(c, "browser_verify", { sessionId, url: `${site.origin}/cf-moment`, evidenceDir: tmpDir(), expect: [{ text: "a" }] });
      expect(r.pass).toBe(false);
      expect(r.blocked).toBe(true);
      expect(r.failed.some((f: { reason: string }) => f.reason === "blocked:cloudflare")).toBe(true);
    });
  }, T);
});

describe("browser_verify console expectation", () => {
  test("patchright: explicit unavailable reason, never a silent pass", async () => {
    await inSession(async (c, sessionId) => {
      const r = await call(c, "browser_verify", { sessionId, url: `${site.origin}/good`, evidenceDir: tmpDir(), expect: [{ noConsoleErrors: true }] });
      expect(r.pass).toBe(false);
      expect(r.consoleAvailable).toBe(false);
      expect(r.failed[0]).toMatchObject({ expect: { noConsoleErrors: true }, reason: "console_unavailable_on_patchright" });
    });
  }, T);

  test("playwright: a console error fails, a clean page passes", async () => {
    await inSession(async (c, sessionId) => {
      const bad = await call(c, "browser_verify", { sessionId, url: `${site.origin}/console-error`, evidenceDir: tmpDir(), expect: [{ noConsoleErrors: true }] });
      expect(bad.consoleAvailable).toBe(true);
      expect(bad.failed[0].reason).toBe("console_errors");
      expect(JSON.stringify(bad.failed[0].detail)).toContain("boom-from-page");
      const good = await call(c, "browser_verify", { sessionId, url: `${site.origin}/good`, evidenceDir: tmpDir(), expect: [{ noConsoleErrors: true }] });
      expect(good.pass).toBe(true);
      expect(readFileSync(join(good.evidence.consoleLog), "utf8")).toContain("[");
    }, "playwright");
  }, T);
});
