import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { fetchBatch } from "../../src/agent/fetch-batch.js";
import { fetchAndRender } from "../../src/agent/fetch-orchestrate.js";
import { renderFetch } from "../../src/agent/fetch-render.js";
import { resolveFetchBody } from "../../src/agent/fetch-resolve.js";
import { fetchFast } from "../../src/net/fetch-fast.js";
import { PrivateNetworkBlockedError } from "../../src/net/private-net-guard.js";
import { article } from "./helpers/block-pages.js";
import { type DocServer, serveDocs } from "./helpers/docs-server.js";

// Public-entry-point tests for the docs-native read ladder: a site's own
// markdown (Accept negotiation, `Link: rel=alternate; type=text/markdown`, and
// — opt-in via preferMarkdown — the `.md` twin) is used instead of extracting
// the HTML. Every case runs the REAL fast path against a local server.

const MD = "# Intro\n\nSite-authored markdown body with `code`.\n";
const MD_LINK = '<{ORIGIN}/linked.md>; rel="alternate"; type="text/markdown"';

let server: DocServer;
beforeAll(() => {
  server = serveDocs({
    // (a) content negotiation: markdown only when the client prefers it.
    "/negotiated": (req) => ((req.headers.get("accept") ?? "").startsWith("text/markdown") ? { body: MD, contentType: "text/markdown; charset=utf-8" } : { body: article("Negotiated") }),
    // (b) Link header advertising a twin.
    "/linked": () => ({ body: article("Linked html"), headers: { link: MD_LINK.replace("{ORIGIN}", server.origin) } }),
    "/linked.md": { body: MD, contentType: "text/markdown" },
    "/linked-relative": { body: article("Linked relative"), headers: { link: '</linked.md>; rel="alternate"; type="text/markdown"' } },
    "/linked-other-origin": { body: article("Other origin"), headers: { link: '<http://localhost:1/x.md>; rel="alternate"; type="text/markdown"' } },
    "/linked-dead": { body: article("Dead twin"), headers: { link: '</missing.md>; rel="alternate"; type="text/markdown"' } },
    "/linked-wrong-type": { body: article("Wrong type"), headers: { link: '</linked.md>; rel="alternate"; type="application/rss+xml"' } },
    "/linked-404": { status: 404, body: article("Not found page"), headers: { link: '</linked.md>; rel="alternate"; type="text/markdown"' } },
    // (c) opt-in .md twin of a docs URL.
    "/docs/intro": { body: article("Docs intro html") },
    "/docs/intro.md": { body: MD, contentType: "text/markdown" },
    "/docs/spa": { body: article("Docs spa html") },
    "/docs/spa.md": { body: article("catch-all html on .md") }, // SPA catch-all: 200 text/html
    "/docs/gone": { body: article("Docs gone html") },
    "/docs/err": { status: 500, body: article("Server error page") },
    "/docs/err.md": { body: MD, contentType: "text/markdown" },
    "/plain": { body: article("Plain page") },
    "/plain.md": { body: MD, contentType: "text/markdown" },
    "/data.json": { body: '{"a":1}', contentType: "application/json" },
  });
});
afterAll(() => server.stop());
afterEach(() => {
  server.hits.clear();
});

const url = (p: string) => `${server.origin}${p}`;

describe("(a) Accept: text/markdown — a markdown answer is used as-is", () => {
  test("sends a markdown-first Accept and returns the site's markdown verbatim, flagged site-markdown", async () => {
    const { rendered } = await fetchAndRender(url("/negotiated"));
    expect(server.accepts.get("/negotiated")?.startsWith("text/markdown")).toBe(true);
    expect(rendered.text).toBe(MD);
    expect(rendered.format).toBe("text");
    expect(rendered.source).toBe("site-markdown");
    expect(server.hits.get("/negotiated")).toBe(1);
  });
});

describe("(b) Link: rel=alternate; type=text/markdown", () => {
  test("absolute Link → one extra request, site markdown returned, url stays the page's", async () => {
    const { rendered } = await fetchAndRender(url("/linked"));
    expect(rendered.text).toBe(MD);
    expect(rendered.source).toBe("site-markdown");
    expect(rendered.url).toBe(url("/linked"));
    expect(server.hits.get("/linked.md")).toBe(1);
  });

  test("relative Link target is resolved against the page URL", async () => {
    const { rendered } = await fetchAndRender(url("/linked-relative"));
    expect(rendered.text).toBe(MD);
    expect(rendered.source).toBe("site-markdown");
  });

  test("a Link to another origin is never followed", async () => {
    const { rendered } = await fetchAndRender(url("/linked-other-origin"));
    expect(rendered.source).toBeUndefined();
    expect(rendered.text).toContain("Other origin");
  });

  test("a Link of another type is ignored (no extra request)", async () => {
    const { rendered } = await fetchAndRender(url("/linked-wrong-type"));
    expect(rendered.source).toBeUndefined();
    expect(server.hits.get("/linked.md")).toBeUndefined();
  });

  test("a dead twin (404) falls back to the page's own extraction; exactly one extra request", async () => {
    const { rendered } = await fetchAndRender(url("/linked-dead"));
    expect(rendered.text).toContain("Dead twin");
    expect(rendered.source).toBeUndefined();
    expect(server.hits.get("/missing.md")).toBe(1);
  });

  test("never on a non-2xx page", async () => {
    const { rendered } = await fetchAndRender(url("/linked-404"));
    expect(rendered.status).toBe(404);
    expect(server.hits.get("/linked.md")).toBeUndefined();
  });

  test("fetchBatch applies the same ladder", async () => {
    const [item] = (await fetchBatch([url("/linked")])) as Array<Record<string, unknown>>;
    expect(item?.text).toBe(MD);
    expect(item?.source).toBe("site-markdown");
  });
});

describe("(c) preferMarkdown — opt-in .md twin", () => {
  test("tries <url>.md once and returns it flagged site-markdown", async () => {
    const { rendered } = await fetchAndRender(url("/docs/intro"), { preferMarkdown: true });
    expect(rendered.text).toBe(MD);
    expect(rendered.source).toBe("site-markdown");
    expect(rendered.url).toBe(url("/docs/intro"));
    expect(server.hits.get("/docs/intro.md")).toBe(1);
  });

  test("a SPA catch-all answering HTML on .md is rejected: html extraction, source html, one extra request", async () => {
    const { rendered } = await fetchAndRender(url("/docs/spa"), { preferMarkdown: true });
    expect(rendered.text).toContain("Docs spa html");
    expect(rendered.source).toBe("html");
    expect(server.hits.get("/docs/spa.md")).toBe(1);
  });

  test("no twin (404) → html, source html", async () => {
    const { rendered } = await fetchAndRender(url("/docs/gone"), { preferMarkdown: true });
    expect(rendered.source).toBe("html");
    expect(rendered.text).toContain("Docs gone html");
  });

  test("never on a non-2xx page, and no source claimed", async () => {
    const { rendered } = await fetchAndRender(url("/docs/err"), { preferMarkdown: true });
    expect(rendered.status).toBe(500);
    expect(rendered.source).toBeUndefined();
    expect(server.hits.get("/docs/err.md")).toBeUndefined();
  });

  test("non-HTML answers (JSON) are untouched and trigger no extra request", async () => {
    const { rendered } = await fetchAndRender(url("/data.json"), { preferMarkdown: true });
    expect(rendered.text).toBe('{"a":1}');
    expect(rendered.source).toBeUndefined();
    expect(server.hits.get("/data.json.md")).toBeUndefined();
  });

  test("the root path has no twin: no extra request", async () => {
    await fetchAndRender(`${server.origin}/`, { preferMarkdown: true });
    expect(server.hits.get("/.md")).toBeUndefined();
    expect(server.hits.get("/index.md")).toBeUndefined();
  });

  test("without preferMarkdown the .md twin is never requested", async () => {
    const { rendered } = await fetchAndRender(url("/plain"));
    expect(server.hits.get("/plain.md")).toBeUndefined();
    expect(rendered.source).toBeUndefined();
  });

  test("fetchBatch forwards preferMarkdown", async () => {
    const [item] = (await fetchBatch([url("/docs/intro")], { preferMarkdown: true })) as Array<Record<string, unknown>>;
    expect(item?.text).toBe(MD);
    expect(item?.source).toBe("site-markdown");
  });
});

describe("normal results stay byte-identical", () => {
  test("a page without site markdown renders exactly as the pre-ladder pipeline did", async () => {
    const r = await fetchFast(url("/plain"));
    const legacy = await renderFetch(await resolveFetchBody(url("/plain"), r), {});
    const { rendered } = await fetchAndRender(url("/plain"));
    expect(JSON.stringify(rendered)).toBe(JSON.stringify(legacy));
    expect(Object.keys(rendered).sort()).toEqual(["escalated", "extraction", "format", "status", "text", "url", "wordCount"]);
  });
});

describe("SSRF guard still applies on the ladder", () => {
  const prev = process.env.FUSE_BLOCK_PRIVATE_NETS;
  afterEach(() => {
    if (prev === undefined) delete process.env.FUSE_BLOCK_PRIVATE_NETS;
    else process.env.FUSE_BLOCK_PRIVATE_NETS = prev;
  });
  test("a loopback target is refused before any ladder request", async () => {
    process.env.FUSE_BLOCK_PRIVATE_NETS = "1";
    await expect(fetchAndRender(url("/docs/intro"), { preferMarkdown: true })).rejects.toBeInstanceOf(PrivateNetworkBlockedError);
    expect(server.hits.get("/docs/intro.md")).toBeUndefined();
  });
});
