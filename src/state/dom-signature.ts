/**
 * DOM signature: stable fingerprint of content + interactive elements.
 * @module state/dom-signature
 */
import type { Page } from "playwright";
import { evalScript } from "../lib/evaluate.js";
import { sha1 } from "../lib/fs.js";

const SIGNATURE_SCRIPT = `() => JSON.stringify({
  text: document.body?.innerText || '',
  buttons: [...document.querySelectorAll('button,a,input,select,textarea')]
    .map(el => [el.tagName, el.innerText, el.value, el.getAttribute('aria-label'), el.id, el.className, el.checked === true])
})`;

/** Compute a SHA-1 fingerprint of the current DOM state. */
export async function domSignature(page: Page): Promise<string> {
  const raw = await evalScript<string>(page, SIGNATURE_SCRIPT);
  return sha1(raw);
}
