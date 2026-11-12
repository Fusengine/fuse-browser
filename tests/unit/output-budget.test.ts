import { describe, expect, test } from "bun:test";
import { jsonResult } from "../../src/server/result.js";
import { estimateTokens } from "../../src/server/token-estimate.js";
import { budgetClient, call, ITEMS, MULTIBYTE, TEXT, TRICKY } from "./helpers/budget-client.js";

describe("budgetResult: defaults off", () => {
  test("no budget params: result is byte-identical to jsonResult", async () => {
    const c = await budgetClient();
    const r = await call(c, "big_text");
    expect(r.content).toEqual(jsonResult({ url: "https://x.test/", text: TEXT }).content);
    expect(r.structuredContent).toEqual({ url: "https://x.test/", text: TEXT });
    const l = await call(c, "big_list");
    expect(l.content).toEqual(jsonResult({ count: ITEMS.length, elements: ITEMS }).content);
  });

  test("outputMode:'inline' alone is also a no-op", async () => {
    const r = await call(await budgetClient(), "big_text", { outputMode: "inline" });
    expect(r.structuredContent).toEqual({ url: "https://x.test/", text: TEXT });
  });
});

describe("budgetResult: maxTokens on a string field", () => {
  test("stays within budget and pages losslessly via nextOffset", async () => {
    const c = await budgetClient();
    let offset = 0;
    let rebuilt = "";
    let pages = 0;
    for (;;) {
      const out = (await call(c, "big_text", { maxTokens: 120, offset })).structuredContent;
      const text = out.text as string;
      expect(estimateTokens(Buffer.byteLength(text, "utf8"))).toBeLessThanOrEqual(120);
      rebuilt += text;
      pages++;
      if (out.nextOffset === undefined) break;
      expect(out.nextOffset).toBe(offset + text.length);
      expect(text.length).toBeGreaterThan(0);
      offset = out.nextOffset as number;
    }
    expect(pages).toBeGreaterThan(1);
    expect(rebuilt).toBe(TEXT);
  });

  test("clean cut: a truncated page ends right before a paragraph break, not mid-word", async () => {
    const out = (await call(await budgetClient(), "big_text", { maxTokens: 120 })).structuredContent;
    const text = out.text as string;
    expect(out.nextOffset).toBe(text.length);
    expect(out.truncated).toBeUndefined(); // the budget never writes `truncated`: pagination = nextOffset present
    expect(TEXT.slice(text.length, text.length + 2)).toBe("\n\n");
  });

  test("fits: no truncated flag, approxTokens reported", async () => {
    const out = (await call(await budgetClient(), "big_text", { maxTokens: 100000 })).structuredContent;
    expect(out.truncated).toBeUndefined();
    expect(out.text).toBe(TEXT);
    expect(typeof out.approxTokens).toBe("number");
  });

  test("multi-byte text is never split mid-character and stays within the byte budget", async () => {
    const c = await budgetClient();
    let offset = 0;
    let rebuilt = "";
    for (;;) {
      const out = (await call(c, "multibyte", { maxTokens: 25, offset })).structuredContent;
      const t = out.text as string;
      expect(t).not.toContain("�");
      expect(Buffer.byteLength(t, "utf8")).toBeLessThanOrEqual(100);
      rebuilt += t;
      if (out.nextOffset === undefined) break;
      offset = out.nextOffset as number;
    }
    expect(rebuilt).toBe(MULTIBYTE);
  });

  test("a literal U+FFFD and a lone surrogate in the source are kept exactly and the byte cap holds", async () => {
    const c = await budgetClient();
    let offset = 0;
    let rebuilt = "";
    for (;;) {
      const out = (await call(c, "tricky", { maxTokens: 1, offset })).structuredContent;
      const t = out.text as string;
      expect(Buffer.byteLength(t, "utf8")).toBeLessThanOrEqual(4);
      rebuilt += t;
      if (out.nextOffset === undefined) break;
      expect(out.nextOffset as number).toBeGreaterThan(offset);
      offset = out.nextOffset as number;
    }
    expect(rebuilt).toBe(TRICKY);
  });

  test("an offset past the end returns an empty, non-truncated page", async () => {
    const out = (await call(await budgetClient(), "big_text", { maxTokens: 50, offset: TEXT.length + 10 })).structuredContent;
    expect(out.text).toBe("");
    expect(out.truncated).toBeUndefined();
  });
});

describe("budgetResult: maxTokens on an array field", () => {
  test("pages whole items and always makes progress", async () => {
    const c = await budgetClient();
    let offset = 0;
    const seen: unknown[] = [];
    for (;;) {
      const out = (await call(c, "big_list", { maxTokens: 40, offset })).structuredContent;
      const els = out.elements as unknown[];
      expect(els.length).toBeGreaterThan(0);
      seen.push(...els);
      if (out.nextOffset === undefined) break;
      expect(out.nextOffset).toBe(offset + els.length);
      offset = out.nextOffset as number;
    }
    expect(seen).toEqual(ITEMS);
  });

  test("a list holding an undefined item pages without throwing", async () => {
    const out = (await call(await budgetClient(), "with_undefined", { maxTokens: 1 })).structuredContent;
    expect(out.nextOffset).toBe(1);
  });

  test("a budget smaller than one item still returns that item", async () => {
    const out = (await call(await budgetClient(), "big_list", { maxTokens: 1 })).structuredContent;
    expect((out.elements as unknown[]).length).toBe(1);
    expect(out.nextOffset).toBe(1);
  });
});

describe("budgetResult: a tool's own `truncated` keeps its meaning", () => {
  test("own truncated:false stays false when maxTokens cuts (pagination = nextOffset present)", async () => {
    const out = (await call(await budgetClient(), "own_false", { maxTokens: 50 })).structuredContent;
    expect(out.truncated).toBe(false);
    expect(typeof out.nextOffset).toBe("number");
    expect((out.text as string).length).toBeLessThan(TEXT.length);
  });

  test("own truncated:true stays true when maxTokens does not cut (no nextOffset)", async () => {
    const out = (await call(await budgetClient(), "own_true", { maxTokens: 100000 })).structuredContent;
    expect(out.truncated).toBe(true);
    expect(out.nextOffset).toBeUndefined();
    expect(out.text).toBe("short");
  });

  test("without budget params a payload with its own truncated is byte-identical", async () => {
    const c = await budgetClient();
    for (const [tool, payload] of [["own_false", { truncated: false, text: TEXT }], ["own_true", { truncated: true, text: "short" }]] as const) {
      expect((await call(c, tool)).content).toEqual(jsonResult(payload).content);
    }
  });
});
