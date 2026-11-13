/**
 * Browser-side snapshot walk: collects interactive elements, piercing OPEN
 * Shadow DOM recursively. Iframes are NOT descended here — each frame is walked
 * separately on the Node side via {@link captureSnapshot} (cross-origin frames
 * are unreadable from the parent context, and same-origin ones would duplicate).
 * Closed shadow roots are inaccessible by browser SOP and stay opaque.
 * @module extraction/snapshot-walk
 */

import { HIDDEN_DEFS } from "./snapshot-hidden.js";
import { SELECTOR_DEFS } from "./selector.js";

/** Attribute injected on each interactive element to anchor a stable ref. */
export const REF_ATTRIBUTE = "data-fuse-ref";

const SELECTOR =
  "button,a,input,select,textarea,[role=button],[role=combobox],[role=checkbox],[role=radio],[role=switch],[role=tab],[role=menuitem],[role=option],[contenteditable=true]";

/** Document-level attribute holding `<token>:<next id>` (the token changes with the document). */
export const DOC_ATTRIBUTE = "data-fuse-doc";

/** Elements described per frame (the rest are counted as dropped). */
export const MAX_PER_FRAME = 200;

/**
 * Arrow-function source (run via `evalScript` in each frame). Stamps each
 * element ONCE with a monotonic per-document id in `data-fuse-ref` (an existing
 * stamp is kept, so refs never renumber when the DOM changes; a stamp copied onto
 * another node by cloneNode is not honoured there). A new document starts its ids
 * at `arg.base` (distinct per tab) and never stamps past `arg.cap`. Returns `{ doc, els, dropped }`: elements in visitation
 * order plus the number of matches beyond `arg.limit` (default 200). The Node
 * side rewrites `index` to a global counter and builds the frame-scoped `ref`
 * from `refId`.
 */
export const SNAPSHOT_SCRIPT = `(arg) => {
  const SEL = '${SELECTOR}';
  const wantSel = !!(arg && arg.selectors);${SELECTOR_DEFS}${HIDDEN_DEFS}
  const obscured = (el, r) => {
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    if (r.width === 0 || cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) return false;
    const top = document.elementFromPoint(cx, cy);
    return !!top && top !== el && !el.contains(top) && !top.contains(el);
  };
  const LIMIT = arg && typeof arg.limit === 'number' ? arg.limit : ${MAX_PER_FRAME};
  const de = document.documentElement;
  const meta = (de.getAttribute('${DOC_ATTRIBUTE}') || '').split(':');
  const doc = meta[0] || Math.random().toString(36).slice(2, 10);
  let seq = Number(meta[1]) >= 0 ? Number(meta[1]) : (arg && typeof arg.base === 'number' ? arg.base : 0);
  const CAP = arg && typeof arg.cap === 'number' ? arg.cap : Infinity;
  const nodes = globalThis.__fuseNodes || (globalThis.__fuseNodes = new WeakMap());
  const stamp = (el, foreign) => {
    let s = el.getAttribute('${REF_ATTRIBUTE}');
    if (foreign || s === null || !/^[0-9]+$/.test(s)) {
      if (seq >= CAP) return null;
      s = String(seq++);
      el.setAttribute('${REF_ATTRIBUTE}', s);
    }
    nodes.set(el, s);
    return s;
  };
  const out = [];
  let dropped = 0;
  const describe = (el, index, refId) => {
    const r = el.getBoundingClientRect();
    const val = typeof el.value === 'string' ? el.value : null;
    const isCheck = el.type === 'checkbox' || el.type === 'radio';
    return {
      index, refId,
      tag: el.tagName.toLowerCase(),
      text: (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().slice(0, 120),
      role: el.getAttribute('role'), id: el.id || null, name: el.getAttribute('name'),
      type: el.getAttribute('type'), href: el.getAttribute('href'),
      value: el.type === 'password' ? null : (val ? val.slice(0, 120) : null),
      hasValue: !!val, placeholder: el.getAttribute('placeholder'),
      disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true',
      checked: isCheck ? !!el.checked : undefined,
      options: el.tagName === 'SELECT' ? [...el.options].slice(0, 12).map((o) => o.label || o.value) : undefined,
      ariaExpanded: el.getAttribute('aria-expanded'), ariaControls: el.getAttribute('aria-controls'),
      visible: r.width > 0 && r.height > 0, obscured: obscured(el, r),
      prunable: isPrunable(el),
      selector: wantSel ? genSelector(el) : undefined,
      box: {x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height)}
    };
  };
  const all = [];
  const have = new Set();
  const add = (el) => { if (!have.has(el)) { have.add(el); all.push(el); } };
  const collect = (root) => {
    for (const el of root.querySelectorAll(SEL)) add(el);
    for (const host of root.querySelectorAll('*')) {
      if (host.shadowRoot) collect(host.shadowRoot);
    }
  };
  const W = arg && arg.within;
  let matched;
  if (!W) collect(document);
  else {
    // Scoped walk: only the subtree(s) of a CSS selector, or of the node the ref names.
    const roots = [];
    const stamped = (root) => {
      for (const el of root.querySelectorAll('[${REF_ATTRIBUTE}="' + W.local + '"]')) if (nodes.get(el) === W.local) roots.push(el);
      for (const h of root.querySelectorAll('*')) if (h.shadowRoot) stamped(h.shadowRoot);
    };
    try {
      if (W.css !== undefined) roots.push(...document.querySelectorAll(W.css));
      else stamped(document);
    } catch (e) {
      return { doc, els: [], dropped: 0, matched: 0, scopeError: 'invalid_selector' };
    }
    matched = roots.length;
    for (const r of roots) {
      if (r.matches(SEL)) add(r);
      collect(r);
      if (r.shadowRoot) collect(r.shadowRoot);
    }
  }
  // A stamp is honoured only on the node that received it from this walk (tracked in a
  // WeakMap, which cloneNode/replaceWith copies do NOT inherit): a clone carrying a copied
  // stamp is foreign and gets a fresh id (or loses the stamp past the limit), so an old
  // ref can never land on a clone. Past the tab's id namespace (CAP) nothing is stamped.
  all.forEach((el, i) => {
    const s = el.getAttribute('${REF_ATTRIBUTE}');
    const own = s !== null && nodes.get(el) === s;
    if (i >= LIMIT) { dropped++; if (s !== null && !own) el.removeAttribute('${REF_ATTRIBUTE}'); return; }
    const refId = stamp(el, !own);
    if (refId === null) { dropped++; return; }
    out.push(describe(el, out.length, refId));
  });
  de.setAttribute('${DOC_ATTRIBUTE}', doc + ':' + seq);
  return { doc, els: out, dropped, matched };
}`;
