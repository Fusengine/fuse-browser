import { describe, expect, test } from "bun:test";
import { fetchAndRender } from "../../src/agent/fetch-orchestrate.js";
import { markdownAlternate, mdTwinUrl } from "../../src/net/doc-markdown.js";
import { article } from "./helpers/block-pages.js";
import { serveDocs } from "./helpers/docs-server.js";

// Hardening of the docs-native ladder found by the challenger: a redirecting
// twin must not smuggle in another origin, and `Link` header parsing must
// follow RFC 8288 quoting. Public-entry-point cases run the real fast path.

const MD = "# Intro\n\nSite-authored markdown body with `code`.\n";

describe("twin redirect", () => {
  test("a same-origin twin that REDIRECTS to another origin is rejected (final url re-checked)", async () => {
    const other = serveDocs({ "/stolen.md": { body: "# from elsewhere", contentType: "text/markdown" } });
    const s = serveDocs({
      "/page": { body: article("Redirecting twin page"), headers: { link: '</hop.md>; rel="alternate"; type="text/markdown"' } },
      "/hop.md": { status: 302, headers: { location: `${other.origin}/stolen.md` }, body: "" },
    });
    try {
      const { rendered } = await fetchAndRender(`${s.origin}/page`);
      expect(other.hits.get("/stolen.md")).toBe(1); // the HTTP client follows the redirect…
      expect(rendered.source).toBeUndefined(); // …but the foreign-origin answer is never used
      expect(rendered.text).toContain("Redirecting twin page");
    } finally {
      s.stop();
      other.stop();
    }
  });
});

describe("Link header parsing (through the real fetch)", () => {
  const cases: Array<[string, boolean]> = [
    ['</a.rss>; title="Guide, v2"; rel="alternate"; type="application/rss+xml", </t.md>; rel="alternate"; type="text/markdown"', true],
    ['</t.md>; title="Guide, v2"; rel="alternate"; type="text/markdown"', true],
    ["</t.md>; REL=Alternate; TYPE=Text/Markdown", true],
    ['</t.md>; rel="nofollow alternate"; type="text/markdown"', true],
    ['</t.md>; rel="alternate-x"; type="text/markdown"', false],
    ['</t.md>; rel="alternate"; type="text/markdownish"', false],
  ];
  for (const [link, expected] of cases) {
    test(`${expected ? "uses" : "ignores"}: ${link}`, async () => {
      const s = serveDocs({ "/p": { body: article("P"), headers: { link } }, "/t.md": { body: MD, contentType: "text/markdown" } });
      try {
        const { rendered } = await fetchAndRender(`${s.origin}/p`);
        expect(rendered.source === "site-markdown").toBe(expected);
      } finally {
        s.stop();
      }
    });
  }
});

describe("helpers", () => {
  test("markdownAlternate resolves a relative target and ignores a missing header", () => {
    expect(markdownAlternate('<intro.md>; rel="alternate"; type="text/markdown"', "https://x.test/docs/")).toBe("https://x.test/docs/intro.md");
    expect(markdownAlternate(undefined, "https://x.test/")).toBeNull();
  });

  test("mdTwinUrl: appends .md, drops query/hash and trailing slash; none for root or an existing .md", () => {
    expect(mdTwinUrl("https://x.test/docs/intro?a=1#top")).toBe("https://x.test/docs/intro.md");
    expect(mdTwinUrl("https://x.test/docs/intro/")).toBe("https://x.test/docs/intro.md");
    expect(mdTwinUrl("https://x.test/")).toBeNull();
    expect(mdTwinUrl("https://x.test/docs/intro.md")).toBeNull();
  });
});
