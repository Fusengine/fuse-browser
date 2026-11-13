/**
 * `browser_verify` evidence: baseline diff, receipt as baseline, write
 * confinement and the default evidence directory. Real tool, real browser.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
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

describe("browser_verify baseline", () => {
  test("identical page: diff present, nothing changed; changed page: diff shows the change", async () => {
    await inSession(async (c, sessionId) => {
      const first = await call(c, "browser_verify", { sessionId, url: `${site.origin}/good`, evidenceDir: tmpDir(), expect: [{ visible: "body" }] });
      const same = await call(c, "browser_verify", { sessionId, url: `${site.origin}/good`, evidenceDir: tmpDir(), baseline: first.evidence.after, expect: [{ visible: "body" }] });
      expect(same.evidence.before).toBe(first.evidence.after);
      expect(same.evidence.diff.changed).toBe(false);
      expect(same.evidence.diff.diffPixels).toBe(0);
      const changed = await call(c, "browser_verify", { sessionId, url: `${site.origin}/changed`, evidenceDir: tmpDir(), baseline: first.evidence.after, expect: [{ visible: "body" }] });
      expect(changed.pass).toBe(true);
      expect(changed.evidence.diff.changed).toBe(true);
      expect(changed.evidence.diff.diffPixels).toBeGreaterThan(0);
      expect(existsSync(changed.evidence.diff.image)).toBe(true);
    });
  }, T);

  test("a previous receipt works as baseline; a missing baseline is a failed expectation, not a crash", async () => {
    await inSession(async (c, sessionId) => {
      const first = await call(c, "browser_verify", { sessionId, url: `${site.origin}/good`, evidenceDir: tmpDir(), expect: [{ visible: "body" }] });
      const viaReceipt = await call(c, "browser_verify", { sessionId, url: `${site.origin}/good`, evidenceDir: tmpDir(), baseline: first.evidence.receiptMd, expect: [{ visible: "body" }] });
      expect(viaReceipt.evidence.diff.changed).toBe(false);
      const missing = await call(c, "browser_verify", { sessionId, url: `${site.origin}/good`, evidenceDir: tmpDir(), baseline: join(tmpDir(), "nope.png"), expect: [{ visible: "body" }] });
      expect(missing.pass).toBe(false);
      expect(missing.failed[0].reason).toBe("baseline_not_found");
    });
  }, T);
});

describe("browser_verify evidence location", () => {
  test("evidence is written only inside the confined directory; outside is refused and nothing is written", async () => {
    const root = tmpDir();
    const outside = tmpDir();
    process.env.FUSE_CONFINE_WRITES = root;
    try {
      await inSession(async (c, sessionId) => {
        const bad = await call(c, "browser_verify", { sessionId, url: `${site.origin}/good`, evidenceDir: outside, expect: [{ visible: "body" }] });
        expect(JSON.stringify(bad)).toContain("path_outside_confinement");
        expect(readdirSync(outside)).toEqual([]);
        const inside = join(root, "ev");
        mkdirSync(inside, { recursive: true });
        const ok = await call(c, "browser_verify", { sessionId, url: `${site.origin}/good`, evidenceDir: inside, expect: [{ visible: "body" }] });
        expect(ok.pass).toBe(true);
        expect(readdirSync(inside).length).toBeGreaterThanOrEqual(4);
      });
    } finally {
      delete process.env.FUSE_CONFINE_WRITES;
    }
  }, T);

  test("without evidenceDir the evidence goes under <outputDir>/verify", async () => {
    const out = tmpDir();
    await inSession(async (c, _sessionId) => {
      const r = await call(c, "browser_verify", { url: `${site.origin}/good`, outputDir: out, headless: true, expect: [{ visible: "body" }] });
      expect(r.evidence.after.startsWith(join(out, "verify"))).toBe(true);
      expect(existsSync(r.evidence.after)).toBe(true);
    });
  }, T);
});
