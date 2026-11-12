/**
 * Central output budget for the big-output tools. A tool owner adds three
 * things: spread {@link BUDGET_INPUT_SHAPE} into `inputSchema`, spread
 * {@link BUDGET_OUTPUT_SHAPE} into `outputSchema`, and return
 * `budgetResult(name, payload, field, args)` instead of `jsonResult(payload)`.
 *
 * Everything is opt-in. Without `maxTokens`, `offset` and `outputMode:"file"` the
 * result is exactly `jsonResult(payload)` (byte-identical). The budget applies to
 * ONE big field (a string or an array); the other fields are small metadata.
 *  - `maxTokens`: a string field is cut to at most `maxTokens * 4` UTF-8 bytes (the
 *    estimate method of `fuse-browser tools --tokens`, see {@link estimateTokens}),
 *    at a paragraph, line or word boundary. A list keeps whole items within that
 *    size, except that one item is always returned so paging makes progress.
 *    `nextOffset` (present only when cut) says where to resume; the budget never
 *    writes `truncated`, which stays the tool's own flag; text pages concatenate
 *    back to the original text exactly.
 *  - `offset`: where to start in the field (characters for a string, items for an array).
 *  - `outputMode:"file"`: see {@link offloadField}; `maxTokens`/`offset` are ignored.
 * @module server/output-budget
 */
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { offloadField } from "./output-offload.js";
import { jsonResult } from "./result.js";
import { BYTES_PER_TOKEN, estimateTokens, utf8Bytes } from "./token-estimate.js";

/** Optional input params to spread into a tool's `inputSchema`. */
export const BUDGET_INPUT_SHAPE = {
  maxTokens: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Cap the big output field to about this many tokens (estimate: UTF-8 bytes / 4). Cut at a clean boundary; when cut, nextOffset is present and says where to resume."),
  offset: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Resume position from a previous truncated result's nextOffset (characters for text, items for lists)."),
  outputMode: z
    .enum(["inline", "file"])
    .optional()
    .describe('"file" writes the full output under the output dir and returns {path, bytes, preview}; default "inline".'),
};

/** Optional output keys to spread into a tool's `outputSchema`. */
export const BUDGET_OUTPUT_SHAPE = {
  nextOffset: z.number().int().optional(),
  approxTokens: z.number().int().optional(),
  outputMode: z.literal("file").optional(),
  path: z.string().optional(),
  bytes: z.number().int().optional(),
  preview: z.string().optional(),
  outputError: z.string().optional(),
};

/** One page of a budgeted field. */
interface Page {
  value: string | unknown[];
  /** Resume position when the field was cut. */
  nextOffset?: number;
}

/**
 * UTF-16 length of the longest prefix of `text` whose UTF-8 size is <= `budget`,
 * counted code point by code point (never splits a surrogate pair, and leaves the
 * source characters, including a lone surrogate or a literal U+FFFD, untouched).
 */
function fitPrefix(text: string, budget: number): number {
  let bytes = 0;
  let i = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i) ?? 0;
    const size = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (bytes + size > budget) break;
    bytes += size;
    i += cp > 0xffff ? 2 : 1;
  }
  return i;
}

/** Cut `text` from `offset` to at most `budget` UTF-8 bytes, at a clean boundary. */
function pageText(text: string, offset: number, budget: number | undefined): Page {
  const rest = text.slice(offset);
  if (budget === undefined || utf8Bytes(rest) <= budget) return { value: rest };
  let cut = rest.slice(0, fitPrefix(rest, budget));
  if (!/\s/.test(rest[cut.length] ?? "")) {
    const at = [cut.lastIndexOf("\n\n"), cut.lastIndexOf("\n"), cut.lastIndexOf(" ")].find((i) => i > 0);
    if (at !== undefined) cut = cut.slice(0, at);
  }
  return { value: cut, nextOffset: offset + cut.length };
}

/** Take whole items from `offset` while they fit `budget` bytes (always at least one). */
function pageItems(items: unknown[], offset: number, budget: number | undefined): Page {
  const rest = items.slice(offset);
  if (budget === undefined) return { value: rest };
  let used = 0;
  let take = 0;
  for (const item of rest) {
    const size = utf8Bytes(JSON.stringify(item) ?? "null") + 1;
    if (take > 0 && used + size > budget) break;
    used += size;
    take++;
  }
  return take < rest.length ? { value: rest.slice(0, take), nextOffset: offset + take } : { value: rest };
}

/** A non-negative integer arg, else `undefined`. */
function intArg(v: unknown): number | undefined {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : undefined;
}

/**
 * Build a tool result, applying the optional output budget to one field.
 *
 * @param tool - Tool name (used for the offload file name).
 * @param payload - The tool's full result payload.
 * @param field - Name of the big field (string or array) the budget applies to.
 * @param args - The tool call arguments (`maxTokens`, `offset`, `outputMode`).
 * @returns `jsonResult(payload)` untouched when no budget param is set. `outputMode:"file"` on a
 *   field that is absent or neither text nor a list writes nothing and adds `outputError:"field_not_offloadable"`.
 */
export function budgetResult(tool: string, payload: Record<string, unknown>, field: string, args: Record<string, unknown>): CallToolResult {
  const maxTokens = intArg(args.maxTokens);
  const offset = intArg(args.offset) ?? 0;
  const toFile = args.outputMode === "file";
  const value = payload[field];
  const pageable = typeof value === "string" || Array.isArray(value);
  if (!pageable) return jsonResult(toFile ? { ...payload, outputError: "field_not_offloadable" } : payload);
  if (!toFile && !maxTokens && offset === 0) return jsonResult(payload);
  if (toFile) return jsonResult(offloadField(tool, payload, field));
  const budget = maxTokens ? maxTokens * BYTES_PER_TOKEN : undefined;
  const page = typeof value === "string" ? pageText(value, offset, budget) : pageItems(value as unknown[], offset, budget);
  const out: Record<string, unknown> = { ...payload, [field]: page.value };
  if (page.nextOffset !== undefined) out.nextOffset = page.nextOffset; // never `truncated`: that key belongs to the tool
  out.approxTokens = 0; // placeholder so the estimate includes the key itself
  out.approxTokens = estimateTokens(utf8Bytes(JSON.stringify(out)));
  return jsonResult(out);
}
