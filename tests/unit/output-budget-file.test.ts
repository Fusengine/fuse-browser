import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { budgetClient, call, ITEMS, TEXT } from "./helpers/budget-client.js";

let dir = "";
const saved = { out: process.env.FUSE_OUTPUT_DIR, confine: process.env.FUSE_CONFINE_WRITES };
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "fuse-budget-")));
  process.env.FUSE_OUTPUT_DIR = dir;
  delete process.env.FUSE_CONFINE_WRITES;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  for (const [k, v] of [
    ["FUSE_OUTPUT_DIR", saved.out],
    ["FUSE_CONFINE_WRITES", saved.confine],
  ] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("budgetResult: outputMode file", () => {
  test("writes the full text under FUSE_OUTPUT_DIR and returns path, bytes, preview", async () => {
    const out = (await call(await budgetClient(), "big_text", { outputMode: "file" })).structuredContent;
    expect(out.outputMode).toBe("file");
    const path = out.path as string;
    expect(path.startsWith(join(dir, "offload"))).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(TEXT);
    expect(out.bytes).toBe(statSync(path).size);
    expect(typeof out.preview).toBe("string");
    expect(TEXT.startsWith(out.preview as string)).toBe(true);
    expect((out.preview as string).length).toBeLessThan(TEXT.length);
    expect(out.url).toBe("https://x.test/");
    expect(out.text).toBe(out.preview);
  });

  test("same content writes the same file (content-addressed, no clock)", async () => {
    const c = await budgetClient();
    const a = (await call(c, "big_text", { outputMode: "file" })).structuredContent.path;
    const b = (await call(c, "big_text", { outputMode: "file" })).structuredContent.path;
    expect(a).toBe(b);
  });

  test("an array field is written as JSON and replaced by an empty array", async () => {
    const out = (await call(await budgetClient(), "big_list", { outputMode: "file" })).structuredContent;
    expect(JSON.parse(readFileSync(out.path as string, "utf8"))).toEqual(ITEMS);
    expect(out.elements).toEqual([]);
    expect(out.count).toBe(ITEMS.length);
  });

  test("FUSE_CONFINE_WRITES outside the output dir: nothing written, result stays inline with outputError", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "fuse-conf-")));
    process.env.FUSE_CONFINE_WRITES = root;
    try {
      const out = (await call(await budgetClient(), "big_text", { outputMode: "file" })).structuredContent;
      expect(out.outputError).toBe("path_outside_confinement");
      expect(out.text).toBe(TEXT);
      expect(out.path).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a field that is neither text nor a list: nothing written, outputError says why, payload kept", async () => {
    const c = await budgetClient();
    for (const tool of ["scalar", "absent_field"]) {
      const out = (await call(c, tool, { outputMode: "file" })).structuredContent;
      expect(out.outputError, tool).toBe("field_not_offloadable");
      expect(out.count, tool).toBe(3);
      expect(out.path, tool).toBeUndefined();
    }
  });

  test("the same payload without outputMode:'file' is untouched (no outputError)", async () => {
    const out = (await call(await budgetClient(), "scalar", { maxTokens: 10 })).structuredContent;
    expect(out).toEqual({ count: 3 });
  });

  test("FUSE_CONFINE_WRITES covering the output dir: the offload is written", async () => {
    process.env.FUSE_CONFINE_WRITES = dir;
    const out = (await call(await budgetClient(), "big_text", { outputMode: "file" })).structuredContent;
    expect(readFileSync(out.path as string, "utf8")).toBe(TEXT);
  });
});
