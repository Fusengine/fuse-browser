import { afterAll, describe, expect, test } from "bun:test";
import { pathFilter } from "../../src/agent/map-filter.js";
import { llmsLinks, parseSitemap } from "../../src/agent/map-parse.js";
import { MAX_SITEMAP_FILES, mapSite } from "../../src/agent/map-site.js";
import { splitPassages } from "../../src/extraction/passages-split.js";
import { type DocHandler, type DocServer, serveDocs } from "./helpers/docs-server.js";

// Hardening found by the challenger: bounded work on hostile input (no clock
// assertions — a quadratic/exponential implementation simply cannot finish these
// inputs inside the test's own timeout), the 50-file budget counts attempts, a
// redirecting sitemap cannot leave the origin, malformed percent escapes fail closed.

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
const urlset = (locs: string[]): string => `<urlset>${locs.map((l) => `<url><loc>${l}</loc></url>`).join("")}</urlset>`;

describe("browser_map request budget and origin", () => {
  test("the sitemap-file budget counts failed attempts: an index of 500 dead children costs at most MAX_SITEMAP_FILES requests", async () => {
    const children = Array.from({ length: 500 }, (_, i) => `/c${i}.xml`);
    const s = serve({
      "/sitemap.xml": (req) => ({ contentType: XML, body: `<sitemapindex>${children.map((c) => `<sitemap><loc>${new URL(req.url).origin}${c}</loc></sitemap>`).join("")}</sitemapindex>` }),
    });
    const r = await mapSite(s.origin);
    const childHits = [...s.hits.keys()].filter((p) => /^\/c\d+\.xml$/.test(p)).length;
    expect(childHits).toBeLessThanOrEqual(MAX_SITEMAP_FILES);
    expect(r.count).toBe(0);
    expect(r.truncated).toBe(true); // the budget cut the walk: the list is incomplete and says so
  });

  test("a same-origin sitemap that REDIRECTS to another origin is not used", async () => {
    const other = serve({ "/evil.xml": { contentType: XML, body: urlset(["http://leak.test/secret"]) } });
    const s = serve({
      "/robots.txt": (req) => ({ contentType: "text/plain", body: `Sitemap: ${new URL(req.url).origin}/redir.xml\n` }),
      "/redir.xml": { status: 302, headers: { location: `http://localhost:${new URL(other.origin).port}/evil.xml` }, body: "" },
    });
    const r = await mapSite(s.origin);
    expect(r.urls.map((u) => u.url)).not.toContain("http://leak.test/secret");
    expect(r.count).toBe(0);
  });

  test("robots rules fail closed on a malformed percent escape (it cannot slip past `Disallow`)", async () => {
    const s = serve({
      "/robots.txt": { contentType: "text/plain", body: "User-agent: *\nDisallow: /private\n" },
      "/sitemap.xml": (req) => {
        const o = new URL(req.url).origin;
        return { contentType: XML, body: urlset([`${o}/private/%zz`, `${o}/private/%FF`, `${o}/private/ok`, `${o}/public/a`]) };
      },
    });
    const r = await mapSite(s.origin);
    expect(r.urls.map((u) => new URL(u.url).pathname)).toEqual(["/public/a"]);
  });

  test("llms.txt links all filtered out → source stays llms-txt with count 0", async () => {
    const s = serve({ "/llms.txt": { contentType: "text/plain", body: "- [A](/a)\n- [B](/b)\n" } });
    const r = await mapSite(s.origin, { includePaths: ["/nothing"] });
    expect(r).toMatchObject({ source: "llms-txt", count: 0, urls: [], warning: "all_filtered" });
  });
});

describe("bounded work on hostile input", () => {
  test("parseSitemap: 2 MB of unclosed <url> tags", () => {
    expect(parseSitemap(`<urlset>${"<url>".repeat(500_000)}`).entries).toEqual([]);
  });

  test("parseSitemap: an unclosed <loc> and a huge block of repeated <loc", () => {
    expect(parseSitemap(`<urlset><url>${"<loc>".repeat(300_000)}</url></urlset>`).entries).toEqual([]);
  });

  test("llmsLinks: a 1 MB run after `](`", () => {
    expect(llmsLinks(`](${"a".repeat(1_000_000)}`, "https://x.test/llms.txt").length).toBeLessThanOrEqual(1); // one (huge) relative target
    expect(llmsLinks("](a".repeat(300_000), "https://x.test/llms.txt").length).toBeGreaterThan(0); // many `](` starts, none scans into the next
  });

  test("pathFilter: a 7-star glob on a 60-character path", () => {
    const keep = pathFilter(["*a*a*a*a*a*a*a*b"]);
    expect(keep(`https://x.test/${"a".repeat(60)}`)).toBe(false);
    expect(keep(`https://x.test/${"a".repeat(60)}b`)).toBe(true);
  });

  test("splitPassages: a heading line with 200 000 trailing spaces, and a 300 000-character run of `[` in a heading", () => {
    expect(splitPassages(`# a${" ".repeat(200_000)}x\nbody`)[0]?.text).toBe("body");
    expect(splitPassages(`# ${"[".repeat(300_000)}\nbody`)[0]?.text).toBe("body");
  });
});

describe("parsers still parse (regression on the rewrite)", () => {
  test("sitemap, entities, CDATA, attributes, case, self-closing noise", () => {
    const p = parseSitemap(`<?xml version="1.0"?><URLSET xmlns="x"><url foo="1"><LOC>https://x.test/a?b=1&amp;c=2</LOC><lastmod> 2026-01-01 </lastmod></url><url/><url><loc><![CDATA[https://x.test/c]]></loc></url><url><loc>ftp://x.test/no</loc></url></URLSET>`);
    expect(p.kind).toBe("urlset");
    expect(p.entries).toEqual([{ loc: "https://x.test/a?b=1&c=2", lastmod: "2026-01-01" }, { loc: "https://x.test/c" }]);
    expect(parseSitemap("<sitemapindex><sitemap><loc>https://x.test/s.xml</loc></sitemap></sitemapindex>")).toEqual({ kind: "index", entries: [{ loc: "https://x.test/s.xml" }] });
    expect(parseSitemap("<html>spa</html>").kind).toBe("unknown");
  });

  test("llmsLinks: titles, angle-bracket targets, optional title text, relative, fragment, non-http", () => {
    const t = "[A](/a) [B](<https://x.test/b> \"title\") [C](#frag) [D](mailto:a@b.c) [E](/a#x) [F]( /f )";
    expect(llmsLinks(t, "https://x.test/llms.txt")).toEqual(["https://x.test/a", "https://x.test/b", "https://x.test/f"]);
  });

  test("pathFilter: star in the middle, at both ends, escaped regex chars", () => {
    const keep = pathFilter(["/docs/*/intro", "*.html"]);
    expect(keep("https://x.test/docs/en/intro")).toBe(true);
    expect(keep("https://x.test/a.html")).toBe(true);
    expect(keep("https://x.test/aXhtml")).toBe(false);
    expect(keep("https://x.test/docs/intro")).toBe(false);
  });

  test("headings: closing hashes, up to 3 leading spaces, 4 spaces is code, fenced # ignored", () => {
    const md = "   ## Title ##\ntext one\n\n    # not a heading\n```\n# in fence\n```\n###### Six\nsix text";
    expect(splitPassages(md).map((c) => c.heading)).toEqual(["Title", "Six"]);
    expect(splitPassages(md)[0]?.text).toContain("# not a heading");
    expect(splitPassages(md)[0]?.text).toContain("# in fence");
  });
});
