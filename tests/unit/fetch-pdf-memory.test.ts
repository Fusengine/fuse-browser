import { describe, expect, test } from "bun:test";
import { fetchAndRender } from "../../src/agent/fetch-orchestrate.js";
import { pdfMaxMb, pdfToText } from "../../src/net/pdf-extract.js";
import { loadDocFixture, serveDocs } from "./helpers/docs-server.js";
import { flateBombPdf, withEnv } from "./helpers/pdf-bomb.js";

// Memory cap of the PDF worker. Measured (scratchpad worker-probe2.mjs): the real
// 15-page arXiv paper peaks at ~100 MB RSS delta (heap < 64 MB, passes with a 64 MB
// heap limit) on Node 26 and Bun 1.4.4; a 150 MB-inflating bomb reaches ~410-930 MB.
//
// Timing (full `bun test tests/unit`, 4 runs): the guard fires in ~80 ms in a fresh
// process but took 2.4-3.7 s when the process already holds retained freed pages
// (RSS grows more slowly there — the delta is measured from the worker's start), so
// the bomb tests lasted up to 4.7 s and tripped bun's 5 s default. The explicit
// per-test timeout is ~3x the worst measured duration; the extraction budget sits
// well above the worst detection latency so the MEMORY guard, not the clock, ends it.
const BOMB_TEST_TIMEOUT_MS = 15_000;
const BOMB_BUDGET_MS = 12_000;
// 64 MB, not 128: on a warm process the bomb's RSS growth can hide in retained pages
// (a 150 MB bomb once finished under a 256 MB cap); a normal PDF peaks under ~50 MB.
const BOMB_CAP_MB = "64";

const GOOD = loadDocFixture("two-page.pdf");

describe("PDF worker memory cap (FUSE_PDF_MAX_MB)", () => {
  test(
    "a bomb is stopped by the memory cap before the time budget, and the process survives",
    async () => {
      const bomb = flateBombPdf(150);
      const out = await withEnv("FUSE_PDF_MAX_MB", BOMB_CAP_MB, () => pdfToText(bomb, false, BOMB_BUDGET_MS));
      expect(out.error).toBe("memory"); // not "timeout": the clock did not end it
      expect(out.text).toBe("");
      expect(out.pageCount).toBeUndefined();
      const after = await pdfToText(GOOD, false); // parent alive, next extraction unaffected
      expect(after.pageCount).toBe(2);
    },
    BOMB_TEST_TIMEOUT_MS,
  );

  test(
    "through browser_fetch: pdfError:memory, no garbage text",
    async () => {
      const s = serveDocs({ "/bomb.pdf": { body: flateBombPdf(150), contentType: "application/pdf" } });
      try {
        const { rendered } = await withEnv("FUSE_PDF_MAX_MB", BOMB_CAP_MB, () => fetchAndRender(`${s.origin}/bomb.pdf`));
        expect(rendered.pdfError).toBe("memory");
        expect(rendered.text).toBe("");
      } finally {
        s.stop();
      }
    },
    BOMB_TEST_TIMEOUT_MS,
  );

  test("a normal PDF is unaffected by a tight cap", async () => {
    const out = await withEnv("FUSE_PDF_MAX_MB", "128", () => pdfToText(GOOD, false));
    expect(out.error).toBeUndefined();
    expect(out.pageCount).toBe(2);
  });

  test("the cap is a DELTA from the worker's start: a process already holding far more than the cap is not a false 'memory'", async () => {
    const held = Buffer.alloc(400 * 1_048_576, 1); // 400 MB committed in this process, 3x the 128 MB cap
    const out = await withEnv("FUSE_PDF_MAX_MB", "128", () => pdfToText(GOOD, false));
    expect(held.length).toBeGreaterThan(0);
    expect(out.error).toBeUndefined();
    expect(out.pageCount).toBe(2);
  });

  test("pdfMaxMb: default 256, env override, junk falls back to the default", async () => {
    const prev = process.env.FUSE_PDF_MAX_MB;
    delete process.env.FUSE_PDF_MAX_MB;
    expect(pdfMaxMb()).toBe(256);
    for (const [v, want] of [["512", 512], ["0", 256], ["-5", 256], ["abc", 256], ["", 256]] as const) {
      expect([v, await withEnv("FUSE_PDF_MAX_MB", v, async () => pdfMaxMb())]).toEqual([v, want]);
    }
    if (prev !== undefined) process.env.FUSE_PDF_MAX_MB = prev;
  });
});
