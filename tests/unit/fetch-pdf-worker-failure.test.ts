import { describe, expect, test } from "bun:test";
import { Worker } from "node:worker_threads";
import { pdfToText } from "../../src/net/pdf-extract.js";
import { loadDocFixture } from "./helpers/docs-server.js";

// Worker failure modes the queue must survive: a worker that dies without a
// message or an error, and a worker that cannot even be created. Both must
// resolve `unreadable` at once (never reject, never hold the queue for the 20 s
// budget). The optional 4th argument of `pdfToText` is the worker factory seam.

const GOOD = loadDocFixture("two-page.pdf");
const BUDGET_MS = 600_000; // far larger than any test timeout: the clock can never be what releases the queue

describe("PDF worker that exits without a reply", () => {
  test.each([
    ["exit code 0 (empty module)", "export {};"],
    ["exit code 1 (process.exit)", "process.exit(1);"],
  ])("%s → unreadable immediately, and the next queued PDF still extracts", async (_name, source) => {
    const dying = () => new Worker(source, { eval: true });
    const [dead, next] = await Promise.all([pdfToText(GOOD, false, BUDGET_MS, dying), pdfToText(GOOD, false)]);
    expect(dead.error).toBe("unreadable");
    expect(dead.text).toBe("");
    // Queued behind the dead one and released by `exit`: with a 10-minute budget on the dead worker,
    // this only completes (inside the test's own timeout) if the queue was released by the exit, not the clock.
    expect(next.pageCount).toBe(2);
  });
});

describe("worker that cannot be created", () => {
  test("a throwing factory (Worker constructor / import.meta.resolve) resolves unreadable, never rejects", async () => {
    const boom = () => {
      throw new Error("cannot spawn");
    };
    const out = await pdfToText(GOOD, false, BUDGET_MS, boom);
    expect(out).toEqual({ text: "", error: "unreadable" });
    const next = await pdfToText(GOOD, false); // the queue is not wedged
    expect(next.pageCount).toBe(2);
  });
});
