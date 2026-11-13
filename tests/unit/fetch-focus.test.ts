import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { renderFetch } from "../../src/agent/fetch-render.js";
import { resolveFetchBody } from "../../src/agent/fetch-resolve.js";
import { fetchFast } from "../../src/net/fetch-fast.js";
import { registerFetchTool } from "../../src/server/tools/fetch.js";
import { type DocServer, serveDocs } from "./helpers/docs-server.js";
import { callTool } from "./helpers/tool-client.js";

// `browser_fetch {focus, topK}`: model-free BM25 passages over the extracted
// markdown, through the real tool. Off by default; no `focus` = unchanged output.

const filler = (w: string, n: number): string => Array.from({ length: n }, (_, i) => `${w}${i % 7}`).join(" ");
const SECTIONS: Array<[string, string]> = [
  ["Authentication", `Clients authenticate with an API key sent in the Authorization header. Keys are scoped per project. ${filler("auth", 40)}`],
  ["Refresh token rotation", `Every refresh token can be used once. When you exchange a refresh token the server rotates it and returns a new refresh token, invalidating the previous one. Token rotation limits replay. ${filler("rotate", 30)}`],
  ["Rate limits", `Requests are limited to 100 per minute per key. Exceeding the quota returns HTTP 429 with a retry hint. ${filler("quota", 40)}`],
  ["Pagination", `List endpoints return a cursor. Pass the cursor to fetch the next page of results. ${filler("cursor", 40)}`],
];
const PAGE = `<!DOCTYPE html><html><head><title>API guide</title></head><body><nav>Home Docs</nav><article><h1>API guide</h1>${SECTIONS.map(([h, p]) => `<h2>${h}</h2><p>${p}</p>`).join("")}</article></body></html>`;

let server: DocServer;
beforeAll(() => {
  server = serveDocs({
    "/guide": { body: PAGE },
    "/notes.txt": { body: "Kubernetes ingress controllers route traffic.\n\nPostgres vacuum reclaims dead tuples and prevents bloat.\n\nRedis eviction policies decide which keys to drop.", contentType: "text/plain" },
  });
});
afterAll(() => server.stop());

const fetchTool = (args: Record<string, unknown>) => callTool(registerFetchTool, "browser_fetch", { url: `${server.origin}/guide`, ...args });

describe("browser_fetch focus/topK", () => {
  test("ranks the matching section first, best score first, at most topK", async () => {
    const r = await fetchTool({ focus: "refresh token rotation", topK: 2 });
    expect(r.isError).toBe(false);
    const p = r.out.passages as Array<{ heading: string; text: string; score: number }>;
    expect(p.length).toBeLessThanOrEqual(2);
    expect(p[0]?.heading).toBe("Refresh token rotation");
    expect(p[0]?.text).toContain("rotates it and returns a new refresh token");
    expect(p.every((x) => x.score > 0)).toBe(true);
    expect(p.map((x) => x.score)).toEqual([...p.map((x) => x.score)].sort((a, b) => b - a));
  });

  test("a different question lands on a different section", async () => {
    const p = (await fetchTool({ focus: "how many requests per minute, HTTP 429 quota" })).out.passages as Array<{ heading: string }>;
    expect(p[0]?.heading).toBe("Rate limits");
  });

  test("topK defaults to 3", async () => {
    const p = (await fetchTool({ focus: "token key requests cursor results" })).out.passages as unknown[];
    expect(p.length).toBeLessThanOrEqual(3);
    expect(p.length).toBeGreaterThan(0);
  });

  test("a query that matches nothing gives an empty list (not an error, not the whole page)", async () => {
    const r = await fetchTool({ focus: "kubernetes zeppelin submarine" });
    expect(r.isError).toBe(false);
    expect(r.out.passages).toEqual([]);
  });

  test("passages come from the whole page even when maxChars truncates `text`", async () => {
    const r = await fetchTool({ focus: "cursor next page", maxChars: 120 });
    expect(r.out.text).not.toContain("Pagination"); // the Pagination section is cut off `text`…
    expect((r.out.passages as Array<{ heading: string }>)[0]?.heading).toBe("Pagination");
  });

  test("plain-text bodies are ranked by paragraph", async () => {
    const r = await callTool(registerFetchTool, "browser_fetch", { url: `${server.origin}/notes.txt`, focus: "postgres vacuum bloat" });
    const p = r.out.passages as Array<{ heading: string; text: string }>;
    expect(p[0]?.text).toContain("Postgres vacuum");
    expect(p[0]?.heading).toBe("");
  });

  test("an empty or blank focus is the same as none", async () => {
    for (const focus of ["", "   "]) expect((await fetchTool({ focus })).out.passages).toBeUndefined();
  });

  test("topK must be a positive integer", async () => {
    expect((await fetchTool({ focus: "token", topK: 0 })).isError).toBe(true);
  });
});

describe("without focus the output is byte-identical", () => {
  test("no `passages` key; the tool result equals the pre-feature pipeline", async () => {
    const url = `${server.origin}/guide`;
    const legacy = await renderFetch(await resolveFetchBody(url, await fetchFast(url)), {});
    const r = await fetchTool({});
    expect(r.out.passages).toBeUndefined();
    expect(JSON.parse(r.text)).toEqual(JSON.parse(JSON.stringify(legacy)));
  });
});
