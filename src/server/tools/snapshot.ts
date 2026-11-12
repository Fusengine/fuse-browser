/**
 * Snapshot + act-by-ref tools: the agentic targeting layer.
 * `browser_snapshot` returns indexed interactive elements (each with a `ref`);
 * `browser_act` executes an action on a chosen `ref` (or text fallback) and
 * returns a diff of what changed on the page (added/removed/text/url).
 * @module server/tools/snapshot
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { annotatedScreenshot } from "../../extraction/annotate.js";
import { redactElements } from "../../extraction/redact.js";
import { isRef } from "../../actions/act-by-ref.js";
import { guardRef } from "../../actions/ref-guard.js";
import { registryFor } from "../../actions/ref-registry.js";
import { captureSnapshotFull, MAX_ELEMENTS } from "../../extraction/snapshot.js";
import { diffSnapshots } from "../../extraction/snapshot-diff.js";
import { MAX_PER_FRAME } from "../../extraction/snapshot-walk.js";
import type { SessionManager } from "../../session/manager.js";
import { withEffect } from "../../state/effect.js";
import { BUDGET_INPUT_SHAPE, budgetResult } from "../output-budget.js";
import { errorResult, imageJsonResult, jsonResult } from "../result.js";
import { guardActRefs, KIND, runAct } from "./run-act.js";
import { actOutputShape, snapshotOutputShape } from "./snapshot-output.js";
import { withSession } from "./with-session.js";

/** Hint attached when a snapshot hit a cap (values come from the walk's own constants). */
const TRUNCATED_HINT = `truncated: caps of ${MAX_PER_FRAME} elements per frame / ${MAX_ELEMENTS} in total hid some matches; scroll or navigate to the part of the page you need and snapshot again.`;

/** Register `browser_snapshot` and `browser_act`. */
export function registerSnapshotTools(server: McpServer, sessions: SessionManager): void {
  server.registerTool(
    "browser_snapshot",
    {
      title: "Snapshot",
      description:
        "Return the indexed interactive elements of the live page, including those inside open Shadow DOM and iframes (same- and cross-origin). Use each element's `ref` (e.g. \"12\" or \"3:4\" for a sub-frame) with browser_act for deterministic targeting. Pass `selectors:true` to also get a durable CSS `selector` per element. Pass `prune:true` to drop only genuinely hidden or decorative elements: CSS-hidden (`display:none`/`visibility:hidden`/`content-visibility`, self or ancestor, via `checkVisibility()`) OR decorative (under an `aria-hidden` ancestor AND not focusable). A visible, focusable element is KEPT even under an `aria-hidden` ancestor — so an open modal's controls stay in the snapshot. Off by default, output unchanged. Pass `within` (a ref, or a CSS selector) to snapshot only that subtree (the ref's element and its descendants / every selector match), e.g. one form or dialog: output gains `scope:{matched,error?}`, refs keep their stamps and stay guarded, refs already accepted stay accepted. Use browser_find to locate an element by name instead. Pass `annotate:true` for a Set-of-Marks JPEG screenshot with numbered badges (= each `ref`) — for vision models: they see the page and target by ref.",
      inputSchema: {
        sessionId: z.string(),
        selectors: z.boolean().optional(),
        annotate: z.boolean().optional(),
        prune: z.boolean().optional(),
        within: z.string().optional(),
        ...BUDGET_INPUT_SHAPE,
      },
      outputSchema: snapshotOutputShape,
    },
    async (args) => {
      const a = args as Record<string, unknown>;
      return withSession(sessions, String(a.sessionId), async (s) => {
        const within = typeof a.within === "string" && a.within.length > 0 ? a.within : undefined;
        const refs = registryFor(s.page);
        // A `within` ref must still be the element the agent saw: ids restart per document,
        // so an old number could otherwise scope the subtree of another element.
        const staleScope = within !== undefined && isRef(within) ? await guardRef(s.page, within) : null;
        if (staleScope) {
          return jsonResult({
            url: s.page.url(),
            generation: refs.generation,
            count: 0,
            elements: [],
            truncated: false,
            dropped: 0,
            scope: { matched: 0, error: "ref_stale" },
            hint: String(staleScope.hint),
          });
        }
        const snap = await captureSnapshotFull(s.page, a.selectors === true, a.prune === true, within);
        const generation = within === undefined ? refs.begin(snap) : refs.refresh(snap);
        const elements = redactElements(snap.elements, s.secrets);
        const payload = {
          url: s.page.url(),
          generation,
          count: elements.length,
          elements,
          truncated: snap.truncated,
          dropped: snap.dropped,
          ...(snap.scope ? { scope: snap.scope } : {}),
          ...(snap.truncated ? { hint: TRUNCATED_HINT } : {}),
        };
        if (a.annotate !== true) return budgetResult("browser_snapshot", payload, "elements", a);
        const shot = await annotatedScreenshot(s.page);
        return imageJsonResult(shot.base64, { ...payload, marks: shot.marks });
      });
    },
  );

  server.registerTool(
    "browser_act",
    {
      title: "Act on element",
      description:
        "Execute click/fill/select/pick/upload/hover/drag on an element by `ref` (from browser_snapshot) or by `target` text. `pick` = type `value` into a combobox then click the matching suggestion (`option` text, defaults to `value`) — for airport/city autocompletes. `upload` = set local file path(s) on an `<input type=file>` via `files` (a single path, a comma-separated string, or an array). `hover` = move the pointer over the element (reveals hover menus/tooltips). `drag` = drag the source element onto a destination given by `to` (a snapshot `ref` or a CSS selector). Returns a diff of what changed. A `ref` that no longer points at the element you saw in the last browser_snapshot is refused with `error:\"ref_stale\"` (nothing is clicked): call browser_snapshot again. Pass `annotate:true` to also get a Set-of-Marks screenshot of the NEW state (a new snapshot generation) for vision models. Opt-in safety: `confirmSensitive:true` (or env FUSE_CONFIRM_SENSITIVE=1) makes a click on a destructive/payment-looking control return `error:\"confirmation_required\"` without acting; repeat with `confirmed:true` to proceed.",
      inputSchema: {
        sessionId: z.string(),
        kind: KIND,
        ref: z.union([z.number().int(), z.string()]).optional(),
        target: z.string().optional(),
        value: z.string().optional(),
        option: z.string().optional(),
        files: z.union([z.string(), z.array(z.string())]).optional(),
        to: z.string().optional(),
        annotate: z.boolean().optional(),
        confirmSensitive: z.boolean().optional(),
        confirmed: z.boolean().optional(),
      },
      outputSchema: actOutputShape,
    },
    async (args) => {
      const a = args as Record<string, unknown>;
      return withSession(sessions, String(a.sessionId), async (s) => {
        const { stale, note } = await guardActRefs(s.page, a);
        if (stale) {
          const diff = diffSnapshots([], [], false);
          const effect = { urlChanged: false, domChanged: false, settleMs: 0 };
          return jsonResult({ result: stale, url: s.page.url(), diff, effect, generation: registryFor(s.page).generation });
        }
        const before = redactElements((await captureSnapshotFull(s.page)).elements, s.secrets);
        const urlBefore = s.page.url();
        const { value: acted, effect } = await withEffect(s.page, () =>
          runAct(s.page, a, s.config.humanMode, s.config.siteMemoryDir),
        );
        if (!acted) return errorResult("browser_act requires either `ref` or `target`");
        const result = note ? { ...acted, refNote: note } : acted;
        const afterSnap = await captureSnapshotFull(s.page);
        const after = redactElements(afterSnap.elements, s.secrets);
        const diff = diffSnapshots(before, after, s.page.url() !== urlBefore);
        const refs = registryFor(s.page);
        if (a.annotate === true) refs.begin(afterSnap);
        else {
          const added = new Set(diff.added.map((e) => e.ref));
          refs.merge({ elements: afterSnap.elements.filter((e) => added.has(e.ref)), docs: afterSnap.docs });
        }
        const out = { result, url: s.page.url(), diff, effect, generation: refs.generation };
        if (a.annotate !== true) return jsonResult(out);
        const shot = await annotatedScreenshot(s.page);
        return imageJsonResult(shot.base64, { ...out, marks: shot.marks });
      });
    },
  );
}
