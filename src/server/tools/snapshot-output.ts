/**
 * outputSchema shapes for `browser_snapshot` and `browser_act`, mirroring
 * `InteractiveElement` (interfaces/extraction.ts) and `SnapshotDiff`
 * (extraction/snapshot-diff.ts) field-for-field. Once a tool declares an
 * `outputSchema`, the SDK (^1.29) throws `McpError` at runtime if the returned
 * `structuredContent` doesn't conform (see `screenshot-result.ts` for the same
 * contract). Plain (non-`.strict()`) shapes: unknown/extra keys are silently
 * stripped, never rejected. Extracted from `snapshot.ts` to keep it < 90 lines
 * (same precedent as `run-act.ts`).
 * @module server/tools/snapshot-output
 */
import { z } from "zod";
import { BUDGET_OUTPUT_SHAPE } from "../output-budget.js";
import { actionResultShape, effectShape } from "./act.js";

/** Mirrors `InteractiveElement` (interfaces/extraction.ts). */
export const interactiveElementShape = z.object({
  index: z.number(),
  ref: z.string().optional(),
  frame: z.number().optional(),
  tag: z.string(),
  text: z.string(),
  role: z.string().nullable(),
  id: z.string().nullable(),
  name: z.string().nullable(),
  type: z.string().nullable(),
  href: z.string().nullable(),
  visible: z.boolean(),
  box: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
  value: z.string().nullable().optional(),
  hasValue: z.boolean().optional(),
  placeholder: z.string().nullable().optional(),
  disabled: z.boolean().optional(),
  checked: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  ariaExpanded: z.string().nullable().optional(),
  ariaControls: z.string().nullable().optional(),
  obscured: z.boolean().optional(),
  selector: z.string().nullable().optional(),
});

/**
 * `browser_snapshot` outputSchema: `{ url, generation, count, elements, truncated,
 * dropped[, hint, marks] }`.
 */
export const snapshotOutputShape = {
  ...BUDGET_OUTPUT_SHAPE,
  url: z.string(),
  generation: z.number(),
  count: z.number(),
  elements: z.array(interactiveElementShape),
  truncated: z.boolean(),
  dropped: z.number(),
  scope: z.object({ matched: z.number(), error: z.string().optional() }).optional(),
  hint: z.string().optional(),
  marks: z.number().optional(),
};

/** Mirrors `TextChange` (extraction/snapshot-diff.ts). */
const textChangeShape = z.object({ index: z.number(), before: z.string(), after: z.string() });

/** Mirrors `SnapshotDiff` (extraction/snapshot-diff.ts). */
const snapshotDiffShape = z.object({
  added: z.array(interactiveElementShape),
  removed: z.array(interactiveElementShape),
  textChanged: z.array(textChangeShape),
  urlChanged: z.boolean(),
  changed: z.boolean(),
});

/** `browser_act` outputSchema: `{ result, url, diff[, marks] }`. */
export const actOutputShape = {
  result: actionResultShape,
  url: z.string(),
  diff: snapshotDiffShape,
  effect: effectShape.optional(),
  generation: z.number().optional(),
  marks: z.number().optional(),
};
