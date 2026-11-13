/**
 * Screenshot tool: returns a PNG as MCP image content. Optionally targets a single element by `ref`, or captures across one/several viewports (responsive).
 * @module server/tools/screenshot
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { guardRef } from "../../actions/ref-guard.js";
import { refLocator } from "../../actions/ref-locator.js";
import { registryFor } from "../../actions/ref-registry.js";
import { annotatedScreenshot } from "../../extraction/annotate.js";
import { captureSnapshotFull } from "../../extraction/snapshot.js";
import { applyColorScheme } from "../../lib/color-scheme.js";
import { type ViewportInput, resolveViewport, viewportLabel } from "../../engine/viewport.js";
import type { SessionManager } from "../../session/manager.js";
import { settleForCapture } from "../../state/settle-capture.js";
import { errorResult } from "../result.js";
import {
  annotatedScreenshotResult,
  elementScreenshotResult,
  multiScreenshotResult,
  pageScreenshotResult,
  screenshotOutputShape,
} from "./screenshot-result.js";
import { validateMultiViewportPath, withOptionalWrite } from "./screenshot-write.js";
import { withSession } from "./with-session.js";

const VIEWPORT_SCHEMA = z.union([
  z.enum(["mobile", "tablet", "desktop"]),
  z.object({ width: z.number().int(), height: z.number().int() }),
]);

/** Register `browser_screenshot`. */
export function registerScreenshotTool(server: McpServer, sessions: SessionManager): void {
  server.registerTool(
    "browser_screenshot",
    {
      title: "Screenshot",
      description:
        "Capture the live page as PNG(s) for vision. Pass `ref` for one element, `viewport` for one size, or `viewports` (e.g. [\"mobile\",\"desktop\"]) for a responsive set. Pass `colorScheme` (\"light\"|\"dark\") to capture a theme — emulates `prefers-color-scheme` AND toggles the `themeClass` (default \"dark\") on <html> for Tailwind/shadcn class themes, then restores. Pass `path` to also write the image to disk (single-image captures only — rejected when `viewports.length>1`); its extension must match the output mime (`.png`, or `.jpg`/`.jpeg` for `annotate`).",
      inputSchema: {
        sessionId: z.string(),
        fullPage: z.boolean().optional(),
        ref: z.union([z.number().int(), z.string()]).optional(),
        viewport: VIEWPORT_SCHEMA.optional(),
        viewports: z.array(VIEWPORT_SCHEMA).optional(),
        colorScheme: z.enum(["light", "dark"]).optional(),
        themeClass: z.string().optional(),
        annotate: z.boolean().optional(),
        path: z.string().optional(),
      },
      outputSchema: screenshotOutputShape,
    },
    async (args) => {
      const a = args as Record<string, unknown>;
      const path = typeof a.path === "string" && a.path.length > 0 ? a.path : undefined;
      return withSession(sessions, String(a.sessionId), async (s) => {
        const scheme = a.colorScheme as "light" | "dark" | undefined;
        const restore = scheme
          ? await applyColorScheme(s.page, scheme, a.themeClass ? String(a.themeClass) : undefined)
          : null;
        try {
          if (typeof a.ref === "number" || typeof a.ref === "string") {
            const ref = a.ref;
            const stale = await guardRef(s.page, ref);
            if (stale) return errorResult(`ref_stale (${String(stale.reason)}): ${String(stale.hint)}`, "ref_stale");
            const locator = refLocator(s.page, ref);
            if (!locator || (await locator.count()) === 0) return errorResult("ref_not_found");
            const buf = await locator.screenshot({ timeout: 5_000 });
            return withOptionalWrite(path, buf, "image/png", () => elementScreenshotResult(buf.toString("base64"), ref, path));
          }
          const fullPage = Boolean(a.fullPage);
          const list = (Array.isArray(a.viewports) ? a.viewports : a.viewport ? [a.viewport] : []) as ViewportInput[];
          const multiErr = validateMultiViewportPath(path, list.length);
          if (multiErr) return multiErr;
          if (list.length === 0) {
            if (a.annotate === true) {
              registryFor(s.page).begin(await captureSnapshotFull(s.page));
              const shot = await annotatedScreenshot(s.page);
              const data = Buffer.from(shot.base64, "base64");
              return withOptionalWrite(path, data, "image/jpeg", () => annotatedScreenshotResult(shot.base64, s.page.url(), shot.marks, path));
            }
            const buffer = await s.page.screenshot({ fullPage });
            return withOptionalWrite(path, buffer, "image/png", () => pageScreenshotResult(buffer.toString("base64"), s.page.url(), path));
          }
          const original = s.page.viewportSize();
          const shots: Array<{ base64: string; note: string }> = [];
          let lastBuf: Buffer<ArrayBufferLike> = Buffer.alloc(0);
          for (const v of list) {
            await s.page.setViewportSize(resolveViewport(v));
            await settleForCapture(s.page);
            const buf = await s.page.screenshot({ fullPage, animations: "disabled" });
            shots.push({ base64: buf.toString("base64"), note: viewportLabel(v) });
            lastBuf = buf;
          }
          if (original) await s.page.setViewportSize(original);
          return withOptionalWrite(path, lastBuf, "image/png", () => multiScreenshotResult(shots, path));
        } finally {
          if (restore) await restore();
        }
      });
    },
  );
}
