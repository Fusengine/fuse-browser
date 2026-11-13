import { afterAll, describe, expect, test } from "bun:test";
import { registerMapTool } from "../../src/server/tools/map.js";
import { type DocHandler, type DocServer, serveDocs } from "./helpers/docs-server.js";
import { callTool } from "./helpers/tool-client.js";

// `browser_map` never returns an empty list silently, and a site published under a
// sub-path (https://user.github.io/project/) is found at <path>/sitemap.xml and
// <path>/llms.txt. Measured on a live run: mkdocs-material gave count:0 with no signal.

const servers: DocServer[] = [];
const serve = (r: Record<string, DocHandler>): DocServer => {
  const s = serveDocs(r);
  servers.push(s);
  return s;
};
afterAll(() => {
  for (const s of servers) s.stop();
});
const XML = "application/xml";
const sitemap = (req: Request, paths: string[]): { contentType: string; body: string } => ({
  contentType: XML,
  body: `<urlset>${paths.map((p) => `<url><loc>${new URL(req.url).origin}${p}</loc></url>`).join("")}</urlset>`,
});
const map = (args: Record<string, unknown>) => callTool(registerMapTool, "browser_map", args);
const pathsOf = (urls: Array<{ url: string }>): string[] => urls.map((u) => new URL(u.url).pathname);
const triedPaths = (tried: string[]): string[] => tried.map((u) => new URL(u).pathname);

describe("sub-path sites", () => {
  test("a sitemap that lives only under /sub/ is found from a /sub/ URL (2nd attempt, nothing else needed)", async () => {
    const s = serve({ "/sub/sitemap.xml": (req) => sitemap(req, ["/sub/a", "/sub/b"]) });
    const r = await map({ url: `${s.origin}/sub/` });
    expect(r.out.source).toBe("sitemap");
    expect(pathsOf(r.out.urls)).toEqual(["/sub/a", "/sub/b"]);
    expect(r.out.warning).toBeUndefined();
    expect(r.out.tried).toBeUndefined();
    expect(s.hits.get("/sitemap.xml")).toBe(1); // the origin root was tried first
    expect(s.hits.get("/sub/llms.txt")).toBeUndefined();
  });

  test("an llms.txt that lives only under /sub/ is found too", async () => {
    const s = serve({ "/sub/llms.txt": { contentType: "text/plain", body: "- [Intro](/sub/intro)\n" } });
    const r = await map({ url: `${s.origin}/sub` }); // the URL's whole path is the base: <path>/llms.txt
    expect(r.out.source).toBe("llms-txt");
    expect(pathsOf(r.out.urls)).toEqual(["/sub/intro"]);
  });

  test("a root URL tries no sub-path files", async () => {
    const s = serve({});
    const r = await map({ url: s.origin });
    expect(triedPaths(r.out.tried)).toEqual(["/robots.txt", "/sitemap.xml", "/llms.txt"]);
    expect(s.hits.size).toBe(3);
  });

  test("with a path: exactly two extra requests (<path>/sitemap.xml, <path>/llms.txt), then a warning listing every URL tried", async () => {
    const s = serve({});
    const r = await map({ url: `${s.origin}/sub/` });
    expect(r.out.count).toBe(0);
    expect(r.out.warning).toBe("no_sitemap_found");
    expect(triedPaths(r.out.tried)).toEqual(["/robots.txt", "/sitemap.xml", "/sub/sitemap.xml", "/llms.txt", "/sub/llms.txt"]);
    expect(s.hits.size).toBe(5);
  });
});

describe("an empty list always says why", () => {
  test("no sitemap, no llms.txt → no_sitemap_found", async () => {
    const r = await map({ url: (serve({})).origin });
    expect(r.isError).toBe(false);
    expect(r.out).toMatchObject({ count: 0, urls: [], warning: "no_sitemap_found" });
    expect(r.out.tried.length).toBeGreaterThan(0);
  });

  test("entries existed but the filters removed them all → all_filtered", async () => {
    const s = serve({ "/sitemap.xml": (req) => sitemap(req, ["/docs/a", "/docs/b"]) });
    const r = await map({ url: s.origin, includePaths: ["/blog"] });
    expect(r.out).toMatchObject({ count: 0, warning: "all_filtered" });
  });

  test("llms.txt links all filtered out → all_filtered, source llms-txt", async () => {
    const s = serve({ "/llms.txt": { contentType: "text/plain", body: "- [A](/a)\n" } });
    const r = await map({ url: s.origin, excludePaths: ["/a"] });
    expect(r.out).toMatchObject({ source: "llms-txt", count: 0, warning: "all_filtered" });
  });

  test("the 50-file budget ended the walk before any page was found → budget_exhausted", async () => {
    const s = serve({
      "/sitemap.xml": (req) => ({ contentType: XML, body: `<sitemapindex>${Array.from({ length: 80 }, (_, i) => `<sitemap><loc>${new URL(req.url).origin}/c${i}.xml</loc></sitemap>`).join("")}</sitemapindex>` }),
    });
    const r = await map({ url: s.origin });
    expect(r.out).toMatchObject({ count: 0, truncated: true, warning: "budget_exhausted" });
  });

  test("a non-empty result carries neither warning nor tried", async () => {
    const s = serve({ "/sitemap.xml": (req) => sitemap(req, ["/x"]) });
    const r = await map({ url: s.origin });
    expect(r.out.count).toBe(1);
    expect(r.out.warning).toBeUndefined();
    expect(r.out.tried).toBeUndefined();
  });
});
