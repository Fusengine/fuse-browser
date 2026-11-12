import { describe, expect, test } from "bun:test";
import type { BlockInput, BlockSignal } from "../../src/interfaces/block.js";
import { BLOCK_SIGNALS } from "../../src/net/block-signals.js";
import { MAX_SCAN_CHARS, blockHint, detectBlock, isHeaderOnlyBlock, isThinHtml } from "../../src/net/block-detect.js";
import { NOT_BLOCKED, REAL_BLOCKED, SYNTHETIC_BLOCKED, article } from "./helpers/block-pages.js";

/** Build the detector input a served route would produce on the wire. */
function inputOf(route: { status: number; headers?: Record<string, string>; body: string; contentType?: string }): BlockInput {
  return {
    status: route.status,
    headers: route.headers,
    html: route.body,
    isHtml: (route.contentType ?? "text/html").includes("html"),
  };
}

describe("detectBlock — blocked pages (real captures + documented shapes)", () => {
  for (const [path, { route, vendor }] of Object.entries({ ...REAL_BLOCKED, ...SYNTHETIC_BLOCKED })) {
    test(`${path} → ${vendor}`, () => {
      expect(detectBlock(inputOf(route))?.vendor).toBe(vendor);
    });
  }

  test("each combination works without its vendor header: the HTML marker alone still decides on a thin 403", () => {
    const cf = REAL_BLOCKED["/cf-managed"]?.route;
    const { "cf-mitigated": _drop, ...headers } = cf?.headers ?? {};
    expect(detectBlock({ status: 403, headers, html: cf?.body ?? "", isHtml: true })?.vendor).toBe("cloudflare");
    const dd = REAL_BLOCKED["/datadome"]?.route;
    expect(detectBlock({ status: 403, headers: {}, html: dd?.body ?? "", isHtml: true })?.vendor).toBe("datadome");
  });

  test("a strong header decides at ANY status (AWS WAF challenge is a 202)", () => {
    const aws = SYNTHETIC_BLOCKED["/aws-waf"]?.route;
    expect(aws?.status).toBe(202);
    expect(detectBlock(inputOf(aws as never))?.signals).toContain("header:x-amzn-waf-action");
  });

  test("a strong header on a non-HTML body still decides (header-only path)", () => {
    expect(detectBlock({ status: 403, headers: { "cf-mitigated": "challenge" }, html: "{}", isHtml: false })?.vendor).toBe("cloudflare");
  });
});

describe("detectBlock — false-positive matrix", () => {
  for (const [path, route] of Object.entries(NOT_BLOCKED)) {
    test(`${path} (${route.status}) is not blocked`, () => {
      expect(detectBlock(inputOf(route))).toBeNull();
    });
  }

  test("header values that are not the documented ones do not match", () => {
    const cases: Record<string, string>[] = [{ "cf-mitigated": "none" }, { "x-amzn-waf-action": "allow" }, { "cf-mitigated": "" }];
    for (const headers of cases) {
      expect(detectBlock({ status: 200, headers, html: article("x"), isHtml: true })).toBeNull();
    }
  });

  test("a single weak signal on a thin 403 is not enough", () => {
    const html = "<html><head><title>Access denied</title></head><body><p>No.</p></body></html>";
    expect(detectBlock({ status: 403, html, isHtml: true })).toBeNull();
  });

  test("two weak signals on a 200 (not an error status) are not enough", () => {
    const html = '<html><head><title>Just a moment...</title><meta http-equiv="refresh" content="5"></head><body>Please enable JavaScript</body></html>';
    expect(detectBlock({ status: 200, html, isHtml: true })).toBeNull();
  });

  test("two weak signals on a long 403 page (real text) are not enough", () => {
    const html = article("Access denied", "Please enable JavaScript.").replace("<head>", '<head><meta http-equiv="refresh" content="5">');
    expect(detectBlock({ status: 403, html, isHtml: true })).toBeNull();
  });

  test("two weak signals on a thin 403 are still not enough (the quorum is three)", () => {
    const html = '<html><head><title>Just a moment...</title><meta http-equiv="refresh" content="5"></head><body>No.</body></html>';
    expect(detectBlock({ status: 403, html, isHtml: true })).toBeNull();
  });

  test("a body over MAX_SCAN_CHARS skips HTML scanning, but a strong header still decides", () => {
    const huge = `<html><title>Just a moment</title>${"<script ".repeat(MAX_SCAN_CHARS / 8 + 1)}</html>`;
    expect(huge.length).toBeGreaterThan(MAX_SCAN_CHARS);
    expect(detectBlock({ status: 500, html: huge, isHtml: true })).toBeNull();
    expect(detectBlock({ status: 403, headers: { "cf-mitigated": "challenge" }, html: huge, isHtml: true })?.vendor).toBe("cloudflare");
  });

  test("isThinHtml: thin interstitial vs a real article", () => {
    expect(isThinHtml("<html><body>Verifying…</body></html>")).toBe(true);
    expect(isThinHtml(article("Real"))).toBe(false);
  });

  test("a body with no status (browser-rendered) never trips the weak quorum", () => {
    const html = '<html><head><title>Just a moment...</title><meta http-equiv="refresh" content="5"></head><body>Please enable JavaScript</body></html>';
    expect(detectBlock({ html, isHtml: true })).toBeNull();
  });
});

describe("detectBlock — review fixes C / D1 / D3", () => {
  const generic = SYNTHETIC_BLOCKED["/generic-weak"]?.route.body ?? "";
  const deniedRefresh = NOT_BLOCKED["/denied-403-refresh-datadome-site"]?.body ?? "";

  test("C: a presence header (x-datadome) never counts toward the weak quorum…", () => {
    expect(detectBlock({ status: 403, headers: { "x-datadome": "protected" }, html: deniedRefresh, isHtml: true })).toBeNull();
    expect(detectBlock({ status: 403, html: deniedRefresh, isHtml: true })).toBeNull();
  });

  test("C: …but still attributes the vendor once page-level hints reach the quorum", () => {
    expect(detectBlock({ status: 403, headers: { "x-datadome": "protected" }, html: generic, isHtml: true })?.vendor).toBe("datadome");
    expect(detectBlock({ status: 403, html: generic, isHtml: true })?.vendor).toBe("unknown");
  });

  test("C: the property is table data (presenceOnly), not a special case in code", () => {
    const flagged = BLOCK_SIGNALS.filter((s) => s.presenceOnly).map((s) => s.id);
    expect(flagged).toEqual(["header:x-datadome"]);
    const asCounting = BLOCK_SIGNALS.map((s) => (s.presenceOnly ? { ...s, presenceOnly: false } : s));
    const input = { status: 403, headers: { "x-datadome": "protected" }, html: deniedRefresh, isHtml: true };
    expect(detectBlock(input, asCounting)).not.toBeNull(); // flag off → header counts → 3 hints → blocked
    expect(detectBlock(input)).toBeNull(); // flag on (the table default) → 2 page-level hints → not blocked
  });

  test("A: only a block recognisable by headers alone (AWS WAF) is inheritable; Cloudflare/DataDome/weak-hint verdicts are not", () => {
    const aws = detectBlock(inputOf(SYNTHETIC_BLOCKED["/aws-waf"]?.route as never));
    const cf = detectBlock(inputOf(REAL_BLOCKED["/cf-managed"]?.route as never));
    const weak = detectBlock({ status: 403, html: generic, isHtml: true });
    expect(aws && isHeaderOnlyBlock(aws)).toBe(true);
    expect(cf && isHeaderOnlyBlock(cf)).toBe(false); // header-decided, but Cloudflare has its own HTML marker
    expect(weak && isHeaderOnlyBlock(weak)).toBe(false);
  });

  test("D1: one phrase present in title AND text is one hint, not two", () => {
    const html = NOT_BLOCKED["/one-phrase-title-and-text-403"]?.body ?? "";
    expect(detectBlock({ status: 403, html, isHtml: true })).toBeNull();
  });

  test("D3: a marker in executable context decides, a prose quote does not (thick 403)", () => {
    const prose = NOT_BLOCKED["/thick-403-quotes-cf-opt"]?.body ?? "";
    expect(detectBlock({ status: 403, html: prose, isHtml: true })).toBeNull();
    const executable = prose.replace("</body>", "<script>window._cf_chl_opt = {cType: 'managed'};</script></body>");
    expect(detectBlock({ status: 403, html: executable, isHtml: true })?.vendor).toBe("cloudflare");
  });

  test("D2: captcha-delivery.com in a CSP meta (thin 200 shell) is not a block; as a script src it is", () => {
    const csp = NOT_BLOCKED["/spa-csp-captcha-delivery"]?.body ?? "";
    expect(detectBlock({ status: 200, html: csp, isHtml: true })).toBeNull();
    const loaded = csp.replace("</body>", '<script src="https://ct.captcha-delivery.com/i.js"></script></body>');
    expect(detectBlock({ status: 200, html: loaded, isHtml: true })?.vendor).toBe("datadome");
  });
});

describe("detectBlock — table-driven: a new vendor is one entry", () => {
  const acme: BlockSignal = { id: "html:acme-shield", vendor: "acme", kind: "html", strength: "strong", pattern: /acme-shield-challenge/ };
  const page = '<html><body><div id="acme-shield-challenge">Verifying…</div></body></html>';

  test("unknown to the default table", () => {
    expect(detectBlock({ status: 403, html: page, isHtml: true })).toBeNull();
  });

  test("detected once the entry is appended", () => {
    expect(detectBlock({ status: 403, html: page, isHtml: true }, [...BLOCK_SIGNALS, acme])?.vendor).toBe("acme");
  });
});

describe("blockHint", () => {
  test("names real tool + parameter names, never an invented one", () => {
    const hint = blockHint({ vendor: "cloudflare", signals: [] }, false);
    for (const needle of ["browserFallback:true", "browser_open", "browser_navigate", "browser_extract", "browser_handoff", "headless:false"]) {
      expect(hint).toContain(needle);
    }
    expect(hint).not.toContain("captcha:");
  });

  test("after a failed browser render it points at a headed session + handoff, not at browserFallback again", () => {
    const hint = blockHint({ vendor: "datadome", signals: [] }, true);
    expect(hint).toContain("browser_handoff");
    expect(hint).not.toContain("browserFallback");
  });
});
