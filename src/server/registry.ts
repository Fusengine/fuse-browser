/**
 * Maps every MCP tool registration to its capability group. Used by the
 * server factory to register only the groups enabled via `FUSE_CAPS`.
 * @module server/registry
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SessionManager } from "../session/manager.js";
import type { CapGroup } from "./caps.js";
import { registerActTools } from "./tools/act.js";
import { registerAutoScrollTool } from "./tools/autoscroll.js";
import { registerCollectTool } from "./tools/collect.js";
import { registerClipboardTool } from "./tools/clipboard.js";
import { registerCollectBatchTool } from "./tools/collect-batch.js";
import { registerConnectTool } from "./tools/connect.js";
import { registerCookiesTool } from "./tools/cookies.js";
import { registerCrawlTool } from "./tools/crawl.js";
import { registerDialogTools } from "./tools/dialogs.js";
import { registerExtractTool } from "./tools/extract.js";
import { registerExtractSchemaTool } from "./tools/extract-schema.js";
import { registerFetchTool } from "./tools/fetch.js";
import { registerFetchBatchTool } from "./tools/fetch-batch.js";
import { registerFindTool } from "./tools/find.js";
import { registerHandoffTool } from "./tools/handoff.js";
import { registerInspectTool } from "./tools/inspect.js";
import { registerLiveViewTool } from "./tools/live-view.js";
import { registerMapTool } from "./tools/map.js";
import { registerLogTools } from "./tools/logs.js";
import { registerMetricsTool } from "./tools/metrics.js";
import { registerNavigateTool } from "./tools/navigate.js";
import { registerPdfTool } from "./tools/pdf.js";
import { registerPermissionsTool } from "./tools/permissions.js";
import { registerProbeTools } from "./tools/probe.js";
import { registerProductsTool } from "./tools/products.js";
import { registerRouteTool } from "./tools/route.js";
import { registerRunTool } from "./tools/run.js";
import { registerScreenshotTool } from "./tools/screenshot.js";
import { registerSerpBatchTool } from "./tools/serp-batch.js";
import { registerSessionTools } from "./tools/session.js";
import { registerShotsBatchTool } from "./tools/shots-batch.js";
import { registerSiteShotsTool } from "./tools/site-shots.js";
import { registerSnapshotTools } from "./tools/snapshot.js";
import { registerTabsTool } from "./tools/tabs.js";
import { registerVaultTool } from "./tools/vault.js";
import { registerVerifyTool } from "./tools/verify.js";
import { registerVisualDiffTool } from "./tools/visual-diff.js";
import { registerWaitTool } from "./tools/wait.js";

/** Build the per-group registration thunks for `server` + `sessions`. */
export function toolGroups(
  server: McpServer,
  sessions: SessionManager,
): Record<CapGroup, Array<() => void>> {
  return {
    core: [
      () => registerSessionTools(server, sessions),
      () => registerConnectTool(server, sessions),
      () => registerNavigateTool(server, sessions),
      () => registerActTools(server, sessions),
      () => registerTabsTool(server, sessions),
      () => registerDialogTools(server, sessions),
      () => registerSnapshotTools(server, sessions),
      () => registerFindTool(server, sessions),
      () => registerVerifyTool(server, sessions),
      () => registerWaitTool(server, sessions),
      () => registerScreenshotTool(server, sessions),
      () => registerAutoScrollTool(server, sessions),
      () => registerVaultTool(server, sessions),
    ],
    batch: [
      () => registerProbeTools(server),
      () => registerFetchTool(server),
      () => registerFetchBatchTool(server),
      () => registerCrawlTool(server),
      () => registerMapTool(server),
      () => registerCollectBatchTool(server),
      () => registerShotsBatchTool(server),
      () => registerSiteShotsTool(server),
      () => registerSerpBatchTool(server),
    ],
    extract: [
      () => registerCollectTool(server, sessions),
      () => registerRunTool(server, sessions),
      () => registerExtractTool(server, sessions),
      () => registerExtractSchemaTool(server, sessions),
      () => registerProductsTool(server, sessions),
    ],
    debug: [
      () => registerInspectTool(server, sessions),
      () => registerLogTools(server, sessions),
      () => registerVisualDiffTool(server, sessions),
      () => registerMetricsTool(server),
      () => registerPdfTool(server, sessions),
      () => registerCookiesTool(server, sessions),
      () => registerRouteTool(server, sessions),
      () => registerPermissionsTool(server, sessions),
      () => registerClipboardTool(server, sessions),
    ],
    live: [
      () => registerHandoffTool(server, sessions),
      () => registerLiveViewTool(server, sessions),
    ],
  };
}
