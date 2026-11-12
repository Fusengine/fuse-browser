/**
 * `browser_verify` challenger regressions: the log window, uncaught exceptions,
 * failure-then-success, the 250-entry cap, confinement of the default dir, and
 * the receipt-baseline path rule. Real tool, real browser, local fixtures.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
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
const both = [{ noConsoleErrors: true }, { noFailedRequests: true }] as const;

describe("browser_verify log window and failure sources", () => {
  test("without url the session's own buffer is checked (as documented)", async () => {
    await inSession(async (c, sessionId) => {
      await call(c, "browser_navigate", { sessionId, url: `${site.origin}/noisy` });
      const r = await call(c, "browser_verify", { sessionId, evidenceDir: tmpDir(), expect: [...both] });
      expect(r.pass).toBe(false);
      expect(r.failed.map((f: { reason: string }) => f.reason).sort()).toEqual(["console_errors", "failed_requests"]);
    }, "playwright");
  }, T);

  test("with url, entries from before the verification do not leak in", async () => {
    await inSession(async (c, sessionId) => {
      await call(c, "browser_navigate", { sessionId, url: `${site.origin}/noisy` });
      const r = await call(c, "browser_verify", { sessionId, url: `${site.origin}/good`, evidenceDir: tmpDir(), expect: [...both] });
      expect(r.pass).toBe(true);
    }, "playwright");
  }, T);

  test("an uncaught exception fails noConsoleErrors (page_errors) on playwright; patchright delivers no page errors (measured) and says unavailable", async () => {
    await inSession(async (c, sessionId) => {
      const r = await call(c, "browser_verify", { sessionId, url: `${site.origin}/throw`, evidenceDir: tmpDir(), expect: [{ noConsoleErrors: true }] });
      expect(r.pass).toBe(false);
      expect(JSON.stringify(r.failed)).toContain("uncaught-x");
      expect(r.failed[0].reason).toBe("page_errors");
    }, "playwright");
    await inSession(async (c, sessionId) => {
      const r = await call(c, "browser_verify", { sessionId, url: `${site.origin}/throw`, evidenceDir: tmpDir(), expect: [{ noConsoleErrors: true }] });
      expect(r.pass).toBe(false);
      expect(r.failed[0].reason).toBe("console_unavailable_on_patchright");
    });
  }, T);

  test("a 500 followed by a 200 on the same URL still fails noFailedRequests", async () => {
    await inSession(async (c, sessionId) => {
      const r = await call(c, "browser_verify", { sessionId, url: `${site.origin}/flaky-page`, evidenceDir: tmpDir(), expect: [{ noFailedRequests: true }] });
      expect(r.pass).toBe(false);
      expect(JSON.stringify(r.failed[0].detail)).toContain("500");
    });
  }, T);

  test("an early failure is not evicted by 300 later requests (log cap)", async () => {
    await inSession(async (c, sessionId) => {
      const r = await call(c, "browser_verify", { sessionId, url: `${site.origin}/many`, evidenceDir: tmpDir(), expect: [{ noFailedRequests: true }] });
      expect(r.pass).toBe(false);
      expect(JSON.stringify(r.failed[0].detail)).toContain("gone-first");
    });
  }, T);

  test("session mode: a request with no response (network failure) can never pass; a redirect is not one", async () => {
    await inSession(async (c, sessionId) => {
      await call(c, "browser_navigate", { sessionId, url: `${site.origin}/netfail` });
      const bad = await call(c, "browser_verify", { sessionId, evidenceDir: tmpDir(), expect: [{ noFailedRequests: true }] });
      expect(bad.pass).toBe(false);
      expect(bad.failed[0].reason).toBe("failed_requests");
      expect(JSON.stringify(bad.failed[0].detail)).toContain("no_response");
    });
    await inSession(async (c, sessionId) => {
      await call(c, "browser_navigate", { sessionId, url: `${site.origin}/redir` });
      const ok = await call(c, "browser_verify", { sessionId, evidenceDir: tmpDir(), expect: [{ noFailedRequests: true }] });
      expect(ok.pass).toBe(true);
    });
  }, T);

  test("an empty expect list is rejected (nothing would be verified)", async () => {
    await inSession(async (c, sessionId) => {
      const r = await c.callTool({ name: "browser_verify", arguments: { sessionId, url: `${site.origin}/good`, expect: [] } });
      expect(r.isError).toBe(true);
    });
  }, T);

  test("empty text / selector expectations are rejected, not vacuously passed", async () => {
    await inSession(async (c, sessionId) => {
      const r = await c.callTool({ name: "browser_verify", arguments: { sessionId, url: `${site.origin}/good`, expect: [{ text: "" }] } });
      expect(r.isError).toBe(true);
    });
  }, T);
});

describe("browser_verify evidence paths", () => {
  test("the DEFAULT evidence dir is confined too (outputDir outside FUSE_CONFINE_WRITES is refused)", async () => {
    const root = tmpDir();
    const outside = tmpDir();
    process.env.FUSE_CONFINE_WRITES = root;
    try {
      await inSession(async (c) => {
        const r = await call(c, "browser_verify", { url: `${site.origin}/good`, outputDir: outside, headless: true, expect: [{ visible: "body" }] });
        expect(JSON.stringify(r)).toContain("path_outside_confinement");
        expect(existsSync(join(outside, "verify"))).toBe(false);
      });
    } finally {
      delete process.env.FUSE_CONFINE_WRITES;
    }
  }, T);

  test("a receipt baseline may only point at an after.png (no arbitrary file via the '- after:' line)", async () => {
    const dir = tmpDir();
    const secret = join(dir, "secret.bin");
    writeFileSync(secret, "not an image");
    const receipt = join(dir, "receipt.md");
    writeFileSync(receipt, `# r\n- after: ${secret}\n`);
    await inSession(async (c, sessionId) => {
      const r = await call(c, "browser_verify", { sessionId, url: `${site.origin}/good`, evidenceDir: tmpDir(), baseline: receipt, expect: [{ visible: "body" }] });
      expect(r.pass).toBe(false);
      expect(r.failed[0].reason).toBe("baseline_not_found");
      expect(r.evidence.before).toBeUndefined();
    });
    expect(readdirSync(dir).length).toBe(2);
  }, T);

  test("a failed evidence write is reported as such, not as a confinement refusal", async () => {
    const dir = tmpDir();
    const file = join(dir, "afile");
    writeFileSync(file, "x");
    await inSession(async (c, sessionId) => {
      const r = await c.callTool({ name: "browser_verify", arguments: { sessionId, url: `${site.origin}/good`, evidenceDir: join(file, "sub"), expect: [{ visible: "body" }] } });
      expect(r.isError).toBe(true);
      expect(JSON.stringify(r.structuredContent)).toContain("evidence_write_failed");
    });
  }, T);
});
