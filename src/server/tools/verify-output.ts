/**
 * Input/output schemas of `browser_verify`.
 * @module server/tools/verify-output
 */
import { z } from "zod";
import { sessionBlockShape } from "./schemas-hotel-challenges-output.js";

/** One expectation: exactly one key (a combination is rejected). */
export const expectationSchema = z.union([
  z.object({ text: z.string().min(1) }).strict(),
  z.object({ visible: z.string().min(1) }).strict(),
  z.object({ noConsoleErrors: z.literal(true) }).strict(),
  z.object({ noFailedRequests: z.literal(true) }).strict(),
]);

/** `browser_verify` outputSchema. */
export const verifyOutputShape = {
  pass: z.boolean(),
  url: z.string(),
  title: z.string(),
  failed: z.array(z.object({ expect: z.record(z.string(), z.unknown()), reason: z.string(), detail: z.unknown().optional() })),
  consoleAvailable: z.boolean(),
  evidence: z.object({
    before: z.string().optional(),
    after: z.string(),
    diff: z
      .object({
        image: z.string().optional(),
        diffPixels: z.number(),
        diffRatio: z.number(),
        regions: z.number(),
        changed: z.boolean(),
        error: z.string().optional(),
      })
      .optional(),
    consoleLog: z.string(),
    networkLog: z.string(),
    receiptMd: z.string(),
  }),
  ...sessionBlockShape,
};
