/**
 * Extraction tool for a live session: text / prices / hotels / challenges.
 * Text is returned as LLM-ready markdown by default; `format:"text"` for raw.
 * @module server/tools/extract
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectChallenges } from "../../extraction/challenges.js";
import { detectSessionBlock } from "../../extraction/challenge-verdict.js";
import { extractHotelOffers } from "../../extraction/hotel-offers.js";
import { mainText } from "../../extraction/main-text.js";
import { extractPrices } from "../../extraction/prices.js";
import { htmlToMarkdown, renderMarkdown } from "../../extraction/serialize/to-markdown.js";
import type { SessionManager } from "../../session/manager.js";
import { BUDGET_INPUT_SHAPE, BUDGET_OUTPUT_SHAPE, budgetResult } from "../output-budget.js";
import { challengesSchema, hotelOffersSchema, sessionBlockShape } from "./schemas-hotel-challenges-output.js";
import { priceSchema } from "./schemas-price-output.js";
import { withSession } from "./with-session.js";

const KIND = z.enum(["text", "prices", "hotels", "challenges", "all"]);

/**
 * `browser_extract` output shape. Precise, not permissive: `kind` fully
 * determines which optional keys are populated (see the handler below), and
 * hotelOffers/challenges' all-optional-field schemas already validate their
 * `{}` empty variant.
 */
export const EXTRACT_OUTPUT_SHAPE = {
  url: z.string(),
  text: z.string().optional(),
  prices: z.array(priceSchema).optional(),
  hotelOffers: hotelOffersSchema.optional(),
  challenges: challengesSchema.optional(),
  ...sessionBlockShape,
  ...BUDGET_OUTPUT_SHAPE,
};

/** Register `browser_extract`. */
export function registerExtractTool(server: McpServer, sessions: SessionManager): void {
  server.registerTool(
    "browser_extract",
    {
      title: "Extract",
      description:
        'Extract text, prices, hotel offers and/or challenges from the live page. Text is clean LLM-ready markdown by default; pass format:"text" for raw innerText.',
      inputSchema: {
        sessionId: z.string(),
        kind: KIND.optional(),
        format: z.enum(["markdown", "text"]).optional(),
        ...BUDGET_INPUT_SHAPE,
      },
      outputSchema: EXTRACT_OUTPUT_SHAPE,
    },
    async (args) => {
      const a = args as Record<string, unknown>;
      const kind = (a.kind as string) ?? "all";
      const format = a.format === "text" ? "text" : "markdown";
      return withSession(sessions, String(a.sessionId), async (s) => {
        const text = await mainText(s.page);
        const out: Record<string, unknown> = { url: s.page.url() };
        if (kind === "text" || kind === "all") {
          out.text =
            format === "text"
              ? text
              : renderMarkdown(await htmlToMarkdown(await s.page.content(), { url: s.page.url() }));
        }
        if (kind === "prices" || kind === "all") {
          out.prices = extractPrices(text);
          out.hotelOffers = extractHotelOffers(text);
        }
        if (kind === "hotels") out.hotelOffers = extractHotelOffers(text);
        if (kind === "challenges" || kind === "all") out.challenges = await detectChallenges(s.page, text);
        return budgetResult("browser_extract", { ...out, ...(await detectSessionBlock(s.page)) }, "text", a);
      });
    },
  );
}
