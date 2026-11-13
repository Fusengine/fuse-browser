/**
 * Include/exclude path filter of `browser_map`. The patterns come from the caller
 * and the paths from the (hostile) site, so matching is an iterative wildcard
 * match — never a regex built from either.
 * @module agent/map-filter
 */

/** Glob match: `*` matches any run of characters (including `/`). Iterative with one backtrack point: O(pattern × text), never exponential. */
function globMatch(pattern: string, text: string): boolean {
  let p = 0;
  let t = 0;
  let star = -1;
  let mark = 0;
  while (t < text.length) {
    if (pattern[p] === "*") {
      star = p++;
      mark = t;
    } else if (p < pattern.length && pattern[p] === text[t]) {
      p++;
      t++;
    } else if (star >= 0) {
      p = star + 1;
      t = ++mark;
    } else {
      return false;
    }
  }
  while (pattern[p] === "*") p++;
  return p === pattern.length;
}

/**
 * Whether `path` matches `pattern`: `*` is a wildcard; a pattern WITHOUT `*` also
 * matches everything below it (`/docs` matches `/docs` and `/docs/a`).
 */
function pathMatches(path: string, pattern: string): boolean {
  if (pattern.includes("*")) return globMatch(pattern, path);
  const base = pattern.replace(/\/+$/, "");
  return path === base || path.startsWith(`${base}/`) || path === pattern;
}

/**
 * Build the include/exclude predicate over a URL's path.
 *
 * @param include - Keep only matching paths (empty/undefined = keep all).
 * @param exclude - Drop matching paths.
 */
export function pathFilter(include: string[] = [], exclude: string[] = []): (url: string) => boolean {
  return (url) => {
    let path: string;
    try {
      path = new URL(url).pathname;
    } catch {
      return false;
    }
    if (include.length > 0 && !include.some((p) => pathMatches(path, p))) return false;
    return !exclude.some((p) => pathMatches(path, p));
  };
}
