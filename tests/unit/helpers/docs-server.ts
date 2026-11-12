/**
 * Local fixture server for the docs-reading tests (PDF + site-markdown ladder).
 * Unlike `fixture-server.ts` it serves binary bodies and lets a route compute
 * its response from the request (e.g. `Accept` content negotiation), and it
 * records the request headers per path so tests can assert what was sent.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** One canned response; `body` may be binary. */
export interface DocRoute {
  status?: number;
  headers?: Record<string, string>;
  body: string | Uint8Array;
  contentType?: string;
}

/** A route, or a function choosing the route from the request. */
export type DocHandler = DocRoute | ((req: Request) => DocRoute);

/** A running docs fixture server. */
export interface DocServer {
  origin: string;
  /** Requests served per path. */
  hits: Map<string, number>;
  /** `Accept` header received on the most recent request per path. */
  accepts: Map<string, string>;
  stop(): void;
}

/** Read a binary fixture from `tests/fixtures/docs-reading/`. */
export function loadDocFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(`../../fixtures/docs-reading/${name}`, import.meta.url))));
}

/** Serve `routes` (keyed by pathname) on a random loopback port; unknown paths answer 404. */
export function serveDocs(routes: Record<string, DocHandler>): DocServer {
  const hits = new Map<string, number>();
  const accepts = new Map<string, string>();
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const path = new URL(req.url).pathname;
      hits.set(path, (hits.get(path) ?? 0) + 1);
      accepts.set(path, req.headers.get("accept") ?? "");
      const h = routes[path];
      if (!h) return new Response("", { status: 404 });
      const r = typeof h === "function" ? h(req) : h;
      const headers = new Headers(r.headers ?? {});
      headers.set("content-type", r.contentType ?? "text/html; charset=utf-8");
      return new Response(r.body as BodyInit, { status: r.status ?? 200, headers });
    },
  });
  return { origin: `http://127.0.0.1:${server.port}`, hits, accepts, stop: () => void server.stop(true) };
}
