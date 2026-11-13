/**
 * `browser_find`: locate interactive elements of the live page by accessible
 * name / role / text and get their refs, without dumping the whole snapshot.
 * Returned refs are registered in the agent-facing ref registry, so they are
 * actionable by `browser_act` and guarded (`ref_stale`) like snapshot refs.
 * @module server/tools/find
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registryFor } from "../../actions/ref-registry.js";
import { findElements } from "../../extraction/find-elements.js";
import { redactElements } from "../../extraction/redact.js";
import { captureSnapshotFull } from "../../extraction/snapshot.js";
import type { SessionManager } from "../../session/manager.js";
import { jsonResult } from "../result.js";
import { interactiveElementShape } from "./snapshot-output.js";
import { withSession } from "./with-session.js";

/** Default and maximum number of matches returned. */
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

/** `browser_find` outputSchema. */
export const findOutputShape = {
  url: z.string(),
  query: z.string(),
  generation: z.number(),
  total: z.number(),
  count: z.number(),
  matches: z.array(interactiveElementShape),
  truncated: z.boolean(),
  dropped: z.number(),
  hint: z.string().optional(),
};

/** Register `browser_find`. */
export function registerFindTool(server: McpServer, sessions: SessionManager): void {
  server.registerTool(
    "browser_find",
    {
      title: "Find elements",
      description:
        "Find interactive elements of the live page by accessible name, role or text (every word of `query` must match, case-insensitive; exact and prefix name matches rank first) and return only the best `limit` (default 10, max 50) with their `ref` — far cheaper than a full browser_snapshot. The refs are actionable with browser_act and guarded like snapshot refs (`ref_stale` if the element changed). `total` is the number of matches; `truncated:true` means the snapshot caps (200 per frame / 400 total) hid part of the page, so a miss may be a cap miss: scroll or use browser_snapshot `within`.",
      inputSchema: {
        sessionId: z.string(),
        query: z.string().min(1),
        limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
      },
      outputSchema: findOutputShape,
    },
    async (args) => {
      const a = args as Record<string, unknown>;
      return withSession(sessions, String(a.sessionId), async (s) => {
        const limit = typeof a.limit === "number" ? a.limit : DEFAULT_LIMIT;
        const snap = await captureSnapshotFull(s.page);
        const { matches, total } = findElements(snap.elements, String(a.query), limit);
        const generation = registryFor(s.page).add({ elements: matches, docs: snap.docs });
        const hint = snap.truncated
          ? `truncated: the snapshot caps hid ${snap.dropped} element(s); ${total === 0 ? "no match here does not mean absent. " : ""}scroll, or use browser_snapshot with \`within\`.`
          : total === 0
            ? "No interactive element matches; try fewer or different words, or browser_snapshot."
            : undefined;
        return jsonResult({
          url: s.page.url(),
          query: String(a.query),
          generation,
          total,
          count: matches.length,
          matches: redactElements(matches, s.secrets),
          truncated: snap.truncated,
          dropped: snap.dropped,
          ...(hint ? { hint } : {}),
        });
      });
    },
  );
}
