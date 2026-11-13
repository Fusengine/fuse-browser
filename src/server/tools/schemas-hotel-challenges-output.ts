/**
 * Shared zod `outputSchema` pieces for hotel-offer and anti-bot-challenge
 * detection, reused by the probe and extract tool outputs. Every field is
 * optional so the same schema also validates the `{}` empty variant that
 * `interfaces/report.ts#ProbeReport` allows when the feature was skipped.
 * @module server/tools/schemas-hotel-challenges-output
 */
import { z } from "zod";

const hotelOfferSchema = z.object({ provider: z.string(), currency: z.string(), amount: z.number() });

/** Matches `interfaces/extraction.ts#HotelOffers` (or `{}` when unextracted). */
export const hotelOffersSchema = z.object({
  headline: z.object({ currency: z.string(), amount: z.number() }).nullable().optional(),
  options: z.array(hotelOfferSchema).optional(),
  bestTotal: hotelOfferSchema.nullable().optional(),
});

/** Optional block verdict of a session route (matches `extraction/challenge-verdict.ts#SessionBlock`). */
export const sessionBlockShape = {
  blocked: z.boolean().optional(),
  blockedBy: z.string().optional(),
  hint: z.string().optional(),
};

/** Matches `interfaces/extraction.ts#Challenges` (or `{}` when undetected). */
export const challengesSchema = z.object({
  captcha: z.boolean().optional(),
  turnstile: z.boolean().optional(),
  hcaptcha: z.boolean().optional(),
  cloudflare: z.boolean().optional(),
  login: z.boolean().optional(),
  otp: z.boolean().optional(),
  awsWaf: z.boolean().optional(),
});
