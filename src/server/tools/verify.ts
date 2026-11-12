/**
 * `browser_verify`: one call that loads (or takes) a page, checks the agent's
 * expectations, and leaves a receipt: after screenshot, optional baseline diff,
 * console and network logs, and a Markdown receipt. Deterministic: no model
 * decides anything; every verdict comes from an expectation the agent wrote.
 * @module server/tools/verify
 */
import { join, resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveConfig } from "../../agent/config.js";
import { evaluateExpectations } from "../../agent/verify-checks.js";
import {
  checkEvidenceDir,
  diffAgainst,
  EVIDENCE_FILES,
  renderReceipt,
  resolveBaseline,
  writeEvidenceFiles,
} from "../../agent/verify-evidence.js";
import { loadPage, pageProbe, recordPage } from "../../agent/verify-page.js";
import { detectSessionBlock } from "../../extraction/challenge-verdict.js";
import type { Expectation, VerifyEvidence } from "../../interfaces/verify.js";
import type { SessionManager } from "../../session/manager.js";
import type { SessionData } from "../../session/session.js";
import { toAgentOptions } from "../map-options.js";
import { errorResult, jsonResult } from "../result.js";
import { agentOptionShape } from "../schemas.js";
import { expectationSchema, verifyOutputShape } from "./verify-output.js";
import { withSession } from "./with-session.js";

export { verifyOutputShape } from "./verify-output.js";

const DESCRIPTION =
  "Check that a page (or a live session's current page) meets YOUR expectations and get a receipt, in one call. `expect` is a list of {text:\"...\"} (visible body text contains it), {visible:\"css selector\"}, {noConsoleErrors:true} (no console error and no uncaught exception), {noFailedRequests:true} (no response >= 400 and no network failure). Give `url` (loads it; only what happens from then on counts; with no `sessionId` a temporary session is opened and closed) and/or `sessionId` (with no `url` the session's own buffers are checked: last 250 requests, no exceptions). `pass` is true only if every expectation holds AND the page is not an anti-bot interstitial the session detector recognises (Cloudflare, DataDome, AWS WAF, a bare captcha widget): then a `blocked:<vendor>` failure. Console capture is disabled upstream on the default patchright engine: a clean `noConsoleErrors` there fails with `console_unavailable_on_patchright` (`consoleAvailable:false`) instead of passing silently; use engine:\"playwright\" to check the console. `baseline` = a previous after.png or receipt.md: `evidence.diff` reports the pixel change (informational, never fails). Evidence (after.png, diff.png, console.json, network.json, receipt.md) goes to `evidenceDir` or <outputDir>/verify/, both confined like screenshots. No video, tracing or accessibility audit.";

/** Run the verification on a live session. */
async function verifyOn(s: SessionData, a: Record<string, unknown>) {
  const loading = typeof a.url === "string";
  // With `url` only what happens from now on counts; without it the session's own buffer is checked.
  const seenNet = new Set(loading ? s.logs.network : []);
  const seenCon = new Set(loading ? s.logs.console : []);
  const evDir = typeof a.evidenceDir === "string" ? resolve(a.evidenceDir) : undefined;
  const dir = evDir ?? join(s.config.outputDir, "verify", `verify-${new Date().toISOString().replace(/[:.]/g, "-")}-${s.id}`);
  const refused = checkEvidenceDir(dir);
  if (refused) return errorResult(refused, "path_outside_confinement");
  const { rec, stop } = recordPage(s.page);
  try {
    if (loading) await loadPage(s.page, a.url as string);
  } catch (err) {
    return errorResult(`navigation failed: ${String(err)}`, "navigation_failed");
  } finally {
    stop();
  }
  const expectations = (a.expect as Expectation[]) ?? [];
  const logs = {
    network: s.logs.network.filter((e) => !seenNet.has(e)),
    console: s.logs.console.filter((e) => !seenCon.has(e)),
    engine: s.config.engine,
    ...(loading ? { failedRequests: rec.failed, pageErrors: rec.pageErrors } : {}),
  };
  const { failed, consoleAvailable } = await evaluateExpectations(expectations, pageProbe(s.page), logs);
  const block = await detectSessionBlock(s.page);
  if (block) failed.push({ expect: { pageNotBlocked: true }, reason: `blocked:${block.blockedBy}` });
  const after = await s.page.screenshot({ fullPage: a.fullPage === true });
  const files: Record<string, Uint8Array> = { [EVIDENCE_FILES.after]: after };
  const evidence: VerifyEvidence = {
    after: join(dir, EVIDENCE_FILES.after),
    consoleLog: join(dir, EVIDENCE_FILES.consoleLog),
    networkLog: join(dir, EVIDENCE_FILES.networkLog),
    receiptMd: join(dir, EVIDENCE_FILES.receipt),
  };
  if (typeof a.baseline === "string") {
    const png = resolveBaseline(a.baseline);
    if (!png) failed.push({ expect: { baseline: a.baseline }, reason: "baseline_not_found" });
    else {
      const d = diffAgainst(png, after);
      evidence.before = png;
      evidence.diff = d.evidence;
      if (d.image) {
        files[EVIDENCE_FILES.diff] = d.image;
        evidence.diff.image = join(dir, EVIDENCE_FILES.diff);
      }
    }
  }
  const pass = failed.length === 0;
  const title = await s.page.title().catch(() => "");
  files[EVIDENCE_FILES.consoleLog] = Buffer.from(JSON.stringify(logs.console, null, 2));
  files[EVIDENCE_FILES.networkLog] = Buffer.from(JSON.stringify(logs.network, null, 2));
  files[EVIDENCE_FILES.receipt] = Buffer.from(
    renderReceipt({
      pass,
      url: s.page.url(),
      title,
      engine: s.config.engine,
      expectations: expectations as Array<Record<string, unknown>>,
      failed,
      files: { after: evidence.after, before: evidence.before, diffImage: evidence.diff?.image, console: evidence.consoleLog, network: evidence.networkLog },
      diff: evidence.diff,
    }),
  );
  try {
    writeEvidenceFiles(dir, files);
  } catch (err) {
    return errorResult(`could not write evidence: ${String(err)}`, "evidence_write_failed");
  }
  return jsonResult({ pass, url: s.page.url(), title, failed, consoleAvailable, evidence, ...(block ?? {}) });
}

/** Register `browser_verify`. */
export function registerVerifyTool(server: McpServer, sessions: SessionManager): void {
  server.registerTool(
    "browser_verify",
    {
      title: "Verify page",
      description: DESCRIPTION,
      inputSchema: {
        ...agentOptionShape,
        sessionId: z.string().optional(),
        url: z.string().optional(),
        expect: z.array(expectationSchema).min(1),
        baseline: z.string().optional(),
        evidenceDir: z.string().optional(),
        fullPage: z.boolean().optional(),
      },
      outputSchema: verifyOutputShape,
    },
    async (args) => {
      const a = args as Record<string, unknown>;
      if (typeof a.sessionId === "string") return withSession(sessions, a.sessionId, (s) => verifyOn(s, a));
      if (typeof a.url !== "string") return errorResult("browser_verify needs a `url` or a `sessionId`");
      const own = await sessions.open(resolveConfig(toAgentOptions(a)));
      try {
        return await withSession(sessions, own.id, (s) => verifyOn(s, a));
      } finally {
        await sessions.close(own.id).catch(() => {});
      }
    },
  );
}
