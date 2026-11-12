import { afterAll, describe, expect, test } from "bun:test";
import { registerMapTool } from "../../src/server/tools/map.js";
import { type DocHandler, type DocServer, serveDocs } from "./helpers/docs-server.js";
import { callTool } from "./helpers/tool-client.js";

// sitemaps.org (https://www.sitemaps.org/protocol.html, "Sitemap file location"): all URLs
// in a Sitemap must use the same protocol and reside on the same host as the Sitemap;
// invalid ones "are dropped from further consideration". `browser_map` drops them and
// reports how many (`offOrigin`, absent when 0) — they also never went through a robots check.

const servers: DocServer[] = [];
const serve = (r: Record<string, DocHandler>): DocServer => {
  const s = serveDocs(r);
  servers.push(s);
  return s;
};
afterAll(() => {
  for (const s of servers) s.stop();
});
const map = (args: Record<string, unknown>) => callTool(registerMapTool, "browser_map", args);
const urlset = (locs: string[]): string => `<urlset>${locs.map((l) => `<url><loc>${l}</loc></url>`).join("")}</urlset>`;

describe("browser_map drops entries that are not on the sitemap's origin", () => {
  test("another host, another protocol and another port are dropped and counted; same-origin ones stay", async () => {
    const s = serve({
      "/robots.txt": { contentType: "text/plain", body: "User-agent: *\nDisallow: /private\n" },
      "/sitemap.xml": (req) => {
        const o = new URL(req.url).origin;
        const port = new URL(req.url).port;
        return {
          contentType: "application/xml",
          body: urlset([`${o}/a`, `http://localhost:${port}/other-host`, `https://127.0.0.1:${port}/other-protocol`, `http://127.0.0.1:${Number(port) + 1}/other-port`, `http://evil.test/private/x`, `${o}/b`, `http://evil.test/private/x`]),
        };
      },
    });
    const r = await map({ url: s.origin });
    expect(r.out.urls.map((u: { url: string }) => new URL(u.url).pathname)).toEqual(["/a", "/b"]);
    expect(r.out.count).toBe(2);
    expect(r.out.offOrigin).toBe(4); // distinct off-origin URLs (the duplicate evil.test one counts once)
  });

  test("offOrigin is absent when every entry is on the origin", async () => {
    const s = serve({ "/sitemap.xml": (req) => ({ contentType: "application/xml", body: urlset([`${new URL(req.url).origin}/a`]) }) });
    const r = await map({ url: s.origin });
    expect(r.out.count).toBe(1);
    expect("offOrigin" in r.out).toBe(false);
  });

  test("a sitemap made only of off-origin entries is an empty, explained result (not a silent one)", async () => {
    const s = serve({ "/sitemap.xml": { contentType: "application/xml", body: urlset(["http://evil.test/a", "http://evil.test/b"]) } });
    const r = await map({ url: s.origin });
    expect(r.out).toMatchObject({ count: 0, offOrigin: 2, warning: "all_filtered" });
    expect(r.out.tried.length).toBeGreaterThan(0);
  });

  test("llms.txt links to other hosts are dropped and counted the same way", async () => {
    const s = serve({ "/llms.txt": (req) => ({ contentType: "text/plain", body: `- [Doc](/doc)\n- [Repo](https://github.com/x/y)\n- [Abs](${new URL(req.url).origin}/abs)\n` }) });
    const r = await map({ url: s.origin });
    expect(r.out.source).toBe("llms-txt");
    expect(r.out.urls.map((u: { url: string }) => new URL(u.url).pathname)).toEqual(["/doc", "/abs"]);
    expect(r.out.offOrigin).toBe(1);
  });
});
