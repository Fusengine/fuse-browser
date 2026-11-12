/**
 * Proves every `browser_screenshot` return branch emits a `structuredContent`
 * payload that parses against `screenshotOutputShape` — required once the
 * tool declares an `outputSchema`, or the SDK (^1.29) throws `McpError` at
 * runtime for any branch missing/mismatching it.
 * @module tests/unit/screenshot-tool
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Page } from "playwright";
import { z } from "zod";
import { registryFor } from "../../src/actions/ref-registry.js";
import { screenshotOutputShape } from "../../src/server/tools/screenshot-result.js";
import { registerScreenshotTool } from "../../src/server/tools/screenshot.js";
import type { SessionManager } from "../../src/session/manager.js";
import type { SessionData } from "../../src/session/session.js";

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>;
const outputSchema = z.object(screenshotOutputShape);

/** Fake McpServer that just stores the registered handler. */
function mockServer(): { server: McpServer; getHandler: () => Handler } {
  let stored: Handler | undefined;
  const server = {
    registerTool: (_name: string, _cfg: unknown, fn: Handler) => {
      stored = fn;
    },
  } as unknown as McpServer;
  return { server, getHandler: () => stored as Handler };
}

/** Locator/Frame/Page fakes covering ref-locator, snapshot, and annotate paths. */
function fakePage() {
  const live = { tag: "button", role: null, id: null, name: null, type: null, href: null, text: "Go", title: null, doc: "d1", owned: true, editable: false };
  const locator = { count: async () => 1, screenshot: async () => Buffer.from("PNG-ELEMENT"), evaluate: async () => live };
  const frame = {
    locator: () => ({ first: () => locator, count: async () => 1 }),
    isDetached: () => false,
    evaluate: async () => ({ count: 1, live }),
  };
  const page = {
    frames: () => [frame],
    evaluate: async () => 2,
    screenshot: async () => Buffer.from("PNG-PAGE"),
    url: () => "https://example.test/",
    viewportSize: () => ({ width: 1280, height: 800 }),
    setViewportSize: async () => {},
    waitForLoadState: async () => {},
  };
  return page;
}

function fakeSessions(page: ReturnType<typeof fakePage>): SessionManager {
  const session = { id: "s", health: "ok", page } as unknown as SessionData;
  return {
    get: () => session,
    markBusy: () => {},
    markIdle: () => {},
  } as unknown as SessionManager;
}

describe("browser_screenshot outputSchema", () => {
  test("element ref branch: structuredContent parses against the schema", async () => {
    const { server, getHandler } = mockServer();
    const page = fakePage();
    registryFor(page as unknown as Page).begin({
      elements: [{ index: 0, ref: "3", tag: "button", text: "Go", role: null, id: null, name: null, type: null, href: null, visible: true, box: { x: 0, y: 0, width: 1, height: 1 } }],
      docs: { 0: "d1" },
    });
    registerScreenshotTool(server, fakeSessions(page));
    const res = await getHandler()({ sessionId: "s", ref: 3 });
    expect(res.structuredContent).toBeDefined();
    expect(() => outputSchema.parse(res.structuredContent)).not.toThrow();
    expect(outputSchema.parse(res.structuredContent).kind).toBe("element");
  });

  test("full-page branch: structuredContent parses against the schema", async () => {
    const { server, getHandler } = mockServer();
    registerScreenshotTool(server, fakeSessions(fakePage()));
    const res = await getHandler()({ sessionId: "s", fullPage: true });
    expect(res.structuredContent).toBeDefined();
    expect(() => outputSchema.parse(res.structuredContent)).not.toThrow();
    expect(outputSchema.parse(res.structuredContent).kind).toBe("page");
  });

  test("multi-viewport branch: structuredContent parses against the schema", async () => {
    const { server, getHandler } = mockServer();
    registerScreenshotTool(server, fakeSessions(fakePage()));
    const res = await getHandler()({ sessionId: "s", viewports: ["mobile", "desktop"] });
    expect(res.structuredContent).toBeDefined();
    const parsed = outputSchema.parse(res.structuredContent);
    expect(() => outputSchema.parse(res.structuredContent)).not.toThrow();
    expect(parsed).toMatchObject({ kind: "multi", count: 2 });
  });

  test("annotate branch: structuredContent parses against the schema", async () => {
    const { server, getHandler } = mockServer();
    registerScreenshotTool(server, fakeSessions(fakePage()));
    const res = await getHandler()({ sessionId: "s", annotate: true });
    expect(res.structuredContent).toBeDefined();
    expect(() => outputSchema.parse(res.structuredContent)).not.toThrow();
    expect(outputSchema.parse(res.structuredContent).kind).toBe("annotated");
  });

  test("full-page branch: without path, structuredContent.path stays undefined", async () => {
    const { server, getHandler } = mockServer();
    registerScreenshotTool(server, fakeSessions(fakePage()));
    const res = await getHandler()({ sessionId: "s", fullPage: true });
    const parsed = outputSchema.parse(res.structuredContent);
    expect(parsed.path).toBeUndefined();
  });

  test("full-page branch: with path, writes the file and returns {path}", async () => {
    const out = join(tmpdir(), `fuse-screenshot-${Date.now()}.png`);
    const { server, getHandler } = mockServer();
    registerScreenshotTool(server, fakeSessions(fakePage()));
    const res = await getHandler()({ sessionId: "s", fullPage: true, path: out });
    const parsed = outputSchema.parse(res.structuredContent);
    expect(parsed.path).toBe(out);
    expect(readFileSync(out).toString()).toBe("PNG-PAGE");
  });

  test("annotate branch: mismatched extension (.png for JPEG output) is rejected, not silently renamed", async () => {
    const out = join(tmpdir(), `fuse-screenshot-mismatch-${Date.now()}.png`);
    const { server, getHandler } = mockServer();
    registerScreenshotTool(server, fakeSessions(fakePage()));
    const res = await getHandler()({ sessionId: "s", annotate: true, path: out });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as Record<string, unknown>).code).toBe("path_extension_mismatch");
    expect(existsSync(out)).toBe(false);
  });

  test("multi-viewport branch: path with viewports.length > 1 returns an explicit error", async () => {
    const out = join(tmpdir(), `fuse-screenshot-multi-${Date.now()}.png`);
    const { server, getHandler } = mockServer();
    registerScreenshotTool(server, fakeSessions(fakePage()));
    const res = await getHandler()({ sessionId: "s", viewports: ["mobile", "desktop"], path: out });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as Record<string, unknown>).code).toBe("path_multi_viewport_unsupported");
    expect(existsSync(out)).toBe(false);
  });

  test("multi-viewport branch: path with a single-item viewports array writes the file", async () => {
    const out = join(tmpdir(), `fuse-screenshot-single-multi-${Date.now()}.png`);
    const { server, getHandler } = mockServer();
    registerScreenshotTool(server, fakeSessions(fakePage()));
    const res = await getHandler()({ sessionId: "s", viewports: ["mobile"], path: out });
    const parsed = outputSchema.parse(res.structuredContent);
    expect(parsed).toMatchObject({ kind: "multi", count: 1, path: out });
    expect(readFileSync(out).toString()).toBe("PNG-PAGE");
  });
});
