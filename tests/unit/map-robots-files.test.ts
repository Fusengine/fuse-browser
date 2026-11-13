import { afterAll, describe, expect, test } from "bun:test";
import { registerMapTool } from "../../src/server/tools/map.js";
import { type DocHandler, type DocServer, serveDocs } from "./helpers/docs-server.js";
import { callTool } from "./helpers/tool-client.js";

// With robots respected, `browser_map` must not fetch a sitemap / llms.txt URL that
// robots.txt disallows — EXCEPT the sitemaps the site itself advertises in `Sitemap:`
// lines (and the child sitemaps those list). The skip is reported, never silent.

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
const urlset = (o: string, paths: string[]): string => `<urlset>${paths.map((p) => `<url><loc>${o}${p}</loc></url>`).join("")}</urlset>`;
const map = (args: Record<string, unknown>) => callTool(registerMapTool, "browser_map", args);
const origin = (req: Request): string => new URL(req.url).origin;

/** A site whose robots disallows everything and which also serves every candidate file. */
const closed = (robots: string): Record<string, DocHandler> => ({
  "/robots.txt": (req) => ({ contentType: "text/plain", body: robots.replaceAll("{O}", origin(req)) }),
  "/sitemap.xml": (req) => ({ contentType: XML, body: urlset(origin(req), ["/a"]) }),
  "/docs/sitemap.xml": (req) => ({ contentType: XML, body: urlset(origin(req), ["/docs/b"]) }),
  "/llms.txt": { contentType: "text/plain", body: "- [A](/a)\n" },
  "/docs/llms.txt": { contentType: "text/plain", body: "- [B](/docs/b)\n" },
});

describe("browser_map does not fetch what robots.txt disallows", () => {
  test("Disallow: / → none of the 4 candidate files is requested; the result says so", async () => {
    const s = serve(closed("User-agent: *\nDisallow: /\n"));
    const r = await map({ url: `${s.origin}/docs/` });
    expect([...s.hits.keys()]).toEqual(["/robots.txt"]);
    expect(r.out).toMatchObject({ count: 0, skippedByRobots: 4, warning: "blocked_by_robots" });
    expect(r.out.tried).toEqual([`${s.origin}/robots.txt`]); // `tried` lists requests actually made
  });

  test("a sitemap advertised in robots Sitemap: lines is fetched even under Disallow: /private", async () => {
    const s = serve({
      "/robots.txt": (req) => ({ contentType: "text/plain", body: `User-agent: *\nDisallow: /private\nSitemap: ${origin(req)}/private/sitemap.xml\n` }),
      "/private/sitemap.xml": (req) => ({ contentType: XML, body: `<sitemapindex><sitemap><loc>${origin(req)}/private/child.xml</loc></sitemap></sitemapindex>` }),
      "/private/child.xml": (req) => ({ contentType: XML, body: urlset(origin(req), ["/pub/a", "/private/secret"]) }),
    });
    const r = await map({ url: s.origin });
    // the advertised index and the child it lists are fetched; the listed URL under /private is still filtered
    expect(r.out.urls.map((u: { url: string }) => new URL(u.url).pathname)).toEqual(["/pub/a"]);
    expect(s.hits.get("/private/sitemap.xml")).toBe(1);
    expect(s.hits.get("/private/child.xml")).toBe(1);
    expect(r.out.skippedByRobots).toBeUndefined();
  });

  test("an UNadvertised fallback file under a disallowed path is skipped while the allowed ones are still tried", async () => {
    const s = serve(closed("User-agent: *\nDisallow: /docs/\n"));
    const r = await map({ url: `${s.origin}/docs/` });
    expect(r.out.source).toBe("sitemap");
    expect(r.out.urls.map((u: { url: string }) => new URL(u.url).pathname)).toEqual(["/a"]);
    expect(s.hits.get("/docs/sitemap.xml")).toBeUndefined();
  });

  test("respectRobots:false fetches them anyway (opt-out unchanged)", async () => {
    const s = serve(closed("User-agent: *\nDisallow: /\n"));
    const r = await map({ url: s.origin, respectRobots: false });
    expect(s.hits.get("/sitemap.xml")).toBe(1);
    expect(r.out.count).toBe(1);
    expect(r.out.skippedByRobots).toBeUndefined();
  });

  test("no robots.txt at all → nothing is skipped", async () => {
    const s = serve({ "/sitemap.xml": (req) => ({ contentType: XML, body: urlset(origin(req), ["/a"]) }) });
    const r = await map({ url: s.origin });
    expect(r.out.count).toBe(1);
    expect(r.out.skippedByRobots).toBeUndefined();
  });
});
