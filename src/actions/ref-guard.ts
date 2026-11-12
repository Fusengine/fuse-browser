/**
 * Stale-ref guard: before a ref is used, compare the live node with what the
 * agent was shown in its last `browser_snapshot`. A mismatch (node gone, document
 * replaced, tag/role/id/name/type/href/text different) refuses with `ref_stale`
 * rather than acting on whatever now carries that number.
 * @module actions/ref-guard
 */
import type { Locator, Page } from "playwright";
import { DOC_ATTRIBUTE, REF_ATTRIBUTE } from "../extraction/snapshot-walk.js";
import type { ActionResult } from "../interfaces/types.js";
import type { RefIdentity, RefNote } from "../interfaces/safe-actions.js";
import { evalScriptArg } from "../lib/evaluate.js";
import { parseRef } from "./ref-locator.js";
import { registryFor } from "./ref-registry.js";

/** Live facts read from the referenced node (same text rule as the snapshot walk). */
export interface LiveRef extends Omit<RefIdentity, "frame"> {
  doc: string | null;
  /** The node received its stamp from a snapshot walk (clones/copies do not); set by the node probe. */
  owned?: boolean;
  title: string | null;
  editable: boolean;
}

/** Duck-typed DOM element (this tsconfig has no `dom` lib). */
interface DomEl {
  tagName: string;
  id: string;
  innerText?: string;
  isContentEditable?: boolean;
  getAttribute(n: string): string | null;
  ownerDocument: { documentElement: { getAttribute(n: string): string | null } };
}

/** Read the live identity of the node behind a locator; `null` when it is gone. */
export async function probeLive(locator: Locator): Promise<LiveRef | null> {
  try {
    return await locator.evaluate((node, docAttr) => {
      const el = node as unknown as DomEl;
      const tag = el.tagName.toLowerCase();
      const text = (el.innerText || el.getAttribute("aria-label") || el.getAttribute("placeholder") || "").trim().slice(0, 120);
      return {
        tag,
        role: el.getAttribute("role"),
        id: el.id || null,
        name: el.getAttribute("name"),
        type: el.getAttribute("type"),
        href: el.getAttribute("href"),
        text,
        title: el.getAttribute("title"),
        doc: (el.ownerDocument.documentElement.getAttribute(docAttr) ?? "").split(":")[0] || null,
        editable: tag === "input" || tag === "textarea" || el.isContentEditable === true,
      };
    }, DOC_ATTRIBUTE);
  } catch {
    return null;
  }
}

/** What the page-side probe reports about a ref's stamp. */
interface NodeProbe {
  count: number;
  live: LiveRef | null;
}

/**
 * Page-side probe run in the SAME evaluation world as the snapshot walk (so the
 * walk's WeakMap of stamped nodes is visible): finds every node carrying the stamp
 * (piercing open shadow roots), and reports the first one's identity plus whether
 * the walk itself stamped it (`owned`; a cloneNode copy is not).
 */
const PROBE_NODE_SCRIPT = `(arg) => {
  const found = [];
  const scan = (root) => {
    for (const el of root.querySelectorAll('[' + arg.refAttr + '="' + arg.local + '"]')) found.push(el);
    for (const h of root.querySelectorAll('*')) if (h.shadowRoot) scan(h.shadowRoot);
  };
  scan(document);
  const el = found[0];
  if (!el) return { count: 0, live: null };
  const tag = el.tagName.toLowerCase();
  const nodes = globalThis.__fuseNodes;
  return { count: found.length, live: {
    tag, role: el.getAttribute('role'), id: el.id || null, name: el.getAttribute('name'),
    type: el.getAttribute('type'), href: el.getAttribute('href'),
    text: (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().slice(0, 120),
    title: el.getAttribute('title'),
    owned: !!nodes && nodes.get(el) === el.getAttribute(arg.refAttr),
    doc: (document.documentElement.getAttribute(arg.docAttr) || '').split(':')[0] || null,
    editable: tag === 'input' || tag === 'textarea' || el.isContentEditable === true,
  } };
}`;

/** Probe the node(s) behind a ref in its own frame; `null` when the frame is gone. */
async function probeNode(page: Page, ref: string | number): Promise<NodeProbe | null> {
  const { frame, local } = parseRef(ref);
  const target = page.frames()[frame];
  if (!target || target.isDetached()) return null;
  const arg = { local, refAttr: REF_ATTRIBUTE, docAttr: DOC_ATTRIBUTE };
  return evalScriptArg<NodeProbe, typeof arg>(target, PROBE_NODE_SCRIPT, arg).catch(() => null);
}

/** Field names that differ between the remembered and the live element. */
function diffFields(want: RefIdentity, live: LiveRef): string[] {
  const keys = ["tag", "role", "id", "name", "type", "href"] as const;
  const bad: string[] = keys.filter((k) => want[k] !== live[k]);
  // An editable element's text is its (changing) content, not its identity.
  if (!live.editable && want.text !== live.text) bad.push("text");
  return bad;
}

/** Build the `ref_stale` result. */
function stale(
  ref: string | number,
  reason: string,
  generation: number,
  want?: RefIdentity,
  live?: LiveRef | null,
): ActionResult {
  const brief = (i?: { tag: string; role: string | null; text: string }) => (i ? { tag: i.tag, role: i.role, text: i.text } : undefined);
  return {
    type: "ref",
    ok: false,
    ref,
    error: "ref_stale",
    reason,
    expected: brief(want),
    found: brief(live ?? undefined),
    generation,
    hint: "The page changed since your last browser_snapshot; call browser_snapshot again and use the new ref.",
  };
}

/**
 * Verify `ref` still points at the element the agent saw.
 *
 * @returns `null` when the ref may be used, else a `ref_stale` result. A page
 *   with no snapshot of its own (new tab, recovered page) has no valid refs; a ref
 *   matching more than one node (a cloned element keeps its stamp) is ambiguous.
 */
export async function guardRef(
  page: Page,
  ref: string | number,
  onNote?: (note: RefNote) => void,
): Promise<ActionResult | null> {
  const reg = registryFor(page);
  const key = String(ref);
  const gen = reg.generation;
  if (!reg.active) return stale(ref, "no_snapshot", gen);
  const want = reg.get(key);
  if (!want) return stale(ref, "not_in_snapshot", gen);
  const node = await probeNode(page, ref);
  const live = node?.live;
  if (!node || !live) return stale(ref, "element_gone", gen, want);
  if (node.count > 1) return stale(ref, "ambiguous_ref", gen, want, live);
  if (!live.owned) return stale(ref, "not_original", gen, want, live);
  if (live.doc === null || live.doc !== reg.docOf(parseRef(ref).frame)) return stale(ref, "document_changed", gen, want, live);
  const bad = diffFields(want, live);
  if (bad.length === 0) return null;
  // The same stamped node whose label alone changed ("Follow" -> "Following",
  // "Cart (1)" -> "Cart (2)") is still the element the agent saw: proceed, but say so.
  if (bad.length === 1 && bad[0] === "text") {
    onNote?.({ nameChanged: { from: want.text, to: live.text } });
    return null;
  }
  return stale(ref, `element_changed:${bad.join(",")}`, gen, want, live);
}
