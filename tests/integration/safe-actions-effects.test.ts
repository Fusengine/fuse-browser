/**
 * Effect report (#4), snapshot `truncated` (#7) and the opt-in confirmation
 * pause (#12) through the real MCP tools. Runs under Node.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { call, dataUrl, logOf, snapRef, withClient } from "./helpers/safe-actions-harness.js";

test("effect report: a no-op click is visible, an effective click is too; ok keeps its meaning", { timeout: 120_000 }, async () => {
  await withClient(async (c, sessionId) => {
    const noop = await call(c, "browser_click", { sessionId, target: "Noop" });
    assert.equal(noop.result.ok, true);
    assert.equal(noop.effect.domChanged, false);
    assert.equal(noop.effect.urlChanged, false);
    const real = await call(c, "browser_click", { sessionId, target: "Save" });
    assert.equal(real.effect.domChanged, true);
    assert.equal(real.effect.urlChanged, false);
  });
});

test("effect report on browser_act (ref), same shape as the action tools; no settle on scroll/wait", { timeout: 120_000 }, async () => {
  await withClient(async (c, sessionId) => {
    const noop = await call(c, "browser_act", { sessionId, kind: "click", ref: await snapRef(c, sessionId, "Noop") });
    assert.equal(noop.result.ok, true);
    assert.equal(noop.effect.domChanged, false);
    assert.equal(noop.effect.urlChanged, false);
    const real = await call(c, "browser_act", { sessionId, kind: "click", ref: await snapRef(c, sessionId, "Save") });
    assert.equal(real.effect.domChanged, true);
    assert.equal((await call(c, "browser_scroll", { sessionId })).effect.settleMs, 0);
    assert.equal((await call(c, "browser_wait", { sessionId, ms: 10 })).effect.settleMs, 0);
  });
});

const SENS =
  "<meta charset='utf-8'><button id='u'>Unsubscribe</button><button id='s'>Subscribe</button><button id='rf'>Remove filter</button>" +
  "<button id='ra'>Remove account</button><button id='ef'>Effacer le compte</button><button id='se'>Se désabonner</button>" +
  "<script>document.addEventListener('click',e=>{document.title+='['+e.target.id+']'})</script>";

test("sensitive vocab: Unsubscribe/Remove account/Effacer le compte pause; Subscribe/Remove filter do not", { timeout: 120_000 }, async () => {
  await withClient(async (c, sessionId, page) => {
    for (const [text, paused] of [["Unsubscribe", true], ["Remove account", true], ["Effacer le compte", true], ["Se désabonner", true], ["Subscribe", false], ["Remove filter", false]] as const) {
      const ref = await snapRef(c, sessionId, text);
      const r = await call(c, "browser_act", { sessionId, kind: "click", ref, confirmSensitive: true });
      assert.equal(r.result.error === "confirmation_required", paused, `${text}: ${JSON.stringify(r.result)}`);
    }
    assert.equal(await page.title(), "[s][rf]");
  }, dataUrl(SENS));
});

test("sensitive pause also covers Enter/Space on a focused sensitive control (browser_press)", { timeout: 120_000 }, async () => {
  const html = "<button id='d' onclick='document.title+=\"D\"'>Delete account</button><button id='k' onclick='document.title+=\"K\"'>Save</button>";
  await withClient(async (c, sessionId, page) => {
    await page.evaluate("document.getElementById('d').focus()");
    const ask = await call(c, "browser_press", { sessionId, key: "Enter", confirmSensitive: true });
    assert.equal(ask.result.error, "confirmation_required");
    assert.equal(await page.title(), "");
    const yes = await call(c, "browser_press", { sessionId, key: "Enter", confirmSensitive: true, confirmed: true });
    assert.equal(yes.result.ok, true);
    assert.equal(await page.title(), "D");
    await page.evaluate("document.getElementById('k').focus()");
    const safe = await call(c, "browser_press", { sessionId, key: " ", confirmSensitive: true });
    assert.equal(safe.result.ok, true);
    const off = await call(c, "browser_press", { sessionId, key: "Enter" });
    assert.equal(off.result.ok, true, "default off");
  }, dataUrl(html));
});

test("effect report: navigation by click flags urlChanged", { timeout: 120_000 }, async () => {
  const srv = createServer((req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(req.url === "/two" ? "<p>two</p>" : "<a href='/two'>Go</a>");
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}/`;
    await withClient(async (c, sessionId) => {
      const r = await call(c, "browser_click", { sessionId, target: "Go" });
      assert.equal(r.effect.urlChanged, true);
      assert.equal(r.effect.domChanged, true);
    }, base);
  } finally {
    srv.close();
  }
});

test("snapshot truncated flag: page over the 200-per-frame cap, and a small page", { timeout: 120_000 }, async () => {
  const many = Array.from({ length: 230 }, (_, i) => `<button>b${i}</button>`).join("");
  await withClient(async (c, sessionId) => {
    const snap = await call(c, "browser_snapshot", { sessionId });
    assert.equal(snap.count, 200);
    assert.equal(snap.truncated, true);
    assert.equal(snap.dropped, 30);
    assert.ok(String(snap.hint).includes("truncated"));
  }, dataUrl(many));
  await withClient(async (c, sessionId) => {
    const snap = await call(c, "browser_snapshot", { sessionId });
    assert.equal(snap.truncated, false);
    assert.equal(snap.dropped, 0);
  });
});

test("confirmation pause: opt-in only, both paths", { timeout: 120_000 }, async () => {
  await withClient(async (c, sessionId, page) => {
    const ref = await snapRef(c, sessionId, "Delete account");
    const off = await call(c, "browser_act", { sessionId, kind: "click", ref });
    assert.equal(off.result.ok, true, "default off: no behaviour change");
    assert.equal(await logOf(page), "LOG: [Delete account]");
    await page.evaluate("document.getElementById('log').textContent = 'LOG:'");

    const ask = await call(c, "browser_act", { sessionId, kind: "click", ref, confirmSensitive: true });
    assert.equal(ask.result.ok, false);
    assert.equal(ask.result.error, "confirmation_required");
    assert.equal(ask.result.element.text, "Delete account");
    assert.equal(await logOf(page), "LOG:");

    const yes = await call(c, "browser_act", { sessionId, kind: "click", ref, confirmSensitive: true, confirmed: true });
    assert.equal(yes.result.ok, true);
    assert.equal(await logOf(page), "LOG: [Delete account]");

    const save = await snapRef(c, sessionId, "Save");
    assert.equal((await call(c, "browser_act", { sessionId, kind: "click", ref: save, confirmSensitive: true })).result.ok, true);
  });
});

test("confirmation pause on browser_click by text, opt-in", { timeout: 120_000 }, async () => {
  await withClient(async (c, sessionId, page) => {
    const ask = await call(c, "browser_click", { sessionId, target: "Delete account", confirmSensitive: true });
    assert.equal(ask.result.error, "confirmation_required");
    assert.equal(await logOf(page), "LOG:");
    const yes = await call(c, "browser_click", { sessionId, target: "Delete account", confirmSensitive: true, confirmed: true });
    assert.equal(yes.result.ok, true);
  });
});
