import { describe, expect, test } from "bun:test";
import { getPreset } from "../../src/server/presets.js";
import { TOOL_ANNOTATIONS } from "../../src/server/tool-annotations.js";

/** Run a bin entry point as a real subprocess (the public entry point, real argv). */
function run(entry: string, args: string[], env: Record<string, string> = {}) {
  const proc = Bun.spawnSync(["node", "--import", "tsx", entry, ...args], {
    env: { ...process.env, FUSE_PRESET: "", FUSE_CAPS: "", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: proc.exitCode, out: proc.stdout.toString(), err: proc.stderr.toString() };
}

const CLI = "src/bin/cli.ts";
const MCP = "src/bin/mcp.ts";

describe("fuse-browser tools --tokens", () => {
  test("prints the per-tool table, group subtotals, total and the estimate method", () => {
    const r = run(CLI, ["tools", "--tokens"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("preset full");
    expect(r.out).toContain("estimate");
    expect(r.out).toContain("browser_fetch");
    expect(r.out).toMatch(new RegExp(`TOTAL\\s+${Object.keys(TOOL_ANNOTATIONS).length} tools`));
    expect(r.out).toMatch(/core\s+\d+ tools/);
  });

  test("--preset docs lists only the docs tools", () => {
    const r = run(CLI, ["tools", "--tokens", "--preset", "docs"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("preset docs");
    expect(r.out).toMatch(new RegExp(`TOTAL\\s+${getPreset("docs").tools?.length} tools`));
    expect(r.out).not.toContain("browser_click");
  });

  test("FUSE_PRESET selects the active preset", () => {
    const r = run(CLI, ["tools", "--tokens"], { FUSE_PRESET: "qa" });
    expect(r.out).toContain("preset qa");
    expect(r.out).toMatch(new RegExp(`TOTAL\\s+${getPreset("qa").tools?.length} tools`));
  });

  test("an unknown --preset is an error (exit 1) naming the known presets", () => {
    const r = run(CLI, ["tools", "--tokens", "--preset", "bogus"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("unknown preset 'bogus'");
    expect(r.err).toContain("full, docs, qa");
  });

  test("`tools` without --tokens falls through to the usage error", () => {
    const r = run(CLI, ["tools"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("tools --tokens");
  });
});

describe("browser-mcp --preset", () => {
  test("an unknown preset exits 1 before the stdio transport binds", () => {
    const r = run(MCP, ["--preset", "bogus"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("unknown preset 'bogus'");
    expect(r.out).toBe("");
  });

  test("an unknown flag is still rejected", () => {
    const r = run(MCP, ["--nope"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("Unknown option '--nope'");
  });

  test("--help documents --preset", () => {
    const r = run(MCP, ["--help"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("--preset full|docs|qa");
  });
});
