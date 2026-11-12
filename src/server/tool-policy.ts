/**
 * Central interception of `McpServer.registerTool`: every registration passes
 * through here so annotations (from {@link TOOL_ANNOTATIONS}) and the preset's
 * tool allow-list are applied in ONE place, without touching the tool files.
 * @module server/tool-policy
 */
import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { TOOL_ANNOTATIONS } from "./tool-annotations.js";

/** The slice of a `registerTool` config this module reads and rewrites. */
interface ToolConfig {
  annotations?: ToolAnnotations;
  [key: string]: unknown;
}

type RegisterTool = (name: string, config: ToolConfig, cb: unknown) => RegisteredTool;

/**
 * Wrap `server.registerTool` so each registration gets its central annotations
 * (the table wins over any per-tool annotations) and tools outside `allowed`
 * are registered then removed (they never appear in `tools/list`).
 *
 * Call it before any tool group registers.
 *
 * @param server - The MCP server whose `registerTool` is wrapped.
 * @param allowed - Tool allow-list, or `undefined` to keep every tool.
 */
export function installToolPolicy(server: McpServer, allowed?: ReadonlySet<string>): void {
  const original = server.registerTool.bind(server) as unknown as RegisterTool;
  const wrapped: RegisterTool = (name, config, cb) => {
    const annotations = TOOL_ANNOTATIONS[name] ?? config.annotations;
    const registered = original(name, annotations ? { ...config, annotations } : config, cb);
    if (allowed && !allowed.has(name)) registered.remove();
    return registered;
  };
  (server as unknown as { registerTool: RegisterTool }).registerTool = wrapped;
}
