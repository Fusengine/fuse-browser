/**
 * Evidence of a `browser_verify`: baseline resolution, pixel diff, the Markdown
 * receipt and the confined write of the files.
 * @module agent/verify-evidence
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { DiffEvidence, VerifyFailure } from "../interfaces/verify.js";
import { diffPng } from "../lib/pixel-diff.js";
import { assertPngPath } from "../lib/safe-png.js";
import { checkWriteConfinement, writeConfinedBytes } from "../lib/write-guard.js";

/** Evidence file names, relative to the evidence directory. */
export const EVIDENCE_FILES = {
  after: "after.png",
  diff: "diff.png",
  consoleLog: "console.json",
  networkLog: "network.json",
  receipt: "receipt.md",
} as const;

/**
 * Resolve `baseline` to a PNG path: a `.png` is itself, a previous receipt
 * (`.md`) is read for its `- after: <path>` line. `null` when it cannot be found.
 */
export function resolveBaseline(baseline: string): string | null {
  try {
    if (!baseline.toLowerCase().endsWith(".md")) {
      const png = assertPngPath(baseline, "baseline");
      return existsSync(png) ? png : null;
    }
    if (!existsSync(baseline)) return null;
    const path = /^- after: (.+)$/m.exec(readFileSync(baseline, "utf8"))?.[1]?.trim();
    // A receipt written by this tool names its `after.png`; any other file is not a baseline.
    return path && basename(path) === EVIDENCE_FILES.after && existsSync(path) ? path : null;
  } catch {
    return null;
  }
}

/** Diff `after` against the baseline PNG; the highlighted PNG is returned apart (written by the caller). */
export function diffAgainst(baselinePng: string, after: Buffer): { evidence: DiffEvidence; image?: Uint8Array } {
  try {
    const d = diffPng(readFileSync(baselinePng), after, 0.1);
    return {
      evidence: { diffPixels: d.diffPixels, diffRatio: d.diffRatio, regions: d.regions.length, changed: d.diffPixels > 0 },
      image: d.diffPng,
    };
  } catch (err) {
    const dimension = String(err).includes("dimension_mismatch");
    return { evidence: { diffPixels: 0, diffRatio: 0, regions: 0, changed: true, error: dimension ? "dimension_mismatch" : "diff_failed" } };
  }
}

/** Inputs of the receipt. */
export interface ReceiptInput {
  pass: boolean;
  url: string;
  title: string;
  engine: string;
  expectations: Array<Record<string, unknown>>;
  failed: VerifyFailure[];
  files: Record<string, string | undefined>;
  diff?: DiffEvidence;
}

/** Short Markdown receipt: verdict, one row per expectation, evidence paths. */
export function renderReceipt(r: ReceiptInput): string {
  const rows = r.expectations.map((exp, i) => {
    const f = r.failed.find((x) => JSON.stringify(x.expect) === JSON.stringify(exp));
    return `| ${i + 1} | \`${JSON.stringify(exp)}\` | ${f ? "FAIL" : "pass"} | ${f ? f.reason : ""} |`;
  });
  const extra = r.failed.filter((f) => !r.expectations.some((e) => JSON.stringify(e) === JSON.stringify(f.expect)));
  const lines = [
    "# browser_verify receipt",
    "",
    `- result: ${r.pass ? "PASS" : "FAIL"}`,
    `- url: ${r.url}`,
    `- title: ${r.title}`,
    `- engine: ${r.engine}`,
    `- time: ${new Date().toISOString()}`,
    "",
    "| # | expectation | result | reason |",
    "| --- | --- | --- | --- |",
    ...rows,
    ...extra.map((f) => `| - | \`${JSON.stringify(f.expect)}\` | FAIL | ${f.reason} |`),
    "",
    "## Evidence",
    ...Object.entries(r.files).filter(([, v]) => v).map(([k, v]) => `- ${k}: ${v}`),
  ];
  if (r.diff) lines.push(`- diff: ${r.diff.changed ? `changed (${r.diff.diffPixels} px, ${r.diff.regions} region(s))` : "no change"}${r.diff.error ? ` [${r.diff.error}]` : ""}`);
  return `${lines.join("\n")}\n`;
}

/**
 * Reject an evidence directory outside `FUSE_CONFINE_WRITES` (same rule as
 * screenshots), before anything is written.
 *
 * @returns The refusal message, or `undefined` when the directory may be used.
 */
export function checkEvidenceDir(dir: string): string | undefined {
  return checkWriteConfinement(join(dir, EVIDENCE_FILES.receipt));
}

/** Write evidence files into `dir` through the confined writer (`O_NOFOLLOW` when confinement is on). */
export function writeEvidenceFiles(dir: string, files: Record<string, Uint8Array>): void {
  for (const [name, data] of Object.entries(files)) writeConfinedBytes(join(dir, name), data);
}
