import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { registerCrawlTool } from "../../src/server/tools/crawl.js";
import { registerFetchTool } from "../../src/server/tools/fetch.js";
import { registerFetchBatchTool } from "../../src/server/tools/fetch-batch.js";
import { article } from "./helpers/block-pages.js";
import { type DocServer, serveDocs } from "./helpers/docs-server.js";
import { callTool } from "./helpers/tool-client.js";

// The token-budget helper (`maxTokens`/`offset`, owned by token-diet) is wired into
// the three big-output fast-path tools. Defaults stay off: no budget param = unchanged output.

let server: DocServer;
beforeAll(() => {
  const link = (p: string) => `<a href="${p}">${p}</a>`;
  server = serveDocs({
    "/a": { body: article("Page A", [1, 2, 3].map((i) => link(`/p${i}`)).join(" ")) },
    "/p1": { body: article("P1") },
    "/p2": { body: article("P2") },
    "/p3": { body: article("P3") },
  });
});
afterAll(() => server.stop());

describe("budget wiring on fetch / fetch_batch / crawl", () => {
  test("browser_fetch: maxTokens cuts `text` and says where to resume; resuming at nextOffset continues", async () => {
    const url = `${server.origin}/a`;
    const full = await callTool(registerFetchTool, "browser_fetch", { url });
    const cut = await callTool(registerFetchTool, "browser_fetch", { url, maxTokens: 60 });
    expect(cut.isError).toBe(false);
    expect(typeof cut.out.nextOffset).toBe("number"); // the budget signals a cut with `nextOffset` only…
    expect(cut.out.truncated).toBeUndefined(); // …`truncated` belongs to the tool (the fetch family has none)
    expect(cut.out.text.length).toBeLessThan(full.out.text.length);
    const rest = await callTool(registerFetchTool, "browser_fetch", { url, maxTokens: 60, offset: cut.out.nextOffset });
    expect(`${cut.out.text}${rest.out.text}`.startsWith(full.out.text.slice(0, 40))).toBe(true);
    expect(full.out.nextOffset).toBeUndefined(); // no budget → no budget keys, byte-identical default
    expect(full.out.truncated).toBeUndefined();
  });

  test("browser_fetch_batch: maxTokens pages the results array by item", async () => {
    const urls = [1, 2, 3].map((i) => `${server.origin}/p${i}`);
    const full = await callTool(registerFetchBatchTool, "browser_fetch_batch", { urls });
    const cut = await callTool(registerFetchBatchTool, "browser_fetch_batch", { urls, maxTokens: 150 });
    expect(full.out.results).toHaveLength(3);
    expect(typeof cut.out.nextOffset).toBe("number");
    expect(cut.out.truncated).toBeUndefined();
    expect(cut.out.results.length).toBeLessThan(3);
  });

  test("browser_crawl: maxTokens pages the pages array by item", async () => {
    const args = { url: `${server.origin}/a`, maxDepth: 1, respectRobots: false, throttleMs: 0 };
    const full = await callTool(registerCrawlTool, "browser_crawl", args);
    const cut = await callTool(registerCrawlTool, "browser_crawl", { ...args, maxTokens: 150 });
    expect(full.out.pages.length).toBeGreaterThanOrEqual(3);
    expect(typeof cut.out.nextOffset).toBe("number");
    expect(cut.out.truncated).toBeUndefined();
    expect(cut.out.pages.length).toBeLessThan(full.out.pages.length);
  });
});
