/**
 * Local site + session helpers for the `browser_verify` tests: real pages on
 * 127.0.0.1 (good, changed, 404 subresource, console error, noisy, uncaught
 * exception, flaky API, real blocked interstitial); third-party requests are aborted.
 */
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { withClient } from "../../integration/helpers/safe-actions-harness.js";
import { REAL_BLOCKED } from "./block-pages.js";
import type { FixtureRoute, FixtureServer } from "./fixture-server.js";

const GOOD = "<title>Good</title><h1>Welcome</h1><button id='cta'>Buy</button><div id='hidden' style='display:none'>secret</div>";
const html = (body: string): FixtureRoute => ({ status: 200, body });

const ROUTES: Record<string, FixtureRoute> = {
  "/good": html(GOOD),
  "/changed": html(`${GOOD}<p style='background:#e11;color:#fff;padding:40px'>Brand new banner</p>`),
  "/bad-img": html("<h1>Welcome</h1><img src='/missing.png' alt='x'>"),
  "/console-error": html("<h1>Welcome</h1><script>console.error('boom-from-page')</script>"),
  "/noisy": html("<h1>Noisy</h1><script>console.error('e1');fetch('/gone')</script>"),
  "/throw": html("<h1>Throws</h1><script>setTimeout(()=>{throw new Error('uncaught-x')},20)</script>"),
  "/flaky-page": html("<h1>Flaky</h1><script>fetch('/flaky').then(()=>fetch('/flaky'))</script>"),
  "/many": html("<h1>Many</h1><script>fetch('/gone-first').then(async()=>{for(let i=0;i<300;i++)await fetch('/ok.json?i='+i)})</script>"),
  "/netfail": html("<h1>Net</h1><img src='http://127.0.0.1:1/x.png' alt='x'>"),
  "/redir": { status: 302, headers: { location: "/good" }, body: "" },
  "/ok.json": { status: 200, body: "{}", contentType: "application/json" },
  "/cf-moment": REAL_BLOCKED["/cf-moment"]!.route,
};

/** Start the fixture site; `/flaky` answers 500 the first time and 200 afterwards. */
export function startSite(): FixtureServer {
  const hits = new Map<string, number>();
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const path = new URL(req.url).pathname;
      const n = (hits.get(path) ?? 0) + 1;
      hits.set(path, n);
      if (path === "/flaky") return new Response("{}", { status: n === 1 ? 500 : 200 });
      const r = ROUTES[path];
      if (!r) return new Response("", { status: 404 });
      const headers = new Headers(r.headers ?? {});
      headers.set("content-type", r.contentType ?? "text/html; charset=utf-8");
      return new Response(r.body, { status: r.status, headers });
    },
  });
  return { origin: `http://127.0.0.1:${server.port}`, hits, stop: () => void server.stop(true) };
}

/** A fresh real directory (macOS tmpdir is behind a symlink). */
export const tmpDir = (): string => join(realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "verify-"))));

/** Run `fn` with a session (third-party requests aborted) opened on about:blank. */
export function inSession(fn: (c: Client, sessionId: string) => Promise<void>, engine = "patchright"): Promise<void> {
  return withClient(
    async (c, id, page) => {
      await page.context().route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
      await fn(c, id);
    },
    "about:blank",
    { engine },
  );
}
