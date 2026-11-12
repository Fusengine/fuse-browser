/**
 * Central MCP tool-annotation table: one entry per registered tool, applied at
 * registration by {@link installToolPolicy} so the 40+ tool files stay untouched.
 *
 * Semantics (MCP `ToolAnnotations` are HINTS, never a security boundary):
 *  - `readOnlyHint`    true = no write side effect on ANY input: not the page, the remote
 *                      site, nor the disk (a caller `path`, `harPath`/`outputDir`, saved shots).
 *  - `destructiveHint` may trigger irreversible effects (submit, delete, clear).
 *  - `idempotentHint`  repeating the same call has no further effect.
 *  - `openWorldHint`   reaches the open web / third-party sites.
 *
 * Every entry sets `readOnlyHint` explicitly. The other hints are emitted only
 * when they differ from the MCP spec default (destructive: true, idempotent:
 * false, openWorld: true) and, for read-only tools, only `openWorldHint`
 * (destructive/idempotent are "meaningful only when readOnlyHint == false"):
 * every annotation byte is paid in each client's context on each `tools/list`.
 * @module server/tool-annotations
 */
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

/** A tool that only observes. `open` = it reaches the open web. */
const read = (open: boolean): ToolAnnotations => ({
  readOnlyHint: true,
  ...(open ? {} : { openWorldHint: false }),
});

/** A tool that changes state. */
const write = (
  open: boolean,
  { destructive = false, idempotent = false }: { destructive?: boolean; idempotent?: boolean } = {},
): ToolAnnotations => ({
  readOnlyHint: false,
  ...(destructive ? {} : { destructiveHint: false }),
  ...(idempotent ? { idempotentHint: true } : {}),
  ...(open ? {} : { openWorldHint: false }),
});

/** Annotations for every tool, keyed by tool name. */
export const TOOL_ANNOTATIONS: Readonly<Record<string, ToolAnnotations>> = {
  // core: session lifecycle
  browser_open: write(false),
  browser_status: read(false),
  browser_close: write(false, { idempotent: true }),
  browser_connect: write(false),
  // core: navigation
  browser_navigate: write(true, { idempotent: true }),
  browser_back: write(true),
  browser_forward: write(true),
  // core: page actions
  browser_click: write(true, { destructive: true }),
  browser_fill: write(true, { idempotent: true }),
  browser_scroll: write(false, { idempotent: true }),
  browser_press: write(true, { destructive: true }),
  browser_type: write(true),
  browser_select: write(true, { idempotent: true }),
  browser_act: write(true, { destructive: true }),
  browser_login: write(true),
  browser_autoscroll: write(true, { idempotent: true }),
  // core: observation and session state
  browser_wait: read(false),
  browser_wait_for: read(false),
  browser_snapshot: read(false),
  browser_find: read(false),
  browser_verify: write(true), // navigates the open web and writes evidence files
  browser_screenshot: write(false), // `path` writes a file
  browser_downloads: read(false),
  browser_vault: read(false),
  browser_tabs: write(false),
  browser_dialog: write(false, { idempotent: true }),
  // batch: fast-path and one-shot reads
  // probe*, serp_batch, shots_batch, site_shots write screenshots and accept harPath/outputDir
  browser_probe: write(true),
  browser_probe_html: write(false),
  browser_fetch: read(true),
  browser_fetch_batch: read(true),
  browser_crawl: read(true),
  browser_map: read(true),
  browser_collect_batch: read(true),
  browser_shots_batch: write(true),
  browser_site_shots: write(true),
  browser_serp_batch: write(true),
  // extract
  browser_collect: write(true, { idempotent: true }),
  browser_run: write(true, { destructive: true }),
  browser_extract: read(false),
  browser_extract_schema: read(false),
  browser_products: read(false),
  // debug
  browser_inspect: read(false),
  browser_console: read(false),
  browser_network: read(false),
  browser_visual_diff: write(false),
  browser_metrics: write(false),
  browser_pdf: write(false, { idempotent: true }),
  browser_cookies: write(false, { destructive: true, idempotent: true }),
  browser_route: write(false, { idempotent: true }),
  browser_permissions: write(false, { idempotent: true }),
  browser_clipboard: write(false, { idempotent: true }),
  // live
  browser_handoff: write(true),
  browser_live_view: write(false, { idempotent: true }),
  browser_live_view_stop: write(false, { idempotent: true }),
};
