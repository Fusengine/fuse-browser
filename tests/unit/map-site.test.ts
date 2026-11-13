import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { gzipSync } from "node:zlib";
import { registerMapTool } from "../../src/server/tools/map.js";
import { type DocServer, type DocHandler, serveDocs } from "./helpers/docs-server.js";
import { callTool } from "./helpers/tool-client.js";

// `browser_map` through the real registered tool (in-memory MCP client) against
// local sites: sitemap index + gzip child, robots Sitemap lines, llms.txt, filters.

const XML = "application/xml";
const originOf = (req: Request): string => new URL(req.url).origin;
const urlset = (items: string[]): string => `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${items.join("")}</urlset>`;
const page = (loc: string, lastmod?: string): string => `<url><loc>${loc}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`;

/** Routes for the main site: robots with Sitemap lines → index → plain + gzip children. */
const main = (): Record<string, DocHandler> => ({
  "/robots.txt": (req) => ({
    contentType: "text/plain",
    body: `User-agent: *\nDisallow: /private/\nSitemap: ${originOf(req)}/sitemap_index.xml\nSitemap: https://elsewhere.invalid/other.xml\n`,
  }),
  "/sitemap_index.xml": (req) => ({
    contentType: XML,
    body: `<sitemapindex><sitemap><loc>${originOf(req)}/sm-docs.xml</loc></sitemap><sitemap><loc>${originOf(req)}/sm-blog.xml.gz</loc></sitemap><sitemap><loc>http://localhost:${new URL(req.url).port}/cross.xml</loc></sitemap></sitemapindex>`,
  }),
  "/sm-docs.xml": (req) => ({
    contentType: XML,
    body: urlset([page(`${originOf(req)}/docs/a`, "2026-01-02"), page(`${originOf(req)}/docs/b`), page(`${originOf(req)}/private/secret`), page(`${originOf(req)}/docs/c?x=1&amp;y=2`), `<url><loc><![CDATA[${originOf(req)}/docs/cdata]]></loc></url>`]),
  }),
  "/sm-blog.xml.gz": (req) => ({ contentType: "application/gzip", body: new Uint8Array(gzipSync(urlset([page(`${originOf(req)}/blog/1`), page(`${originOf(req)}/blog/2`)]))) }),
  "/cross.xml": { contentType: XML, body: urlset([page("https://x.test/never")]) },
});

let site: DocServer;
const servers: DocServer[] = [];
const serve = (r: Record<string, DocHandler>): DocServer => {
  const s = serveDocs(r);
  servers.push(s);
  return s;
};
beforeAll(() => {
  site = serve(main());
});
afterAll(() => {
  for (const s of servers) s.stop();
});

const map = (args: Record<string, unknown>) => callTool(registerMapTool, "browser_map", args);
const paths = (urls: Array<{ url: string }>): string[] => urls.map((u) => new URL(u.url).pathname + new URL(u.url).search);

describe("browser_map — sitemap index via robots.txt Sitemap lines", () => {
  test("lists every page of the index (plain + gzip child), decodes entities/CDATA, keeps lastmod, drops robots-disallowed", async () => {
    const r = await map({ url: `${site.origin}/anything/here` });
    expect(r.isError).toBe(false);
    expect(r.out.source).toBe("sitemap");
    expect(paths(r.out.urls)).toEqual(["/docs/a", "/docs/b", "/docs/c?x=1&y=2", "/docs/cdata", "/blog/1", "/blog/2"]);
    expect(r.out.urls[0]).toEqual({ url: `${site.origin}/docs/a`, lastmod: "2026-01-02" });
    expect(r.out.urls[1]).toEqual({ url: `${site.origin}/docs/b` }); // no lastmod key at all
    expect(r.out.count).toBe(6);
    expect(r.out.truncated).toBeUndefined();
  });

  test("a child sitemap on another origin and a foreign robots Sitemap line are never fetched", async () => {
    await map({ url: site.origin });
    expect(site.hits.get("/cross.xml")).toBeUndefined();
  });

  test("respectRobots:false keeps the robots-disallowed URL", async () => {
    const r = await map({ url: site.origin, respectRobots: false });
    expect(paths(r.out.urls)).toContain("/private/secret");
    expect(r.out.count).toBe(7);
  });
});

describe("browser_map — filters and limit", () => {
  test("includePaths: a bare path matches itself and everything below it; * is a wildcard", async () => {
    expect(paths((await map({ url: site.origin, includePaths: ["/docs"] })).out.urls)).toEqual(["/docs/a", "/docs/b", "/docs/c?x=1&y=2", "/docs/cdata"]);
    expect(paths((await map({ url: site.origin, includePaths: ["/blog/*"] })).out.urls)).toEqual(["/blog/1", "/blog/2"]);
    expect(paths((await map({ url: site.origin, includePaths: ["/docs/*", "/blog/1"] })).out.urls)).toHaveLength(5);
  });

  test("excludePaths removes matches; combined with includePaths", async () => {
    const r = await map({ url: site.origin, includePaths: ["/docs"], excludePaths: ["/docs/b", "*/cdata"] });
    expect(paths(r.out.urls)).toEqual(["/docs/a", "/docs/c?x=1&y=2"]);
  });

  test("limit cuts the list and says so (truncated:true); under the limit there is no flag", async () => {
    const cut = await map({ url: site.origin, limit: 2 });
    expect(cut.out.count).toBe(2);
    expect(cut.out.urls).toHaveLength(2);
    expect(cut.out.truncated).toBe(true);
    const exact = await map({ url: site.origin, limit: 6 });
    expect(exact.out.count).toBe(6);
    expect(exact.out.truncated).toBeUndefined();
  });
});

describe("browser_map — fallbacks", () => {
  test("no robots Sitemap line → /sitemap.xml is tried", async () => {
    const s = serve({ "/sitemap.xml": (req) => ({ contentType: XML, body: urlset([page(`${originOf(req)}/p1`), page(`${originOf(req)}/p2`)]) }) });
    const r = await map({ url: s.origin });
    expect(r.out.source).toBe("sitemap");
    expect(paths(r.out.urls)).toEqual(["/p1", "/p2"]);
  });

  test("no sitemap at all (an HTML catch-all on /sitemap.xml is not one) → llms.txt links, relative and absolute", async () => {
    const s = serve({
      "/sitemap.xml": { body: "<html><body>SPA shell</body></html>" },
      "/llms.txt": (req) => ({ contentType: "text/plain", body: `# Site\n\n> summary\n\n## Docs\n- [Intro](/docs/intro): start here\n- [API](${originOf(req)}/docs/api)\n- [Dup](/docs/intro)\n- [Mail](mailto:a@b.c)\n` }),
    });
    const r = await map({ url: s.origin });
    expect(r.out.source).toBe("llms-txt");
    expect(paths(r.out.urls)).toEqual(["/docs/intro", "/docs/api"]);
    expect(r.out.urls[0]).toEqual({ url: `${s.origin}/docs/intro` });
  });

  test("nothing found → empty list, not an error", async () => {
    const s = serve({});
    const r = await map({ url: s.origin });
    expect(r.isError).toBe(false);
    expect(r.out.count).toBe(0);
    expect(r.out.urls).toEqual([]);
  });
});

describe("browser_map — guards", () => {
  const prev = process.env.FUSE_BLOCK_PRIVATE_NETS;
  afterAll(() => {
    if (prev === undefined) delete process.env.FUSE_BLOCK_PRIVATE_NETS;
    else process.env.FUSE_BLOCK_PRIVATE_NETS = prev;
  });

  test("the SSRF guard applies: a loopback target is refused with its code, nothing is fetched", async () => {
    const s = serve(main());
    process.env.FUSE_BLOCK_PRIVATE_NETS = "1";
    const r = await map({ url: s.origin });
    delete process.env.FUSE_BLOCK_PRIVATE_NETS;
    expect(r.isError).toBe(true);
    expect(r.out.code).toBe("blocked_private_network");
    expect(s.hits.size).toBe(0);
  });

  test("a non-http(s) or malformed url is a clean error", async () => {
    for (const url of ["ftp://x.test/", "not a url"]) {
      const r = await map({ url });
      expect(r.isError).toBe(true);
    }
  });
});
