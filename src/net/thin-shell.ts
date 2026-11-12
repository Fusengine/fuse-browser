/**
 * Heuristic: does an HTTP response look like an empty client-rendered shell?
 * The fast-path (impit) never runs JS, so a CSR/SPA page comes back as a near-
 * empty skeleton plus scripts. Flagging it lets callers escalate to a real
 * browser. Conservative by design — a short but content-bearing page (404,
 * landing) is NOT a shell unless it also carries SPA markers / heavy scripting.
 * @module net/thin-shell
 */

/** Visible text below this (chars) is "thin" — too little to be the real content. */
export const THIN_TEXT_CHARS = 600;

/** Minimum `<script>` tags that, with thin text, suggest a JS-rendered page. */
const SCRIPT_HEAVY = 3;

/** Mount-point ids that frameworks hydrate into (Next/Nuxt/Vite/CRA/Svelte/Angular). */
const SPA_ROOT = /<div[^>]+id=["'](?:__next|__nuxt|root|app|svelte|q-app)["']/i;

/**
 * Visible text from raw HTML: drop `<script>`/`<style>` blocks (their source
 * counts in `textContent` but is not visible) and all tags, then collapse
 * whitespace. Working from the raw string avoids the inline-script pollution
 * that makes a bare SPA shell look content-rich, and recovers text from fragment
 * pages where a DOM parser yields an empty body.
 *
 * @param html - Raw response body.
 * @returns The collapsed visible text.
 */
export function visibleText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when raw HTML carries JS-rendering markers — an SPA hydration mount
 * point or a heavy `<script>` count — regardless of visible text length. A
 * chrome-heavy shell (nav/footer markup) can clear the `isThinShell` text
 * threshold yet still ship its real content only after client-side hydration;
 * this is the raw-HTML half of that check, reusable post-extraction to gate
 * escalation on an actually-empty extraction rather than raw-HTML length.
 *
 * @param html - Raw response body.
 */
export function looksJsRendered(html: string): boolean {
  const scriptHeavy = (html.match(/<script\b/gi)?.length ?? 0) >= SCRIPT_HEAVY;
  return SPA_ROOT.test(html) || scriptHeavy;
}

/**
 * True when `html` looks like an unrendered SPA shell worth a browser pass.
 * @param html - Raw response body.
 */
export function isThinShell(html: string): boolean {
  if (visibleText(html).length >= THIN_TEXT_CHARS) return false; // already has real content
  return looksJsRendered(html);
}
