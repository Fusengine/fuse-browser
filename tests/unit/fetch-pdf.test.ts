import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type PdfWorkerFactory, pdfToText, spawnPdfWorker } from "../../src/net/pdf-extract.js";
import { crawl } from "../../src/agent/crawl.js";
import { fetchBatch } from "../../src/agent/fetch-batch.js";
import { fetchAndRender } from "../../src/agent/fetch-orchestrate.js";
import { article } from "./helpers/block-pages.js";
import { type DocServer, loadDocFixture, serveDocs } from "./helpers/docs-server.js";
import { flateBombPdf, withEnv } from "./helpers/pdf-bomb.js";

// Public-entry-point tests: the REAL fast path (impit → fetchFast → resolve →
// render) runs against a local server. Before this change a PDF response came
// back as raw `%PDF-1.5 ... stream` bytes decoded as text (measured on
// https://arxiv.org/pdf/1706.03762).

const PDF = loadDocFixture("two-page.pdf");
const TEN_MB = 10_485_760;
const tooBig = new Uint8Array(TEN_MB + 1024);
tooBig.set(new TextEncoder().encode("%PDF-1.4\n"));

let server: DocServer;
beforeAll(() => {
  server = serveDocs({
    "/doc.pdf": { body: PDF, contentType: "application/pdf" },
    "/download": { body: PDF, contentType: "application/octet-stream" }, // magic bytes only
    "/big.pdf": { body: tooBig, contentType: "application/pdf" },
    "/corrupt.pdf": { body: "%PDF-1.4\nthis is not a pdf at all", contentType: "application/pdf" },
    "/page": { body: article("Plain page") },
    "/hub.html": { body: article("Hub", '<a href="/doc.pdf">the paper</a>') },
  });
});
afterAll(() => server.stop());

describe("browser_fetch — PDF responses are read as text", () => {
  test("application/pdf → readable text with page markers and pageCount", async () => {
    const { rendered } = await fetchAndRender(`${server.origin}/doc.pdf`);
    expect(rendered.status).toBe(200);
    expect(rendered.text).not.toContain("%PDF");
    expect(rendered.text).toContain("<!-- page 1 -->");
    expect(rendered.text).toContain("Alpha paragraph about the transformer");
    expect(rendered.text).toContain("<!-- page 2 -->");
    expect(rendered.text).toContain("Beta paragraph about attention");
    expect(rendered.text.indexOf("page 1")).toBeLessThan(rendered.text.indexOf("Alpha"));
    expect(rendered.text.indexOf("Alpha")).toBeLessThan(rendered.text.indexOf("page 2"));
    expect(rendered.pageCount).toBe(2);
    expect(rendered.pdfError).toBeUndefined();
    expect(rendered.escalated).toBe(false);
  });

  test("%PDF- magic bytes are enough when the content-type is generic", async () => {
    const { rendered } = await fetchAndRender(`${server.origin}/download`);
    expect(rendered.text).toContain("Alpha paragraph");
    expect(rendered.pageCount).toBe(2);
  });

  test("maxChars truncates the text, pageCount still reports the whole document", async () => {
    const { rendered } = await fetchAndRender(`${server.origin}/doc.pdf`, { maxChars: 40 });
    expect(rendered.text.length).toBeLessThanOrEqual(40);
    expect(rendered.pageCount).toBe(2);
  });

  test("a PDF over the 10 MB download cap is refused with pdfError:too_large, no garbage text", async () => {
    const { rendered } = await fetchAndRender(`${server.origin}/big.pdf`);
    expect(rendered.pdfError).toBe("too_large");
    expect(rendered.text).not.toContain("%PDF");
    expect(rendered.pageCount).toBeUndefined();
  });

  test("a corrupt PDF reports pdfError:unreadable instead of throwing", async () => {
    const { rendered } = await fetchAndRender(`${server.origin}/corrupt.pdf`);
    expect(rendered.pdfError).toBe("unreadable");
    expect(rendered.text).not.toContain("%PDF");
  });

  test("normal pages carry no PDF field (output shape unchanged)", async () => {
    const { rendered } = await fetchAndRender(`${server.origin}/page`);
    expect(Object.keys(rendered).sort()).toEqual(["escalated", "extraction", "format", "status", "text", "url", "wordCount"]);
  });
});

describe("PDF extraction is bounded (decompression bomb)", () => {
  test("a small PDF that inflates to ~150 MB is cut off by the extraction budget, not left running", async () => {
    const bomb = flateBombPdf(150);
    expect(bomb.length).toBeLessThan(1_000_000);
    // memory cap lifted so the wall-clock budget is what stops it (memory cap: fetch-pdf-memory.test.ts)
    const out = await withEnv("FUSE_PDF_MAX_MB", "4096", () => pdfToText(bomb, false, 400));
    expect(out.error).toBe("timeout");
    expect(out.text).toBe("");
  });

  test("extraction runs off the main thread (a worker thread, not the server's event loop)", async () => {
    let threadId = 0;
    const spying: PdfWorkerFactory = (copy, maxMb) => {
      const w = spawnPdfWorker(copy, maxMb);
      threadId = w.threadId;
      return w;
    };
    const out = await pdfToText(PDF, false, 20_000, spying);
    expect(out.pageCount).toBe(2);
    expect(threadId).toBeGreaterThan(0); // the main thread is id 0
  });

  test("a text/plain body that merely starts with %PDF- stays text", async () => {
    const s = serveDocs({ "/note": { body: "%PDF- is the signature of a PDF file.", contentType: "text/plain" } });
    try {
      const { rendered } = await fetchAndRender(`${s.origin}/note`);
      expect(rendered.text).toBe("%PDF- is the signature of a PDF file.");
      expect(rendered.pdfError).toBeUndefined();
    } finally {
      s.stop();
    }
  });
});

describe("browser_fetch_batch and browser_crawl read PDFs too", () => {
  test("fetchBatch: PDF item has text + pageCount next to a normal page", async () => {
    const items = await fetchBatch([`${server.origin}/doc.pdf`, `${server.origin}/page`]);
    const [pdf, page] = items as Array<Record<string, unknown>>;
    expect(String(pdf?.text)).toContain("<!-- page 1 -->");
    expect(pdf?.pageCount).toBe(2);
    expect(page?.pageCount).toBeUndefined();
  });

  test("crawl: a PDF page is extracted as text; no links are followed out of it", async () => {
    const out = await crawl(`${server.origin}/doc.pdf`, { maxDepth: 2, respectRobots: false, throttleMs: 0 });
    expect(out.count).toBe(1);
    expect(out.pages[0]?.text).toContain("Alpha paragraph");
    expect(out.pages[0]?.pageCount).toBe(2);
  });

  test("crawl: a PDF linked from an HTML page is fetched and read", async () => {
    const out = await crawl(`${server.origin}/hub.html`, { maxDepth: 1, respectRobots: false, throttleMs: 0 });
    const pdf = out.pages.find((p) => p.url.endsWith("/doc.pdf"));
    expect(pdf?.text).toContain("Beta paragraph");
  });
});
