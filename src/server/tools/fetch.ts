/**
 * `browser_fetch` tool: HTTP fast-path (browser TLS impersonation, no browser
 * launch). Returns status, LLM-ready markdown (or raw text), optional prices,
 * and optional structured contacts extracted from the fetched HTML.
 * @module server/tools/fetch
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetchAndRender } from "../../agent/fetch-orchestrate.js";
import { contactsFromHtml } from "../../extraction/contacts/from-html.js";
import { extractPrices } from "../../extraction/prices.js";
import { PrivateNetworkBlockedError } from "../../net/private-net-guard.js";
import { BUDGET_INPUT_SHAPE, BUDGET_OUTPUT_SHAPE, budgetResult } from "../output-budget.js";
import { errorResult } from "../result.js";
import { contactsSchema } from "./schemas-contacts-output.js";
import { renderedFetchSchema } from "./schemas-fetch-output.js";
import { priceSchema } from "./schemas-price-output.js";

/** `browser_fetch` output shape: a rendered fetch plus optional prices/contacts. */
export const FETCH_OUTPUT_SHAPE = {
  ...renderedFetchSchema.shape,
  prices: z.array(priceSchema).optional(),
  contacts: contactsSchema.optional(),
  ...BUDGET_OUTPUT_SHAPE,
};

/** Register `browser_fetch`. */
export function registerFetchTool(server: McpServer): void {
  server.registerTool(
    "browser_fetch",
    {
      title: "HTTP fast fetch",
      description:
        'Fetch a URL with browser TLS/HTTP2 impersonation — NO browser launch, ~10x faster. Returns clean LLM-ready markdown by default (or raw text with format:"text"), plus wordCount/extraction signal ("primary"|"recovered") — markdown auto-recovers the raw page text when the extractor silently captured only a sliver of the page\'s real prose (e.g. some forum threads), while a genuinely sparse or link-heavy page (listing, login, 404) always keeps the clean extracted output; pass contentSelector to pin the main content container yourself when auto-detection still picks the wrong element. Also supports optional prices, and optional contacts (emails/phones/form) with extractContacts. Non-HTML responses (JSON APIs, plain text) are returned verbatim. A PDF (application/pdf or %PDF- bytes) is read as text with <!-- page N --> markers and a pageCount (pdfError:"too_large" over the 10 MB download cap, "unreadable" if corrupt/encrypted, "timeout" past the 20 s extraction budget, "memory" past the FUSE_PDF_MAX_MB cap (default 256); scanned PDFs have no text layer and come back empty). When the site publishes its own markdown — answered to our Accept: text/markdown, or advertised by a Link: rel="alternate"; type="text/markdown" header — that markdown is returned as-is with source:"site-markdown" (at most one extra same-origin request); preferMarkdown:true also tries the <url>.md twin of a docs page (source:"html" when none exists). focus:"<question or keywords>" (+ topK, default 3) adds passages:[{heading, text, score}] — the best BM25 matches over the headings and text of the WHOLE page, model-free (empty array when nothing matches); text is unchanged, so pair it with a small maxChars to read only the passages. For server-rendered HTML; set browserFallback:true to auto-render client-side (SPA/CSR) pages in a real browser when the HTTP response is an empty shell, OR when the fast-path extraction itself comes back empty on a chrome-heavy JS-rendered page (escalated:true marks either case). An anti-bot interstitial (Cloudflare/DataDome/AWS WAF challenge page) is NOT page content: it comes back with blocked:true, blockedBy:<vendor> and a hint naming the next tools (browserFallback:true, then browser_open → browser_navigate → browser_extract, then browser_handoff if a human step shows); FUSE_FETCH_ESCALATE_BLOCKED=1 makes the server escalate such a block on its own. extractContacts collects personal data — ensure a lawful basis (GDPR/nLPD).',
      inputSchema: {
        url: z.string(),
        format: z.enum(["markdown", "text"]).optional(),
        contentSelector: z.string().optional(),
        extractPrices: z.boolean().optional(),
        extractContacts: z.boolean().optional(),
        contactFilter: z.enum(["strict", "off"]).optional(),
        countryCode: z.string().optional(),
        proxyUrl: z.string().optional(),
        maxChars: z.number().int().optional(),
        browserFallback: z.boolean().optional(),
        preferMarkdown: z.boolean().optional(),
        focus: z.string().optional(),
        topK: z.number().int().positive().optional(),
        ...BUDGET_INPUT_SHAPE,
      },
      outputSchema: FETCH_OUTPUT_SHAPE,
    },
    async (args) => {
      const a = args as Record<string, unknown>;
      const proxyUrl = typeof a.proxyUrl === "string" ? a.proxyUrl : undefined;
      try {
        // Escalates to a real browser render when browserFallback is on and either
        // the raw HTML is an unrendered SPA shell, or the fast-path extraction came
        // back empty on a page carrying JS-rendering markers (fetch-orchestrate.ts).
        const { body, rendered } = await fetchAndRender(String(a.url), {
          browserFallback: a.browserFallback === true,
          preferMarkdown: a.preferMarkdown === true,
          focus: typeof a.focus === "string" ? a.focus : undefined,
          topK: typeof a.topK === "number" ? a.topK : undefined,
          proxyUrl,
          format: typeof a.format === "string" ? a.format : undefined,
          maxChars: typeof a.maxChars === "number" ? a.maxChars : undefined,
          contentSelector: typeof a.contentSelector === "string" ? a.contentSelector : undefined,
        });
        const country = typeof a.countryCode === "string" ? a.countryCode : "CH";
        const filter = a.contactFilter === "off" ? "off" : "strict";
        return budgetResult(
          "browser_fetch",
          {
            ...rendered,
            prices: a.extractPrices ? extractPrices(body.text) : undefined,
            contacts: a.extractContacts ? contactsFromHtml(body.html, country, { url: body.url, filter }) : undefined,
          },
          "text",
          a,
        );
      } catch (err) {
        if (err instanceof PrivateNetworkBlockedError) return errorResult(err.message, err.code);
        throw err;
      }
    },
  );
}
