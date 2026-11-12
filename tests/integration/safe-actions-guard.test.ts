/**
 * Challenger regressions for the stale-ref guard: cloned element, ref from
 * another tab, refs shown via diff.added, icon-only sensitive button, checkbox
 * effect. Real MCP tools, real Chromium. Runs under Node.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { call, dataUrl, logOf, snapRef, withClient } from "./helpers/safe-actions-harness.js";

test("cloned element placed before the original is refused (ambiguous), never clicked", { timeout: 120_000 }, async () => {
  await withClient(async (c, sessionId, page) => {
    const save = await snapRef(c, sessionId, "Save");
    await page.evaluate("(() => { const o = document.getElementById('C'); o.parentNode.insertBefore(o.cloneNode(true), o); })()");
    const act = await call(c, "browser_act", { sessionId, kind: "click", ref: save });
    assert.equal(act.result.ok, false);
    assert.equal(act.result.error, "ref_stale");
    assert.equal(act.result.reason, "ambiguous_ref");
    assert.equal(await logOf(page), "LOG:");
  });
});

test("a ref from another tab (page without snapshot) is refused", { timeout: 120_000 }, async () => {
  await withClient(async (c, sessionId, page) => {
    const save = await snapRef(c, sessionId, "Save");
    await call(c, "browser_tabs", { sessionId, action: "new", url: dataUrl("<button>Other</button><button>Other2</button><button>Other3</button>") });
    const act = await call(c, "browser_act", { sessionId, kind: "click", ref: save });
    assert.equal(act.result.error, "ref_stale");
    assert.equal(act.result.reason, "no_snapshot");
    assert.equal(await logOf(page), "LOG:");
  });
});

test("refs of elements added by an action (diff.added) are accepted without a new snapshot", { timeout: 120_000 }, async () => {
  const html = "<button id='add' onclick=\"document.body.insertAdjacentHTML('beforeend','<button onclick=document.title=1>Fresh</button>')\">Add</button>";
  await withClient(async (c, sessionId, page) => {
    const add = await snapRef(c, sessionId, "Add");
    const r = await call(c, "browser_act", { sessionId, kind: "click", ref: add });
    const fresh = (r.diff.added as Array<Record<string, string>>).find((e) => e.text === "Fresh");
    assert.ok(fresh?.ref !== undefined);
    const r2 = await call(c, "browser_act", { sessionId, kind: "click", ref: fresh.ref });
    assert.equal(r2.result.ok, true);
    assert.equal(await page.title(), "1");
  }, dataUrl(html));
});

test("icon-only sensitive button (title only) is paused when opted in", { timeout: 120_000 }, async () => {
  const html = "<button title='Delete account' onclick='document.title=1'><svg width=10 height=10></svg></button>";
  await withClient(async (c, sessionId, page) => {
    const snap = await call(c, "browser_snapshot", { sessionId });
    const ref = (snap.elements as Array<Record<string, string>>)[0]?.ref;
    const ask = await call(c, "browser_act", { sessionId, kind: "click", ref, confirmSensitive: true });
    assert.equal(ask.result.error, "confirmation_required");
    assert.notEqual(await page.title(), "1");
  }, dataUrl(html));
});

test("same node, label changes alone (Follow -> Following, Cart (1) -> (2)): action proceeds with refNote", { timeout: 120_000 }, async () => {
  const html = "<button id='f' onclick=\"this.textContent='Following';document.title+='f'\">Follow</button><button id='c' onclick='document.title+=\"c\"'>Cart (1)</button>";
  await withClient(async (c, sessionId, page) => {
    const follow = await snapRef(c, sessionId, "Follow");
    const first = await call(c, "browser_act", { sessionId, kind: "click", ref: follow });
    assert.equal(first.result.ok, true);
    assert.equal(first.result.refNote, undefined, "unchanged label: no note");
    const again = await call(c, "browser_act", { sessionId, kind: "click", ref: follow });
    assert.equal(again.result.ok, true, "label changed on the same node: must not be ref_stale");
    assert.deepEqual(again.result.refNote, { nameChanged: { from: "Follow", to: "Following" } });
    const cart = await snapRef(c, sessionId, "Cart (1)");
    await page.evaluate("document.getElementById('c').textContent = 'Cart (2)'");
    const r = await call(c, "browser_act", { sessionId, kind: "click", ref: cart });
    assert.equal(r.result.ok, true);
    assert.deepEqual(r.result.refNote, { nameChanged: { from: "Cart (1)", to: "Cart (2)" } });
    assert.ok((await page.title()).endsWith("c"));
  }, dataUrl(html));
});

test("name change TOGETHER with another identity change still refuses", { timeout: 120_000 }, async () => {
  await withClient(async (c, sessionId, page) => {
    const save = await snapRef(c, sessionId, "Save");
    await page.evaluate("(() => { const n = document.getElementById('C'); n.textContent = 'Delete everything'; n.id = 'D'; })()");
    const act = await call(c, "browser_act", { sessionId, kind: "click", ref: save });
    assert.equal(act.result.error, "ref_stale");
    assert.match(String(act.result.reason), /id/);
    assert.equal(await logOf(page), "LOG:");
  });
});

test("effect report sees a checkbox toggle", { timeout: 120_000 }, async () => {
  await withClient(async (c, sessionId) => {
    const r = await call(c, "browser_click", { sessionId, target: "#cb" });
    assert.equal(r.effect.domChanged, true);
  }, dataUrl("<input type='checkbox' id='cb'>"));
});
