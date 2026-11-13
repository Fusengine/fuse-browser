/**
 * Action tools for a live session: click / fill / login / wait / scroll /
 * press / select / back / forward. `browser_fill` and `browser_login` accept
 * a `credentialRef` to fill vault secrets without the LLM ever seeing them.
 * @module server/tools/act
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type ActionInput, performAction } from "../../actions/perform.js";
import { sensitivePause, sensitivePressPause } from "../../actions/sensitive-guard.js";
import type { SessionManager } from "../../session/manager.js";
import { withEffect } from "../../state/effect.js";
import { persistStorageState } from "../../session/persist-auth.js";
import { runWithMemory } from "../../state/action-memory.js";
import { applyCredential } from "../../vault/fill.js";
import { errorResult, jsonResult } from "../result.js";
import { withSession } from "./with-session.js";

type Shape = Record<string, z.ZodTypeAny>;
type Build = (a: Record<string, unknown>) => ActionInput;

/**
 * `ActionResult` (interfaces/types.ts) has an index signature — model extra
 * keys permissively. Shared with wait.ts (`waitForCondition` also returns an
 * `ActionResult`, tagged `wait_for` with extra `condition`/`value` fields).
 */
export const actionResultShape = z
  .object({
    type: z.string(),
    ok: z.boolean(),
    target: z.string().optional(),
    strategy: z.string().optional(),
    error: z.string().optional(),
    ms: z.number().optional(),
  })
  .catchall(z.unknown());

/** Cheap post-action signals: a no-op action shows `domChanged:false, urlChanged:false`. */
export const effectShape =z.object({ urlChanged: z.boolean(), domChanged: z.boolean(), settleMs: z.number() });

/** Every `actTool` handler returns `{ result, url, effect }` via `jsonResult`. */
const actOutputShape = { result: actionResultShape, url: z.string(), effect: effectShape };

function actTool(
  server: McpServer,
  sessions: SessionManager,
  name: string,
  description: string,
  inputSchema: Shape,
  build: Build,
): void {
  server.registerTool(name, { title: name, description, inputSchema, outputSchema: actOutputShape }, async (args) => {
    const a = args as Record<string, unknown>;
    return withSession(sessions, String(a.sessionId), async (s) => {
      const action = build(a);
      try {
        applyCredential(a, action, s.page.url(), s.secrets);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err), "credential_failed");
      }
      const settle = name !== "browser_scroll" && name !== "browser_wait";
      const { value: result, effect } = await withEffect(
        s.page,
        async () => {
          const pause =
            action.type === "click"
              ? await sensitivePause(s.page, { ...a, kind: "click" })
              : action.type === "press"
                ? await sensitivePressPause(s.page, a)
                : null;
          return (
            pause ??
            (await runWithMemory(s.config.siteMemoryDir, s.page, action, (act) =>
              performAction(s.page, act, s.config.humanMode),
            ))
          );
        },
        settle,
      );
      // Persist auth immediately after a successful login so the session is
      // captured at login time, not only on close (cookies + localStorage + IndexedDB).
      if (action.type === "login" && result.ok) {
        await persistStorageState(s.context, s.config.storageStatePath);
      }
      return jsonResult({ result, url: s.page.url(), effect });
    });
  });
}

/** Register every per-session action tool. */
export function registerActTools(server: McpServer, sessions: SessionManager): void {
  const sessionId = z.string();
  const credentialRef = z.string().optional();
  actTool(server, sessions, "browser_click", "Click a target in the session. Every action tool also returns `effect:{urlChanged,domChanged,settleMs}` (cheap signals; `ok` keeps its meaning, so a click that did nothing shows domChanged:false). Opt-in safety: `confirmSensitive:true` (or env FUSE_CONFIRM_SENSITIVE=1) makes a click on a destructive/payment-looking control return `error:\"confirmation_required\"` without clicking; repeat with `confirmed:true` to proceed.", { sessionId, target: z.string(), confirmSensitive: z.boolean().optional(), confirmed: z.boolean().optional() }, (a) => ({ type: "click", target: String(a.target) }));
  actTool(server, sessions, "browser_fill", "Fill a field. Pass `credentialRef` (+ optional `field`: username/password/totp) to fill a vault secret without exposing it.", { sessionId, target: z.string(), value: z.string().optional(), credentialRef, field: z.enum(["username", "password", "totp"]).optional() }, (a) => ({ type: "fill", target: String(a.target), value: a.value ? String(a.value) : "" }));
  actTool(server, sessions, "browser_scroll", "Scroll by a pixel delta (positive deltaY scrolls down). Pass `selector` to scroll a specific scrollable container (auto-detected if omitted with `to`), or `to:\"end\"` to jump to its bottom.", { sessionId, deltaY: z.number().optional(), deltaX: z.number().optional(), selector: z.string().optional(), to: z.enum(["end"]).optional() }, (a) => ({ type: "scroll", deltaY: a.deltaY ?? 600, deltaX: a.deltaX ?? 0, selector: a.selector as string | undefined, to: a.to as string | undefined }));
  actTool(server, sessions, "browser_press", "Press a key or shortcut (Enter, ArrowDown, Control+a...). Opt-in safety: with `confirmSensitive:true` (or env FUSE_CONFIRM_SENSITIVE=1), Enter/Space on a focused destructive/payment-looking control returns `error:\"confirmation_required\"` without pressing; repeat with `confirmed:true`.", { sessionId, key: z.string(), confirmSensitive: z.boolean().optional(), confirmed: z.boolean().optional() }, (a) => ({ type: "press", key: String(a.key) }));
  actTool(server, sessions, "browser_type", "Type text into whatever element currently has focus — no ref/target (types via the keyboard, not a locator). Use for elements a ref can't reach, e.g. a closed shadow-DOM input: browser_click the field first, then browser_type.", { sessionId, text: z.string() }, (a) => ({ type: "type", text: String(a.text) }));
  actTool(server, sessions, "browser_select", "Select an option in a <select> by value, label or index.", { sessionId, target: z.string(), value: z.string() }, (a) => ({ type: "select", target: String(a.target), value: String(a.value) }));
  actTool(server, sessions, "browser_back", "Navigate back in session history.", { sessionId }, () => ({ type: "back" }));
  actTool(server, sessions, "browser_forward", "Navigate forward in session history.", { sessionId }, () => ({ type: "forward" }));
  actTool(server, sessions, "browser_wait", "Wait for a number of milliseconds.", { sessionId, ms: z.number().int() }, (a) => ({ type: "wait", ms: Number(a.ms) }));
  actTool(server, sessions, "browser_login", "Structured login. Pass `credentialRef` to fill username+password from the vault without exposing them (for TOTP, use browser_fill with field:\"totp\"), or inline `username`+`password`.", { sessionId, username: z.string().optional(), password: z.string().optional(), credentialRef, usernameTarget: z.string().optional(), passwordTarget: z.string().optional(), submitTarget: z.string().optional() }, (a) => ({ type: "login", username: a.username ? String(a.username) : undefined, password: a.password ? String(a.password) : undefined, usernameTarget: a.usernameTarget as string | undefined, passwordTarget: a.passwordTarget as string | undefined, submitTarget: a.submitTarget as string | undefined }));
}
