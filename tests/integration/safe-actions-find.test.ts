/**
 * Wave 2 (#7 rest): scoped snapshot (`within`) and `browser_find`, through the
 * real MCP tools on a real Chromium. Runs under Node.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { call, dataUrl, DRIFT_URL, withClient, type Out } from "./helpers/safe-actions-harness.js";

const FORM =
  "<button onclick=\"document.title+='[Outside]'\">Outside</button>" +
  "<form id='f'><fieldset id='fs'><input placeholder='Name'><button type='button' onclick=\"document.title+='[Save]'\">Save</button></fieldset><button type='button'>Cancel form</button></form>" +
  "<div role='tab' id='t'>Tab<button>Inner</button></div><div id='o'><button>Other</button></div>";

const texts = (snap: Out): string[] => (snap.elements as Array<Record<string, string>>).map((e) => e.text);

test("within (CSS): only that subtree's elements, with scope.matched", { timeout: 120_000 }, async () => {
  await withClient(async (c, sessionId) => {
    const snap = await call(c, "browser_snapshot", { sessionId, within: "#fs" });
    assert.deepEqual(texts(snap), ["Name", "Save"]);
    assert.equal(snap.count, 2);
    assert.equal(snap.scope.matched, 1);
    const none = await call(c, "browser_snapshot", { sessionId, within: "#nope" });
    assert.equal(none.count, 0);
    assert.equal(none.scope.matched, 0);
    const bad = await call(c, "browser_snapshot", { sessionId, within: "##(" });
    assert.equal(bad.count, 0);
    assert.equal(bad.scope.error, "invalid_selector");
  }, dataUrl(FORM));
});

test("within (ref): the ref's own element and its descendants; scoped refs are guarded like full ones", { timeout: 120_000 }, async () => {
  await withClient(async (c, sessionId, page) => {
    const full = await call(c, "browser_snapshot", { sessionId });
    const tab = (full.elements as Array<Record<string, string>>).find((e) => e.role === "tab")?.ref;
    const outside = (full.elements as Array<Record<string, string>>).find((e) => e.text === "Outside")?.ref;
    const scoped = await call(c, "browser_snapshot", { sessionId, within: tab });
    assert.equal(scoped.count, 2);
    assert.ok(texts(scoped).includes("Inner"));
    assert.ok(texts(scoped).some((t) => t.startsWith("Tab")));
    assert.ok(scoped.generation > full.generation);
    // same stamps as the full snapshot
    const fullInner = (full.elements as Array<Record<string, string>>).find((e) => e.text === "Inner")?.ref;
    assert.equal((scoped.elements as Array<Record<string, string>>).find((e) => e.text === "Inner")?.ref, fullInner);
    // refs from before the scoped call stay accepted (scoped snapshot adds, never drops)
    assert.equal((await call(c, "browser_act", { sessionId, kind: "click", ref: outside })).result.ok, true);
    // a scoped ref made stale is refused
    await page.evaluate("document.querySelector('#t button').remove()");
    assert.equal((await call(c, "browser_act", { sessionId, kind: "click", ref: fullInner })).result.error, "ref_stale");
  }, dataUrl(FORM));
});

test("scoped refs are actionable (click Save from a scoped snapshot)", { timeout: 120_000 }, async () => {
  await withClient(async (c, sessionId, page) => {
    const scoped = await call(c, "browser_snapshot", { sessionId, within: "#fs" });
    const save = (scoped.elements as Array<Record<string, string>>).find((e) => e.text === "Save")?.ref;
    assert.equal((await call(c, "browser_act", { sessionId, kind: "click", ref: save })).result.ok, true);
    assert.equal(await page.title(), "[Save]");
  }, dataUrl(FORM));
});

test("without within, browser_snapshot keeps its exact shape (no scope key)", { timeout: 120_000 }, async () => {
  await withClient(async (c, sessionId) => {
    const a = await call(c, "browser_snapshot", { sessionId });
    const b = await call(c, "browser_snapshot", { sessionId });
    assert.deepEqual(Object.keys(a).sort(), ["count", "dropped", "elements", "generation", "truncated", "url"]);
    assert.equal(JSON.stringify({ ...a, generation: 0 }), JSON.stringify({ ...b, generation: 0 }));
  }, DRIFT_URL);
});

test("challenger: within=<ref> of a previous document is refused (no subtree of another element); find after navigation bumps generation", { timeout: 120_000 }, async () => {
  await withClient(async (c, sessionId, page) => {
    const first = await call(c, "browser_snapshot", { sessionId });
    const cancel = (first.elements as Array<Record<string, string>>).find((e) => e.text === "Cancel")?.ref;
    await page.goto(dataUrl("<div role='tab'>Other<button>Delete everything</button></div>"));
    const scoped = await call(c, "browser_snapshot", { sessionId, within: cancel });
    assert.equal(scoped.count, 0);
    assert.equal(scoped.scope.error, "ref_stale");
    const f = await call(c, "browser_find", { sessionId, query: "delete" });
    assert.ok(f.generation > first.generation, "numbers changed meaning: generation must move");
  }, DRIFT_URL);
});

const MANY =`${Array.from({ length: 230 }, (_, i) => `<button onclick="document.title='b${i}'">b${i}</button>`).join("")}`;

test("browser_find returns the matching ref (not the whole snapshot) and the ref is actionable", { timeout: 120_000 }, async () => {
  await withClient(async (c, sessionId, page) => {
    const f = await call(c, "browser_find", { sessionId, query: "b150" });
    assert.equal(f.total, 1);
    assert.equal(f.count, 1);
    assert.equal(f.matches[0].text, "b150");
    assert.equal(typeof f.generation, "number");
    const act = await call(c, "browser_act", { sessionId, kind: "click", ref: f.matches[0].ref });
    assert.equal(act.result.ok, true);
    assert.equal(await page.title(), "b150");
  }, dataUrl(MANY));
});

test("browser_find: limit, ranking (exact before partial), no match, and a cap hit is reported", { timeout: 120_000 }, async () => {
  await withClient(async (c, sessionId) => {
    const some = await call(c, "browser_find", { sessionId, query: "b15", limit: 3 });
    assert.equal(some.total, 11);
    assert.equal(some.count, 3);
    assert.equal(some.matches[0].text, "b15", "exact name ranks first");
    const none = await call(c, "browser_find", { sessionId, query: "zzz-not-there" });
    assert.equal(none.total, 0);
    assert.deepEqual(none.matches, []);
    const beyond = await call(c, "browser_find", { sessionId, query: "b215" });
    assert.equal(beyond.total, 0);
    assert.equal(beyond.truncated, true, "the 200-element cap hid part of the page: say so");
  }, dataUrl(MANY));
});

test("browser_find by role/text on the form page; a found ref later made stale -> ref_stale", { timeout: 120_000 }, async () => {
  await withClient(async (c, sessionId, page) => {
    const f = await call(c, "browser_find", { sessionId, query: "save" });
    assert.equal(f.matches[0].text, "Save");
    const tab = await call(c, "browser_find", { sessionId, query: "tab" });
    assert.ok(tab.matches.some((m: Record<string, string>) => m.role === "tab"));
    await page.evaluate("document.querySelector('#fs button').remove()");
    const act = await call(c, "browser_act", { sessionId, kind: "click", ref: f.matches[0].ref });
    assert.equal(act.result.error, "ref_stale");
  }, dataUrl(FORM));
});
