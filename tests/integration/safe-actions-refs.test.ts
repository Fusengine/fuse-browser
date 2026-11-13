/**
 * Stale-ref guard (#1) through the real MCP tools (in-memory client, real
 * Chromium on a local page). Runs under Node.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { call, dataUrl, insertAt, logOf, snapRef, withClient } from "./helpers/safe-actions-harness.js";

test("ref drift: insertion BEFORE never clicks another element, same ref still hits Save", { timeout: 120_000 }, async () => {
  await withClient(async (c, sessionId, page) => {
    const save = await snapRef(c, sessionId, "Save");
    await insertAt(page, "before");
    const act = await call(c, "browser_act", { sessionId, kind: "click", ref: save });
    const log = await logOf(page);
    assert.ok(!log.includes("[Delete account]"), `must not click Delete account: ${log}`);
    assert.equal(act.result.ok, true);
    assert.equal(log, "LOG: [Save]");
  });
});

test("ref drift: insertion after and no change click Save", { timeout: 120_000 }, async () => {
  await withClient(async (c, sessionId, page) => {
    const save = await snapRef(c, sessionId, "Save");
    await insertAt(page, "after");
    assert.equal((await call(c, "browser_act", { sessionId, kind: "click", ref: save })).result.ok, true);
    assert.equal(await logOf(page), "LOG: [Save]");
  });
  await withClient(async (c, sessionId, page) => {
    const save = await snapRef(c, sessionId, "Save");
    assert.equal((await call(c, "browser_act", { sessionId, kind: "click", ref: save })).result.ok, true);
    assert.equal(await logOf(page), "LOG: [Save]");
  });
});

test("ref drift: removed element and recycled node are refused with ref_stale", { timeout: 120_000 }, async () => {
  await withClient(async (c, sessionId, page) => {
    const save = await snapRef(c, sessionId, "Save");
    await page.evaluate("document.getElementById('C').remove()");
    const act = await call(c, "browser_act", { sessionId, kind: "click", ref: save });
    assert.equal(act.result.ok, false);
    assert.equal(act.result.error, "ref_stale");
    assert.equal(await logOf(page), "LOG:");
  });
  await withClient(async (c, sessionId, page) => {
    const save = await snapRef(c, sessionId, "Save");
    // A recycled row changes more than its label (id/data/href): realistic fixture.
    await page.evaluate("(() => { const n = document.getElementById('C'); n.textContent = 'Delete everything'; n.id = 'D'; })()");
    const act = await call(c, "browser_act", { sessionId, kind: "click", ref: save });
    assert.equal(act.result.error, "ref_stale");
    assert.equal(act.result.hint.includes("browser_snapshot"), true);
    assert.equal(await logOf(page), "LOG:");
  });
});

test("ref drift: sub-frame ref is refused after the frame disappears", { timeout: 120_000 }, async () => {
  const framed = "<iframe id='fr' srcdoc=\"<button onclick='document.title=1'>InFrame</button>\"></iframe>";
  await withClient(async (c, sessionId, page) => {
    await page.frameLocator("#fr").locator("button").waitFor({ state: "attached", timeout: 30_000 });
    const ref = await snapRef(c, sessionId, "InFrame");
    assert.ok(ref.includes(":"));
    await page.evaluate("document.getElementById('fr').remove()");
    const act = await call(c, "browser_act", { sessionId, kind: "click", ref });
    assert.equal(act.result.ok, false);
    assert.equal(act.result.error, "ref_stale");
  }, dataUrl(framed));
});

const ROWS =
  "<ul id='l'><li data-n='X'><button>Delete</button></li></ul><button id='other'>Other</button><div id='log'>LOG:</div>" +
  "<script>document.addEventListener('click',e=>{const li=e.target.closest('li');if(li)document.getElementById('log').textContent+=' ['+li.dataset.n+']'})</script>";

test("gate A: a clone inserted before the original never wins the ref, even after an unrelated act walked the page", { timeout: 120_000 }, async () => {
  await withClient(async (c, sessionId, page) => {
    const snap = await call(c, "browser_snapshot", { sessionId });
    const els = snap.elements as Array<Record<string, string>>;
    const del = els.find((e) => e.text === "Delete")?.ref;
    const other = els.find((e) => e.text === "Other")?.ref;
    await page.evaluate("(() => { const o = document.querySelector('li'); const k = o.cloneNode(true); k.dataset.n = 'NEW'; o.parentNode.insertBefore(k, o); })()");
    await call(c, "browser_act", { sessionId, kind: "click", ref: other });
    const a2 = await call(c, "browser_act", { sessionId, kind: "click", ref: del });
    const log = await logOf(page);
    assert.ok(!log.includes("[NEW]"), `the clone must never be clicked: ${log}`);
    assert.ok(a2.result.error === "ref_stale" || log.includes("[X]"), JSON.stringify(a2.result));
  }, dataUrl(ROWS));
});

test("gate B: a ref from another tab that also has a snapshot is refused after switching back", { timeout: 120_000 }, async () => {
  await withClient(async (c, sessionId, page) => {
    await call(c, "browser_snapshot", { sessionId });
    await call(c, "browser_tabs", { sessionId, action: "new", url: dataUrl("<button>B0</button><button>B1</button><button>B-Target</button><button>B3</button>") });
    const sB = await call(c, "browser_snapshot", { sessionId });
    const refB = (sB.elements as Array<Record<string, string>>).find((e) => e.text === "B-Target")?.ref;
    await call(c, "browser_tabs", { sessionId, action: "select", index: 0 });
    const act = await call(c, "browser_act", { sessionId, kind: "click", ref: refB });
    assert.equal(act.result.ok, false);
    assert.equal(act.result.error, "ref_stale");
    assert.equal(await logOf(page), "LOG:");
  });
});

test("pass2 #1: tab base is never reused after a close (A,B,C; close B; open D)", { timeout: 120_000 }, async () => {
  await withClient(async (c, sessionId) => {
    await call(c, "browser_snapshot", { sessionId });
    await call(c, "browser_tabs", { sessionId, action: "new", url: dataUrl("<button>B0</button>") });
    await call(c, "browser_tabs", { sessionId, action: "new", url: dataUrl("<button onclick=\"document.title='C-CLICKED'\">C-Danger</button>") });
    await call(c, "browser_snapshot", { sessionId });
    await call(c, "browser_tabs", { sessionId, action: "close", index: 1 });
    await call(c, "browser_tabs", { sessionId, action: "new", url: dataUrl("<button onclick=\"document.title='D-CLICKED'\">D-Target</button>") });
    const sD = await call(c, "browser_snapshot", { sessionId });
    const refD = (sD.elements as Array<Record<string, string>>)[0]?.ref;
    await call(c, "browser_tabs", { sessionId, action: "select", index: 1 });
    const act = await call(c, "browser_act", { sessionId, kind: "click", ref: refD });
    assert.equal(act.result.ok, false);
    assert.equal(act.result.error, "ref_stale");
    const tabs = (await call(c, "browser_tabs", { sessionId, action: "list" })).tabs as Array<Record<string, string>>;
    assert.ok(!tabs.some((t) => /CLICKED/.test(t.title)), JSON.stringify(tabs));
  });
});

test("pass2 #1: ids past the tab's namespace are not stamped (truncated, no overflow into another tab)", { timeout: 120_000 }, async () => {
  await withClient(async (c, sessionId, page) => {
    await page.evaluate("document.documentElement.setAttribute('data-fuse-doc', 'x:9999998')");
    const snap = await call(c, "browser_snapshot", { sessionId });
    assert.equal(snap.count, 2);
    assert.equal(snap.truncated, true);
    assert.equal(snap.dropped, 2);
  });
});

test("pass2 #2: a clone that REPLACES the original (same text, other data) is refused", { timeout: 120_000 }, async () => {
  await withClient(async (c, sessionId, page) => {
    const snap = await call(c, "browser_snapshot", { sessionId });
    const del = (snap.elements as Array<Record<string, string>>).find((e) => e.text === "Delete")?.ref;
    await page.evaluate("(() => { const o = document.querySelector('li'); const k = o.cloneNode(true); k.dataset.n = 'NEW'; o.replaceWith(k); })()");
    const a = await call(c, "browser_act", { sessionId, kind: "click", ref: del });
    assert.equal(a.result.ok, false);
    assert.equal(a.result.error, "ref_stale");
    assert.ok(!(await logOf(page)).includes("[NEW]"));
  }, dataUrl(ROWS));
});

test("pass2 #2: a moved original (same node re-appended) stays actionable", { timeout: 120_000 }, async () => {
  await withClient(async (c, sessionId, page) => {
    const snap = await call(c, "browser_snapshot", { sessionId });
    const del = (snap.elements as Array<Record<string, string>>).find((e) => e.text === "Delete")?.ref;
    await page.evaluate("document.body.appendChild(document.querySelector('li'))");
    assert.equal((await call(c, "browser_act", { sessionId, kind: "click", ref: del })).result.ok, true);
    assert.equal(await logOf(page), "LOG: [X]");
  }, dataUrl(ROWS));
});

test("snapshot reports a generation; annotate keeps refs actionable", { timeout: 120_000 }, async () => {
  await withClient(async (c, sessionId, page) => {
    const s1 = await call(c, "browser_snapshot", { sessionId });
    const s2 = await call(c, "browser_snapshot", { sessionId });
    assert.equal(typeof s1.generation, "number");
    assert.equal(s2.generation, s1.generation + 1);
    const save = (s2.elements as Array<Record<string, string>>).find((e) => e.text === "Save")?.ref;
    const act = await call(c, "browser_act", { sessionId, kind: "click", ref: save, annotate: true });
    assert.equal(act.result.ok, true);
    assert.equal(await logOf(page), "LOG: [Save]");
    // refs of elements added by an action (diff.added) are usable too
    await page.evaluate("document.getElementById('bar').insertAdjacentHTML('beforeend','<button id=N>New</button>')");
    const snap = await call(c, "browser_snapshot", { sessionId });
    const n = (snap.elements as Array<Record<string, string>>).find((e) => e.text === "New")?.ref;
    assert.equal((await call(c, "browser_act", { sessionId, kind: "click", ref: n })).result.ok, true);
  });
});
