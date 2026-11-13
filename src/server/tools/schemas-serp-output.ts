/**
 * Shared zod `outputSchema` pieces for Google SERP shapes, reused by the
 * probe and serp-batch tool outputs.
 * @module server/tools/schemas-serp-output
 */
import { z } from "zod";

/** One SERP entry (matches `interfaces/serp.ts#SerpResult`). */
export const serpResultSchema = z.object({
  position: z.number(),
  title: z.string(),
  url: z.string(),
  displayUrl: z.string().optional(),
  snippet: z.string().optional(),
  redirect: z.boolean().optional(),
});

/** Why a SERP has zero results (matches `interfaces/serp.ts#SerpWarning`). */
export const serpWarningSchema = z.enum(["no_results_extracted", "consent_wall", "blocked"]);

/** Where a domain ranks in a SERP (matches `interfaces/serp.ts#DomainRank`). */
export const domainRankSchema = z.object({
  domain: z.string(),
  organic: z.array(z.number()),
  ads: z.array(z.number()),
  best: z.number().nullable(),
  found: z.boolean(),
});

/** A parsed Google search page (matches `interfaces/serp.ts#Serp`). */
export const serpSchema = z.object({
  organic: z.array(serpResultSchema),
  ads: z.array(serpResultSchema),
  related: z.array(z.string()),
  rank: domainRankSchema.optional(),
  warning: serpWarningSchema.optional(),
});
