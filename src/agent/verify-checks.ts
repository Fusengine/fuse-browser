/**
 * Deterministic evaluation of `browser_verify` expectations. The page and the
 * log buffers are passed in, so every check is testable without a browser.
 * @module agent/verify-checks
 */
import type { Expectation, FailedRequest, PageProbe, VerifyFailure, VerifyLogs } from "../interfaces/verify.js";

/** Cap on items quoted in a failure's `detail`. */
const DETAIL_MAX = 10;

/** Result of evaluating all expectations. */
export interface CheckOutcome {
  failed: VerifyFailure[];
  /** False on the default `patchright` engine (Console API disabled upstream). */
  consoleAvailable: boolean;
}

/**
 * Failed requests: the complete list recorded during the verification when there
 * is one, else every response >= 400 of the session buffer (each response on its
 * own: a 500 followed by a 200 on the same URL still counts).
 */
function failedRequests(logs: VerifyLogs): FailedRequest[] {
  if (logs.failedRequests) return logs.failedRequests;
  const bad: FailedRequest[] = logs.network
    .filter((e) => e.type === "response" && typeof e.status === "number" && e.status >= 400)
    .map((e) => ({ url: String(e.url), status: e.status as number }));
  // The session buffer never records `requestfailed`: fail closed, a request that never got a
  // response counts as failed (a still-pending long-poll can therefore fail the check).
  const open = new Map<string, number>();
  for (const e of logs.network) {
    const url = String(e.url);
    if (e.type === "request") open.set(url, (open.get(url) ?? 0) + 1);
    else if (e.type === "response") open.set(url, (open.get(url) ?? 0) - 1);
  }
  for (const [url, n] of open) if (n > 0) bad.push({ url, error: "no_response" });
  return bad;
}

/** Evaluate one expectation; `null` = it holds. */
async function check(exp: Expectation, probe: PageProbe, logs: VerifyLogs): Promise<VerifyFailure | null> {
  if ("text" in exp) {
    return (await probe.bodyText()).includes(exp.text) ? null : { expect: exp, reason: "text_not_found" };
  }
  if ("visible" in exp) {
    const state = await probe.visibility(exp.visible);
    if (state === "visible") return null;
    const reason = { hidden: "not_visible", missing: "selector_not_found", invalid: "invalid_selector" }[state];
    return { expect: exp, reason };
  }
  if ("noFailedRequests" in exp) {
    const bad = failedRequests(logs);
    return bad.length === 0 ? null : { expect: exp, reason: "failed_requests", detail: bad.slice(0, DETAIL_MAX) };
  }
  const errors = logs.console.filter((e) => e.type === "error").map((e) => e.text);
  const thrown = logs.pageErrors ?? [];
  // Uncaught exceptions are not console messages: they are reported (and caught) on every engine.
  if (thrown.length > 0) return { expect: exp, reason: "page_errors", detail: [...thrown, ...errors].slice(0, DETAIL_MAX) };
  if (errors.length > 0) return { expect: exp, reason: "console_errors", detail: errors.slice(0, DETAIL_MAX) };
  // No error seen: only meaningful where the console is captured. Never a silent pass.
  return logs.engine === "patchright" ? { expect: exp, reason: "console_unavailable_on_patchright" } : null;
}

/**
 * Evaluate every expectation, in order.
 *
 * @param expectations - The agent's expectations.
 * @param probe - Access to the page (text, visibility).
 * @param logs - Network/console entries seen since the verification started.
 */
export async function evaluateExpectations(
  expectations: Expectation[],
  probe: PageProbe,
  logs: VerifyLogs,
): Promise<CheckOutcome> {
  const failed: VerifyFailure[] = [];
  for (const exp of expectations) {
    const f = await check(exp, probe, logs);
    if (f) failed.push(f);
  }
  return { failed, consoleAvailable: logs.engine !== "patchright" };
}
