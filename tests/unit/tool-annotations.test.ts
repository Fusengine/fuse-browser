import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { TOOL_ANNOTATIONS } from "../../src/server/tool-annotations.js";
import { createServer } from "../../src/server/server.js";
import { listAdvertisedTools } from "../../src/server/tool-sizes.js";

const savedCaps = process.env.FUSE_CAPS;
const savedPreset = process.env.FUSE_PRESET;
beforeEach(() => {
  delete process.env.FUSE_CAPS;
  delete process.env.FUSE_PRESET;
});
afterEach(() => {
  if (savedCaps === undefined) delete process.env.FUSE_CAPS;
  else process.env.FUSE_CAPS = savedCaps;
  if (savedPreset === undefined) delete process.env.FUSE_PRESET;
  else process.env.FUSE_PRESET = savedPreset;
});

/** `tools/list` of the default server, through the real MCP protocol (in-memory). */
const advertised = () => listAdvertisedTools(createServer());

/** Tools that only observe: must be advertised `readOnlyHint: true`. */
const READ_ONLY = [
  "browser_fetch",
  "browser_fetch_batch",
  "browser_crawl",
  "browser_collect_batch",
  "browser_snapshot",
  "browser_extract",
  "browser_extract_schema",
  "browser_products",
  "browser_inspect",
  "browser_console",
  "browser_network",
  "browser_status",
  "browser_vault",
];

/**
 * Tools with a write side effect on SOME input (a caller `path`, `harPath`/`outputDir`
 * agent options, saved screenshots/baselines/PDFs, cookie set/clear...): a client that
 * auto-approves read-only tools must still be asked, so they are never `readOnlyHint:true`.
 */
const WRITE_CAPABLE = [
  "browser_screenshot",
  "browser_probe",
  "browser_probe_html",
  "browser_serp_batch",
  "browser_shots_batch",
  "browser_site_shots",
  "browser_pdf",
  "browser_visual_diff",
  "browser_cookies",
  "browser_metrics",
];

/** Tools that change page/session state: must NOT be advertised read-only. */
const ACTIONS = [
  "browser_click",
  "browser_fill",
  "browser_act",
  "browser_run",
  "browser_navigate",
  "browser_press",
  "browser_type",
  "browser_select",
  "browser_login",
  "browser_cookies",
  "browser_close",
  "browser_open",
];

/** Tools that may trigger irreversible effects (submit, delete, clear). */
const DESTRUCTIVE = ["browser_click", "browser_act", "browser_press", "browser_run", "browser_cookies"];

describe("tool annotations (central table applied at registration)", () => {
  test("every registered tool is advertised with its table entry and an explicit readOnlyHint", async () => {
    const tools = await advertised();
    expect(tools).toHaveLength(Object.keys(TOOL_ANNOTATIONS).length);
    for (const tool of tools) {
      const entry = TOOL_ANNOTATIONS[tool.name];
      expect(entry, `${tool.name} has no TOOL_ANNOTATIONS entry`).toBeDefined();
      expect(tool.annotations, `${tool.name} advertises no annotations`).toEqual(entry);
      expect(typeof tool.annotations?.readOnlyHint, `${tool.name}.readOnlyHint`).toBe("boolean");
    }
  });

  test("the table has no entry for a tool that is not registered", async () => {
    const names = new Set((await advertised()).map((t) => t.name));
    expect(Object.keys(TOOL_ANNOTATIONS).filter((n) => !names.has(n))).toEqual([]);
  });

  test("read-only tools are readOnlyHint:true", async () => {
    const byName = new Map((await advertised()).map((t) => [t.name, t]));
    for (const name of READ_ONLY) expect(byName.get(name)?.annotations?.readOnlyHint, name).toBe(true);
  });

  test("destructive tools keep the spec-default destructiveHint (not overridden to false)", async () => {
    const byName = new Map((await advertised()).map((t) => [t.name, t]));
    for (const name of DESTRUCTIVE) expect(byName.get(name)?.annotations?.destructiveHint, name).not.toBe(false);
    for (const name of ["browser_navigate", "browser_fill", "browser_close"]) {
      expect(byName.get(name)?.annotations?.destructiveHint, name).toBe(false);
    }
  });

  test("write-capable tools (path / harPath / outputDir / baselines) are not readOnlyHint", async () => {
    const byName = new Map((await advertised()).map((t) => [t.name, t]));
    for (const name of WRITE_CAPABLE) expect(byName.get(name)?.annotations?.readOnlyHint, name).toBe(false);
  });

  test("action tools are not readOnlyHint", async () => {
    const byName = new Map((await advertised()).map((t) => [t.name, t]));
    for (const name of ACTIONS) expect(byName.get(name)?.annotations?.readOnlyHint, name).toBe(false);
  });

  test("a read-only tool never carries destructive/idempotent hints (meaningless, costs tokens)", () => {
    for (const [name, a] of Object.entries(TOOL_ANNOTATIONS)) {
      if (a.readOnlyHint) {
        expect(a.destructiveHint, name).toBeUndefined();
        expect(a.idempotentHint, name).toBeUndefined();
      }
    }
  });
});
