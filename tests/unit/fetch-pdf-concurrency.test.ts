import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Worker } from "node:worker_threads";
import { fetchBatch } from "../../src/agent/fetch-batch.js";
import { pdfToText } from "../../src/net/pdf-extract.js";
import { type DocServer, serveDocs } from "./helpers/docs-server.js";
import { flateBombPdf, manyPagesPdf } from "./helpers/pdf-bomb.js";

// Gate-1 defect: the PDF memory guard measures process RSS growth, so extractions
// running at the same time were charged to each other — under Bun a legitimate PDF
// next to a bomb ended in `memory` (3/3 runs), and 8 legitimate PDFs in parallel all
// did at the default cap. PDF extraction is now serialized process-wide so the growth
// belongs to exactly one worker.

// A 400-page legitimate PDF: its extraction lasts long enough to overlap other work.
const PAGES = 400;
const GOOD = manyPagesPdf(PAGES);
const GOODS = ["/g1.pdf", "/g2.pdf", "/g3.pdf", "/g4.pdf"];
const BATCH_TIMEOUT_MS = 40_000; // a bomb can take several seconds to be caught on a warm process

let server: DocServer;
beforeAll(() => {
  const routes: Parameters<typeof serveDocs>[0] = { "/bomb.pdf": { body: flateBombPdf(150), contentType: "application/pdf" } };
  for (const p of GOODS) routes[p] = { body: GOOD, contentType: "application/pdf" };
  server = serveDocs(routes);
});
afterAll(() => server.stop());

describe("PDF extractions are serialized", () => {
  test("never more than one extraction worker is alive at a time (deterministic)", async () => {
    let alive = 0;
    let maxAlive = 0;
    // A real, trivially short-lived worker per extraction; `alive` spans spawn → exit.
    const counting = (): Worker => {
      const w = new Worker("setTimeout(() => {}, 40);", { eval: true });
      alive++;
      maxAlive = Math.max(maxAlive, alive);
      w.once("exit", () => alive--);
      return w;
    };
    const results = await Promise.all(Array.from({ length: 6 }, () => pdfToText(GOOD, false, 5_000, counting)));
    expect(results.every((r) => r.error === "unreadable")).toBe(true); // the stub never replies; each is released by `exit`
    expect(maxAlive).toBe(1);
  });
});

describe("browser_fetch_batch: PDF extractions do not charge each other's memory", () => {
  test(
    "a bomb in the batch never turns a legitimate PDF into `memory`",
    async () => {
      const urls = ["/bomb.pdf", ...GOODS].map((p) => `${server.origin}${p}`);
      const items = (await fetchBatch(urls, { concurrency: 8 })) as Array<Record<string, unknown>>;
      // The bomb's own verdict is the memory guard's business (fetch-pdf-memory.test.ts): on a warm
      // process its RSS growth can hide in retained pages. What this test pins is the collateral.
      for (const good of items.slice(1)) {
        expect(good.pdfError).toBeUndefined();
        expect(good.pageCount).toBe(PAGES);
        expect(String(good.text)).toContain("Legitimate page 1 body");
      }
    },
    BATCH_TIMEOUT_MS,
  );

  test("eight legitimate PDFs at concurrency 8 all extract (none is a false `memory`)", async () => {
    const urls = Array.from({ length: 8 }, (_, i) => `${server.origin}${GOODS[i % GOODS.length]}?n=${i}`);
    const items = (await fetchBatch(urls, { concurrency: 8 })) as Array<Record<string, unknown>>; // default cap
    expect(items.map((i) => i.pdfError)).toEqual(Array(8).fill(undefined));
    expect(items.every((i) => i.pageCount === PAGES)).toBe(true);
  });
});
