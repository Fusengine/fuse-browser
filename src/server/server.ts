/**
 * Build the MCP server with all tools and resources registered.
 * @module server/server
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { VERSION } from "../lib/version.js";
import { SessionManager } from "../session/manager.js";
import { CAP_GROUPS, type CapGroup, parseCaps } from "./caps.js";
import { getPreset, parsePreset, type PresetName } from "./presets.js";
import { toolGroups } from "./registry.js";
import { registerResources } from "./resources.js";
import { installToolPolicy } from "./tool-policy.js";

/** The built server and its session manager (for shutdown). */
export interface BuiltServer {
  server: McpServer;
  sessions: SessionManager;
}

/** Overrides for {@link createServer}; each falls back to its env var. */
export interface ServerOptions {
  /** Task preset (default: `FUSE_PRESET`, else `full`). */
  preset?: PresetName;
  /** Capability groups (default: `FUSE_CAPS`, else all). */
  caps?: ReadonlySet<CapGroup>;
}

/**
 * Create the fuse-browser MCP server. The exposed tool surface can be narrowed
 * with a task preset (`FUSE_PRESET`, e.g. `docs`/`qa`) and/or capability groups
 * (`FUSE_CAPS`, e.g. `core,extract`); a tool is registered only when both allow
 * it. Resources are always registered. Every tool gets its central annotations.
 *
 * @param options - Optional preset/caps overrides (tests, diagnostics, CLI flag).
 */
export function createServer(options: ServerOptions = {}): BuiltServer {
  const server = new McpServer({ name: "fuse-browser", version: VERSION });
  const sessions = new SessionManager();
  const preset = getPreset(options.preset ?? parsePreset(process.env.FUSE_PRESET));
  const caps = options.caps ?? parseCaps(process.env.FUSE_CAPS);
  installToolPolicy(server, preset.tools ? new Set(preset.tools) : undefined);
  const groups = toolGroups(server, sessions);
  let enabled = CAP_GROUPS.filter((g) => caps.has(g) && preset.groups.includes(g));
  if (enabled.length === 0) {
    // Never an empty server (same rule as parseCaps): the preset wins over a disjoint FUSE_CAPS.
    console.error("fuse-browser: FUSE_CAPS and FUSE_PRESET select no common tool group; ignoring FUSE_CAPS");
    enabled = CAP_GROUPS.filter((g) => preset.groups.includes(g));
  }
  for (const group of enabled) for (const register of groups[group]) register();
  registerResources(server, sessions);
  return { server, sessions };
}
