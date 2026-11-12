/**
 * Shared harness for the safe-actions integration tests: an in-memory MCP
 * client over `createServer()` with a real headless Chromium session.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import assert from "node:assert/strict";
import { createServer } from "../../../src/server/server.js";

import type { Page } from "playwright";

/** Loosely typed structuredContent of a tool result (assertions narrow it). */
// biome-ignore lint/suspicious/noExplicitAny: test-only access to arbitrary tool output
export type Out = Record<string, any>;

/** Page with three buttons (Cancel, Delete account, Save), a click log and a no-op button. */
const PAGE =
  "<div id='bar'><button id='A'>Cancel</button> <button id='B'>Delete account</button> <button id='C'>Save</button></div>" +
  "<div id='log'>LOG:</div><button id='noop'>Noop</button>" +
  "<script>document.addEventListener('click',e=>{if(e.target.id!=='noop'&&e.target.tagName==='BUTTON')" +
  "document.getElementById('log').textContent+=' ['+e.target.textContent+']'})</script>";

/** Encode HTML as a data URL. */
export const dataUrl = (html: string): string => `data:text/html,${encodeURIComponent(html)}`;

/** The default three-button page. */
export const DRIFT_URL = dataUrl(PAGE);

/** Open a session on `pageUrl`, run `fn`, always close. */
export async function withClient(
  fn: (c: Client, sessionId: string, page: Page) => Promise<void>,
  pageUrl = DRIFT_URL,
  openArgs: Record<string, unknown> = {},
): Promise<void> {
  const { server, sessions } = createServer();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(st), client.connect(ct)]);
  try {
    const open = await client.callTool({ name: "browser_open", arguments: { headless: true, engine: "patchright", ...openArgs } });
    const { sessionId } = open.structuredContent as { sessionId: string };
    try {
      await client.callTool({ name: "browser_navigate", arguments: { sessionId, url: pageUrl } });
      await fn(client, sessionId, sessions.get(sessionId).page);
    } finally {
      await client.callTool({ name: "browser_close", arguments: { sessionId } });
    }
  } finally {
    await client.close();
  }
}

/** Call a tool; returns structuredContent or an error descriptor. */
export async function call(c: Client, name: string, args: Record<string, unknown>): Promise<Out> {
  const r = await c.callTool({ name, arguments: args });
  return (r.structuredContent ?? { isError: r.isError, content: r.content }) as Out;
}

/** Text of the click log. */
export const logOf = (page: Page): Promise<string> => page.locator("#log").innerText();

/** Snapshot and return the ref of the element with this text. */
export async function snapRef(c: Client, sessionId: string, text: string): Promise<string> {
  const snap = await call(c, "browser_snapshot", { sessionId });
  const el = (snap.elements as Out[]).find((e) => e.text === text);
  assert.ok(el?.ref !== undefined, `${text} in snapshot`);
  return el.ref as string;
}

/** Insert a "Promo" button before or after the three buttons. */
export const insertAt = async (page: Page, where: "before" | "after"): Promise<void> => {
  await page.evaluate(
    `(() => { const b = document.createElement("button"); b.textContent = "Promo"; const bar = document.getElementById("bar");` +
      (where === "before" ? " bar.insertBefore(b, bar.firstChild);" : " bar.appendChild(b);") +
      " })()",
  );
};
