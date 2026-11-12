/**
 * Docs-native read ladder: when a site publishes its own markdown, use it
 * instead of extracting the HTML. Three routes, never more than ONE extra
 * request per call, never on a non-2xx page, same-origin only, and every extra
 * request goes through `fetchFast` (so the SSRF guard applies exactly as on the
 * main fetch):
 * 1. the server already answered markdown to our `Accept: text/markdown`;
 * 2. the page advertises a twin: `Link: <…>; rel="alternate"; type="text/markdown"`;
 * 3. opt-in (`preferMarkdown`): the `<path>.md` twin of the URL.
 * @module net/doc-markdown
 */
import { type FastResponse, fetchFast } from "./fetch-fast.js";

/** Every {@link DocSource} value — single source for the type and the output schema. */
export const DOC_SOURCES = ["site-markdown", "html"] as const;

/** Where the returned body came from (set only when the ladder was relevant). */
export type DocSource = (typeof DOC_SOURCES)[number];

/** Outcome of {@link applyDocLadder}. */
export interface DocLadderResult {
  response: FastResponse;
  source?: DocSource;
}

/** Ladder switches. */
export interface DocLadderOptions {
  /** Also try the `.md` twin of the URL when the page advertises none. */
  preferMarkdown?: boolean;
  proxyUrl?: string;
}

const MARKDOWN_TYPES = ["text/markdown", "text/x-markdown"];
const isMarkdownType = (contentType: string): boolean => MARKDOWN_TYPES.some((t) => contentType.startsWith(t));

/**
 * Target of a `Link: <…>; rel="alternate"; type="text/markdown"` header, resolved
 * against `base`; `null` when none is advertised.
 *
 * @param link - Raw `Link` header value (possibly several comma-separated links).
 * @param base - URL of the page that sent it.
 */
export function markdownAlternate(link: string | undefined, base: string): string | null {
  if (!link) return null;
  // One link-value = `<target>` + params; a comma inside a quoted param does not split it.
  for (const m of link.matchAll(/<([^>]*)>((?:[^,"]|"[^"]*")*)/g)) {
    const params = (m[2] ?? "").toLowerCase();
    const alternate = /;\s*rel\s*=\s*"?(?:[^";]*\s)?alternate(?=[\s";]|$)/.test(params);
    const markdown = /;\s*type\s*=\s*"?text\/(?:x-)?markdown\b/.test(params);
    if (!alternate || !markdown) continue;
    try {
      return new URL(m[1] ?? "", base).href;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * The `.md` twin of a docs URL: `<path>.md`, no query/hash. `null` for the site
 * root and for a path that is already `.md`.
 *
 * @param pageUrl - The fetched page URL.
 */
export function mdTwinUrl(pageUrl: string): string | null {
  const u = new URL(pageUrl);
  const path = u.pathname.replace(/\/+$/, "");
  if (path === "" || path.endsWith(".md")) return null;
  u.pathname = `${path}.md`;
  u.search = "";
  u.hash = "";
  return u.href;
}

/** True when `twin` is a usable markdown answer: 200, not HTML/PDF, markdown or plain text, non-empty. */
function isMarkdownAnswer(twin: FastResponse): boolean {
  if (twin.status !== 200 || twin.isHtml || twin.pdf) return false;
  const markdownLike = isMarkdownType(twin.contentType) || twin.contentType.startsWith("text/plain");
  return markdownLike && twin.html.trim() !== "";
}

/**
 * Upgrade a fast-path response to the site's own markdown when it offers one.
 *
 * @param r - The main fast-path response.
 * @param opts - `preferMarkdown` + proxy.
 * @returns The response to use (the twin keeps the page's `url`) and its `source`:
 *   `"site-markdown"` when the site's markdown is used, `"html"` when
 *   `preferMarkdown` was set and none was found; absent otherwise.
 */
export async function applyDocLadder(r: FastResponse, opts: DocLadderOptions = {}): Promise<DocLadderResult> {
  if (r.status < 200 || r.status >= 300 || r.pdf) return { response: r };
  if (isMarkdownType(r.contentType)) return { response: r, source: "site-markdown" };
  if (!r.isHtml) return { response: r };
  const fallback: DocLadderResult = { response: r, ...(opts.preferMarkdown ? { source: "html" as const } : {}) };
  try {
    const target = markdownAlternate(r.headers.link, r.url) ?? (opts.preferMarkdown ? mdTwinUrl(r.url) : null);
    if (!target || new URL(target).origin !== new URL(r.url).origin) return fallback;
    const twin = await fetchFast(target, opts.proxyUrl);
    // impit follows redirects: the twin's FINAL url must still be on the page's origin.
    return isMarkdownAnswer(twin) && new URL(twin.url).origin === new URL(r.url).origin ? { response: { ...twin, url: r.url }, source: "site-markdown" } : fallback;
  } catch {
    return fallback; // an unreachable/blocked twin never fails the page that already resolved
  }
}
