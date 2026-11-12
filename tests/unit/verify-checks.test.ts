import { describe, expect, test } from "bun:test";
import { evaluateExpectations } from "../../src/agent/verify-checks.js";
import { renderReceipt, resolveBaseline } from "../../src/agent/verify-evidence.js";
import type { PageProbe, VerifyLogs } from "../../src/interfaces/verify.js";

const probe = (text: string, state: Awaited<ReturnType<PageProbe["visibility"]>> = "visible"): PageProbe => ({
  bodyText: async () => text,
  visibility: async () => state,
});
const logs = (over: Partial<VerifyLogs> = {}): VerifyLogs => ({ network: [], console: [], engine: "playwright", ...over });

describe("evaluateExpectations", () => {
  test("text is a case-sensitive substring; reasons per visibility state", async () => {
    expect((await evaluateExpectations([{ text: "Welcome" }], probe("Welcome home"), logs())).failed).toEqual([]);
    expect((await evaluateExpectations([{ text: "welcome" }], probe("Welcome home"), logs())).failed[0]?.reason).toBe("text_not_found");
    for (const [state, reason] of [["hidden", "not_visible"], ["missing", "selector_not_found"], ["invalid", "invalid_selector"]] as const) {
      expect((await evaluateExpectations([{ visible: "#x" }], probe("", state), logs())).failed[0]?.reason).toBe(reason);
    }
  });

  test("noFailedRequests: responses >= 400, and (fail closed) a request that never got a response", async () => {
    const net = [
      { type: "request", url: "http://a/x.js", method: "GET" },
      { type: "response", url: "http://a/x.js", status: 200 },
      { type: "request", url: "http://a/y.png", method: "GET" },
      { type: "response", url: "http://a/y.png", status: 404 },
      { type: "request", url: "http://a/pending" },
    ];
    const r = await evaluateExpectations([{ noFailedRequests: true }], probe(""), logs({ network: net }));
    expect(r.failed[0]?.detail).toEqual([
      { url: "http://a/y.png", status: 404 },
      { url: "http://a/pending", error: "no_response" },
    ]);
  });

  test("noConsoleErrors: errors fail on any engine; clean passes only where the console is captured", async () => {
    const err = [{ type: "error", text: "boom" }];
    expect((await evaluateExpectations([{ noConsoleErrors: true }], probe(""), logs({ console: err }))).failed[0]?.reason).toBe("console_errors");
    expect((await evaluateExpectations([{ noConsoleErrors: true }], probe(""), logs({ engine: "patchright", console: err }))).failed[0]?.reason).toBe("console_errors");
    expect((await evaluateExpectations([{ noConsoleErrors: true }], probe(""), logs())).failed).toEqual([]);
    const pw = await evaluateExpectations([{ noConsoleErrors: true }], probe(""), logs({ engine: "patchright" }));
    expect(pw.failed[0]?.reason).toBe("console_unavailable_on_patchright");
    expect(pw.consoleAvailable).toBe(false);
  });
});

describe("receipt", () => {
  test("renders a pass/fail table and the evidence paths", () => {
    const md = renderReceipt({
      pass: false,
      url: "http://x/",
      title: "T",
      engine: "playwright",
      expectations: [{ text: "a" }, { visible: "#b" }],
      failed: [{ expect: { visible: "#b" }, reason: "not_visible" }],
      files: { after: "/e/after.png" },
    });
    expect(md).toContain("- result: FAIL");
    expect(md).toContain("| 1 | `{\"text\":\"a\"}` | pass |  |");
    expect(md).toContain("not_visible");
    expect(md).toContain("- after: /e/after.png");
  });

  test("a baseline that does not exist resolves to null", () => {
    expect(resolveBaseline("/no/such/file.png")).toBeNull();
    expect(resolveBaseline("/no/such/receipt.md")).toBeNull();
  });
});
