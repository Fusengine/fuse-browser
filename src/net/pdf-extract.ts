/**
 * PDF → readable text for the fast fetch path. `unpdf` (pdf.js serverless
 * build, pure JS, no native dependency) extracts the text layer per page; pages
 * are joined behind `<!-- page N -->` markers so a reader can cite a page.
 * Scanned PDFs have no text layer: they yield an empty body, not an OCR pass.
 *
 * Extraction runs in a worker thread with a wall-clock limit and a memory cap
 * (`FUSE_PDF_MAX_MB`): a small file can inflate to hundreds of MB (a Flate
 * "bomb"), and pdf.js would otherwise pin the server's main thread — stalling
 * every other tool call — and its memory.
 * @module net/pdf-extract
 */
import { Worker } from "node:worker_threads";
import type { PdfText } from "../interfaces/pdf.js";

/** Wall-clock budget for extracting one PDF (a 15-page paper takes < 1 s). */
export const PDF_TIMEOUT_MS = 20_000;

/** The `%PDF-` file signature. */
const MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];

/**
 * True when the response is a PDF: `application/pdf` content-type, or the
 * `%PDF-` signature at the start of a body not declared as text (servers often
 * label downloads `application/octet-stream`; a `text/*` body that merely
 * starts with those bytes stays text).
 *
 * @param contentType - Lowercased response content-type.
 * @param head - First bytes of the body.
 */
export function isPdf(contentType: string, head: Uint8Array): boolean {
  if (contentType.startsWith("application/pdf")) return true;
  return !contentType.startsWith("text/") && MAGIC.every((b, i) => head[i] === b);
}

/**
 * Worker body (ESM). `verbosity: 0` (errors only): pdf.js logs warnings through
 * the console, which on the MCP stdio server must never reach stdout.
 */
const WORKER_SOURCE = `
import { parentPort, workerData } from "node:worker_threads";
try {
  const { getDocumentProxy, extractText } = await import(workerData.unpdf);
  const pdf = await getDocumentProxy(new Uint8Array(workerData.bytes), { verbosity: 0 });
  const { totalPages, text } = await extractText(pdf);
  parentPort.postMessage({ ok: true, totalPages, text });
} catch {
  parentPort.postMessage({ ok: false });
}
`;

/** Message posted by the worker. */
type WorkerReply = { ok: true; totalPages: number; text: string[] } | { ok: false };

/** Default memory cap in MB: ~2.5x the ~100 MB RSS the real 15-page arXiv paper peaks at. */
const DEFAULT_PDF_MAX_MB = 256;

/** How often the parent samples its RSS while a worker runs (the worker itself may be pinned). */
const WATCHDOG_MS = 25;

/**
 * Memory cap of one PDF extraction in MB: `FUSE_PDF_MAX_MB` (a positive number),
 * default 256. Enforced as the worker's V8 old-generation limit (Node honours
 * `resourceLimits`; Bun ignores them) AND, portably, as a ceiling on how far the
 * process RSS may grow while the worker runs.
 */
export function pdfMaxMb(): number {
  const n = Number(process.env.FUSE_PDF_MAX_MB);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PDF_MAX_MB;
}

/** Tail of the process-wide extraction queue (see {@link serialized}). */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Run `task` after every earlier PDF extraction has settled (a queue of 1). The
 * memory guard measures process-wide RSS growth, so two workers alive at once
 * are charged to each other: 8 concurrent legitimate PDFs all hit `memory` at the
 * default cap, and a bomb condemned the legitimate PDFs beside it. One worker at a
 * time makes the growth belong to exactly one extraction. Only PDF extraction
 * waits — HTML and other fetches are unaffected — and a task's time budget starts
 * when it starts, not when it is queued.
 */
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

/** Creates the extraction worker for a PDF copy under a memory cap in MB (injectable for tests). */
export type PdfWorkerFactory = (copy: ArrayBuffer, maxMb: number) => Worker;

/** The real worker: `unpdf` text extraction, heap-capped where the runtime honours `resourceLimits`. */
export const spawnPdfWorker: PdfWorkerFactory = (copy, maxMb) =>
  new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: { unpdf: import.meta.resolve("unpdf"), bytes: copy },
    transferList: [copy],
    resourceLimits: { maxOldGenerationSizeMb: maxMb },
  });

/**
 * Run the extraction in a worker; settles with the reply, `"timeout"` after
 * `timeoutMs`, `"memory"` past the cap, or `{ ok: false }` when the worker cannot
 * be created or exits without replying (so the queue is never held for the budget).
 */
function extractInWorker(bytes: Uint8Array, timeoutMs: number, spawn: PdfWorkerFactory): Promise<WorkerReply | "timeout" | "memory"> {
  return new Promise((resolve) => {
    const copy = new Uint8Array(bytes).buffer; // the worker owns this copy; the caller's bytes stay intact
    const maxMb = pdfMaxMb();
    const baseRss = process.memoryUsage().rss;
    let worker: Worker;
    try {
      worker = spawn(copy, maxMb);
    } catch {
      resolve({ ok: false });
      return;
    }
    const done = (reply: WorkerReply | "timeout" | "memory"): void => {
      clearTimeout(timer);
      clearInterval(watchdog);
      void worker.terminate();
      resolve(reply);
    };
    const timer = setTimeout(() => done("timeout"), timeoutMs);
    const watchdog = setInterval(() => {
      if (process.memoryUsage().rss - baseRss > maxMb * 1_048_576) done("memory");
    }, WATCHDOG_MS);
    worker.once("message", (m: WorkerReply) => done(m));
    worker.once("error", (e: NodeJS.ErrnoException) => done(e.code === "ERR_WORKER_OUT_OF_MEMORY" ? "memory" : { ok: false }));
    worker.once("exit", () => done({ ok: false })); // died without a message or error: release the queue now
  });
}

/**
 * Extract the text of a PDF with `<!-- page N -->` markers.
 *
 * @param bytes - The complete PDF file.
 * @param truncated - True when the download hit the byte cap: a cut file has no
 *   cross-reference table and is refused (`too_large`) rather than guessed at.
 * @param timeoutMs - Extraction budget (default {@link PDF_TIMEOUT_MS}).
 * @param spawn - Worker factory (default: the real `unpdf` worker; a seam for tests).
 * @returns The text and page count, or an `error` code (never throws; a worker
 *   that cannot start or dies silently is `unreadable`).
 */
export async function pdfToText(bytes: Uint8Array, truncated: boolean, timeoutMs: number = PDF_TIMEOUT_MS, spawn: PdfWorkerFactory = spawnPdfWorker): Promise<PdfText> {
  if (truncated) return { text: "", error: "too_large" };
  const reply = await serialized(() => extractInWorker(bytes, timeoutMs, spawn));
  if (reply === "timeout" || reply === "memory") return { text: "", error: reply };
  if (!reply.ok) return { text: "", error: "unreadable" };
  const body = reply.text.map((page, i) => `<!-- page ${i + 1} -->\n${page.trim()}`).join("\n\n");
  return { text: body, pageCount: reply.totalPages };
}
