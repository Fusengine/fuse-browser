/**
 * Local fixture HTTP server for public-entry-point tests: serves canned
 * status/header/body triples on 127.0.0.1 so the REAL fetch pipeline
 * (impit → fetchFast → resolve → render) runs against real response headers.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** One canned HTTP response. */
export interface FixtureRoute {
  status: number;
  headers?: Record<string, string>;
  body: string;
  /** Defaults to `text/html; charset=utf-8`. */
  contentType?: string;
}

/** A captured real response (see `tests/fixtures/blocked/*.json`). */
interface CapturedFixture {
  url: string;
  status: number;
  headers: Record<string, string>;
  html: string;
}

const FIXTURES = fileURLToPath(new URL("../../fixtures/", import.meta.url));

/** Read a captured blocked response fixture by file stem. */
export function loadBlocked(name: string): CapturedFixture {
  return JSON.parse(readFileSync(`${FIXTURES}blocked/${name}.json`, "utf-8")) as CapturedFixture;
}

/** Turn a captured fixture into a servable route (status + headers + body verbatim). */
export function routeFromCaptured(name: string): FixtureRoute {
  const f = loadBlocked(name);
  const { "content-type": contentType, ...headers } = f.headers;
  return { status: f.status, headers, body: f.html, contentType };
}

/** Read a plain HTML fixture from `tests/fixtures/`. */
export function loadHtml(file: string): string {
  return readFileSync(`${FIXTURES}${file}`, "utf-8");
}

/** A running fixture server. */
export interface FixtureServer {
  origin: string;
  /** Number of requests served per path. */
  hits: Map<string, number>;
  stop(): void;
}

/**
 * Serve `routes` (keyed by pathname) on a random loopback port. Unknown paths
 * (e.g. `/robots.txt`) answer 404 with an empty body.
 */
export function serveFixtures(routes: Record<string, FixtureRoute>): FixtureServer {
  const hits = new Map<string, number>();
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const path = new URL(req.url).pathname;
      hits.set(path, (hits.get(path) ?? 0) + 1);
      const r = routes[path];
      if (!r) return new Response("", { status: 404 });
      const headers = new Headers(r.headers ?? {});
      headers.set("content-type", r.contentType ?? "text/html; charset=utf-8");
      return new Response(r.body, { status: r.status, headers });
    },
  });
  return { origin: `http://127.0.0.1:${server.port}`, hits, stop: () => void server.stop(true) };
}
