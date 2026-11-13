import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { CAP_GROUPS } from "../../src/server/caps.js";
import { getPreset, isPresetName, PRESET_NAMES, parsePreset } from "../../src/server/presets.js";
import { createServer } from "../../src/server/server.js";
import { TOOL_ANNOTATIONS } from "../../src/server/tool-annotations.js";
import { listAdvertisedTools, measureSurface, sizeTool, totalSizes } from "../../src/server/tool-sizes.js";

/** Every registered tool = every annotated tool (the coverage test pins table and server together). */
const ALL = Object.keys(TOOL_ANNOTATIONS).length;
const errSpy = spyOn(console, "error").mockImplementation(() => {});
const savedCaps = process.env.FUSE_CAPS;
const savedPreset = process.env.FUSE_PRESET;
beforeEach(() => {
  delete process.env.FUSE_CAPS;
  delete process.env.FUSE_PRESET;
});
afterEach(() => {
  errSpy.mockClear();
  if (savedCaps === undefined) delete process.env.FUSE_CAPS;
  else process.env.FUSE_CAPS = savedCaps;
  if (savedPreset === undefined) delete process.env.FUSE_PRESET;
  else process.env.FUSE_PRESET = savedPreset;
});

const names = async (opts?: Parameters<typeof createServer>[0]) =>
  (await listAdvertisedTools(createServer(opts))).map((t) => t.name);

describe("parsePreset", () => {
  test("blank / undefined is full", () => {
    expect(parsePreset(undefined)).toBe("full");
    expect(parsePreset("  ")).toBe("full");
  });
  test("known names, case and whitespace tolerant", () => {
    expect(parsePreset(" DOCS ")).toBe("docs");
    expect(parsePreset("qa")).toBe("qa");
  });
  test("unknown name is reported on stderr and falls back to full", () => {
    expect(parsePreset("bogus")).toBe("full");
    expect(String(errSpy.mock.calls[0]?.[0])).toContain('unknown FUSE_PRESET "bogus"');
  });
  test("isPresetName", () => {
    expect(PRESET_NAMES).toEqual(["full", "docs", "qa"]);
    expect(isPresetName("docs")).toBe(true);
    expect(isPresetName("nope")).toBe(false);
  });
});

describe("preset definitions", () => {
  test("every allow-listed tool exists in the annotation table (= is a real tool)", () => {
    for (const name of PRESET_NAMES) {
      for (const tool of getPreset(name).tools ?? []) expect(TOOL_ANNOTATIONS[tool], `${name}: ${tool}`).toBeDefined();
    }
  });
});

describe("createServer with a preset", () => {
  test("default (no env, no option) exposes every annotated tool", async () => {
    expect(await names()).toHaveLength(ALL);
  });

  test("preset full exposes the same tools as the default", async () => {
    expect(new Set(await names({ preset: "full" }))).toEqual(new Set(await names()));
  });

  test("docs exposes exactly its allow-list", async () => {
    expect((await names({ preset: "docs" })).sort()).toEqual([...(getPreset("docs").tools ?? [])].sort());
  });

  test("qa exposes exactly its allow-list", async () => {
    expect((await names({ preset: "qa" })).sort()).toEqual([...(getPreset("qa").tools ?? [])].sort());
  });

  test("FUSE_PRESET selects the preset when no option is passed", async () => {
    process.env.FUSE_PRESET = "docs";
    expect(await names()).toHaveLength(getPreset("docs").tools?.length ?? -1);
  });

  test("an explicit option wins over FUSE_PRESET", async () => {
    process.env.FUSE_PRESET = "docs";
    expect(await names({ preset: "full" })).toHaveLength(ALL);
  });

  test("FUSE_CAPS narrows on top of a preset (both must allow a tool)", async () => {
    process.env.FUSE_CAPS = "debug";
    expect((await names({ preset: "qa" })).sort()).toEqual(["browser_console", "browser_network", "browser_visual_diff"]);
  });

  test("a preset and FUSE_CAPS with no common group never yield an empty server: caps ignored, stderr notice", async () => {
    process.env.FUSE_CAPS = "core";
    expect((await names({ preset: "docs" })).sort()).toEqual([...(getPreset("docs").tools ?? [])].sort());
    expect(String(errSpy.mock.calls.at(-1)?.[0])).toContain("no common tool group");
    process.env.FUSE_CAPS = "batch";
    expect(await names({ preset: "qa" })).toHaveLength(getPreset("qa").tools?.length ?? -1);
  });

  test("a removed tool is gone from tools/list and keeps its annotations on the rest", async () => {
    const tools = await listAdvertisedTools(createServer({ preset: "docs" }));
    expect(tools.map((t) => t.name)).not.toContain("browser_click");
    for (const t of tools) expect(t.annotations).toEqual(TOOL_ANNOTATIONS[t.name]);
  });
});

describe("tool size measurement", () => {
  test("sizeTool counts UTF-8 bytes of the four definition fields; tokens = ceil(bytes/4)", () => {
    const tool = { name: "t", description: "é", inputSchema: { type: "object" as const }, annotations: { readOnlyHint: true } };
    const s = sizeTool(tool);
    const expected = Buffer.byteLength(JSON.stringify({ name: "t", description: "é", inputSchema: { type: "object" } }), "utf8");
    expect(s.bytes).toBe(expected);
    expect(s.tokens).toBe(Math.ceil(expected / 4));
    expect(s.fullBytes).toBeGreaterThan(s.bytes);
  });

  test("measureSurface: presets are strictly smaller than full, and totals add up", async () => {
    const full = totalSizes(await measureSurface("full"));
    const docs = totalSizes(await measureSurface("docs"));
    const qa = totalSizes(await measureSurface("qa"));
    expect(full.tools).toBe(ALL);
    expect(docs.bytes).toBeLessThan(full.bytes);
    expect(qa.bytes).toBeLessThan(full.bytes);
    expect(docs.tools + qa.tools).toBeLessThan(full.tools);
  });

  test("caps groups still partition the full surface", async () => {
    let count = 0;
    for (const g of CAP_GROUPS) count += (await measureSurface("full", new Set([g]))).length;
    expect(count).toBe(ALL);
  });
});
