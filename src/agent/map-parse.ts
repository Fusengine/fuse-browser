/**
 * Pure parsers for `browser_map`: sitemap XML (urlset / sitemapindex), robots.txt
 * `Sitemap:` lines and llms.txt links. No I/O. The input is hostile by assumption
 * (up to 10 MB, or 50 MB once gunzipped), so every scan here is a single linear
 * pass — no lazy `[\s\S]*?` scans, no nested quantifiers. (Path filters: `map-filter`.)
 * @module agent/map-parse
 */
import type { ParsedSitemap, SitemapEntry } from "../interfaces/map.js";

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** Lowercase ASCII letters only: unlike `toLowerCase()` it never changes the string length, so indexes stay valid. */
const asciiLower = (s: string): string => s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));

/** Replace every `<![CDATA[x]]>` by `x` (an unterminated wrapper is left as text). */
function unwrapCdata(s: string): string {
  let out = "";
  let pos = 0;
  for (;;) {
    const a = s.indexOf("<![CDATA[", pos);
    const b = a < 0 ? -1 : s.indexOf("]]>", a + 9);
    if (b < 0) return out + s.slice(pos);
    out += s.slice(pos, a) + s.slice(a + 9, b);
    pos = b + 3;
  }
}

/** Decode XML character data: CDATA wrappers, the five named entities, numeric references. */
function xmlText(raw: string): string {
  return unwrapCdata(raw)
    .replace(/&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi, (_m, hex?: string, dec?: string, name?: string) => {
      if (name) return NAMED[name.toLowerCase()] ?? "";
      const code = hex ? Number.parseInt(hex, 16) : Number.parseInt(dec ?? "", 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .trim();
}

/** True for the characters that may follow a tag name inside the tag. */
const endsTagName = (c: number): boolean => c === 62 /* > */ || c === 47 /* / */ || c === 32 || c === 9 || c === 10 || c === 13;

/**
 * Inner text of each `<name …>…</name>` of `xml` (ASCII-case-insensitive, self-closing
 * tags skipped, `<urlset>` never mistaken for `<url>`). One forward pass: when a
 * closing tag is missing the scan simply ends.
 */
function* blocks(xml: string, name: string): Generator<string> {
  const lower = asciiLower(xml);
  const open = `<${name}`;
  const close = `</${name}>`;
  let pos = 0;
  for (;;) {
    const s = lower.indexOf(open, pos);
    if (s < 0) return;
    if (!endsTagName(lower.charCodeAt(s + open.length))) {
      pos = s + open.length;
      continue;
    }
    const gt = lower.indexOf(">", s + open.length);
    if (gt < 0) return;
    if (lower.charCodeAt(gt - 1) === 47) {
      pos = gt + 1; // <name/>
      continue;
    }
    const e = lower.indexOf(close, gt + 1);
    if (e < 0) return;
    yield xml.slice(gt + 1, e);
    pos = e + close.length;
  }
}

/** Decoded text of the first `<name>` inside `block`, or undefined. */
function tag(block: string, name: string): string | undefined {
  for (const inner of blocks(block, name)) {
    const v = xmlText(inner);
    return v === "" ? undefined : v;
  }
  return undefined;
}

/** True for an absolute http(s) URL. */
const isHttp = (u: string): boolean => /^https?:\/\//i.test(u);

/**
 * Parse a sitemap document. `<sitemapindex>` yields child sitemap locations,
 * `<urlset>` yields pages; anything else (an HTML catch-all, JSON) is `unknown`.
 *
 * @param xml - Sitemap text.
 */
export function parseSitemap(xml: string): ParsedSitemap {
  const lower = asciiLower(xml);
  const isIndex = lower.includes("<sitemapindex");
  if (!isIndex && !lower.includes("<urlset")) return { kind: "unknown", entries: [] };
  const entries: SitemapEntry[] = [];
  for (const block of blocks(xml, isIndex ? "sitemap" : "url")) {
    const loc = tag(block, "loc");
    if (!loc || !isHttp(loc)) continue;
    const lastmod = isIndex ? undefined : tag(block, "lastmod");
    entries.push(lastmod ? { loc, lastmod } : { loc });
  }
  return { kind: isIndex ? "index" : "urlset", entries };
}

/**
 * `Sitemap:` lines of a robots.txt (any case, any group), absolute URLs only.
 *
 * @param robots - robots.txt text.
 */
export function robotsSitemaps(robots: string): string[] {
  const out: string[] = [];
  for (const line of robots.split(/\r?\n/)) {
    const m = /^\s*sitemap\s*:\s*(\S+)/i.exec(line);
    if (m?.[1] && isHttp(m[1])) out.push(m[1]);
  }
  return out;
}

const isSpace = (c: string | undefined): boolean => c === " " || c === "\t" || c === "\n" || c === "\r";

/**
 * http(s) link targets of an llms.txt (`[title](target)`), resolved against `base`,
 * in order, de-duplicated. `mailto:`, anchors and other schemes are dropped. A target
 * ends at whitespace, `)`, `>` or `]`, so the scan from one `](` never runs into the next.
 *
 * @param text - llms.txt text.
 * @param base - Absolute URL of the llms.txt (resolves relative targets).
 */
export function llmsLinks(text: string, base: string): string[] {
  const seen = new Set<string>();
  for (let i = text.indexOf("]("); i >= 0; i = text.indexOf("](", i + 2)) {
    let j = i + 2;
    while (isSpace(text[j])) j++;
    if (text[j] === "<") j++;
    let k = j;
    while (k < text.length && !isSpace(text[k]) && text[k] !== ")" && text[k] !== ">" && text[k] !== "]") k++;
    if (text[j] === "#") continue; // in-page anchor: not a page of the site
    try {
      const u = new URL(text.slice(j, k), base);
      if (u.protocol === "http:" || u.protocol === "https:") {
        u.hash = "";
        seen.add(u.href);
      }
    } catch {
      /* unparsable target: skip */
    }
  }
  return [...seen];
}
