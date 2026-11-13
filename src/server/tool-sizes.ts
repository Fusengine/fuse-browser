/**
 * Measure and print the size of the tool definitions an MCP client receives in
 * `tools/list` (what `fuse-browser tools --tokens` shows). Sizes are UTF-8 bytes
 * of compact JSON; tokens are ESTIMATED as `ceil(bytes / 4)` (no tokenizer).
 * @module server/tool-sizes
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolSize, ToolSizeTotal } from "../interfaces/tool-presets.js";
import { CAP_GROUPS, type CapGroup } from "./caps.js";
import type { PresetName } from "./presets.js";
import { type BuiltServer, createServer } from "./server.js";
import { estimateTokens, utf8Bytes } from "./token-estimate.js";

/** How the token column is computed; printed next to every table. */
export const ESTIMATE_NOTE = "tokens = ceil(UTF-8 bytes / 4), an estimate (no tokenizer); bytes = compact JSON of name+description+inputSchema+outputSchema";

const bytesOf = (value: unknown): number => utf8Bytes(JSON.stringify(value));

/** Size of one advertised tool. */
export function sizeTool(tool: Tool): ToolSize {
  const bytes = bytesOf({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
  });
  return { name: tool.name, bytes, tokens: estimateTokens(bytes), fullBytes: bytesOf(tool) };
}

/** Sum a set of sizes (tokens are re-estimated from the total bytes). */
export function totalSizes(sizes: readonly ToolSize[]): ToolSizeTotal {
  const bytes = sizes.reduce((sum, s) => sum + s.bytes, 0);
  const fullBytes = sizes.reduce((sum, s) => sum + s.fullBytes, 0);
  return { tools: sizes.length, bytes, tokens: estimateTokens(bytes), fullBytes };
}

/** Call `tools/list` on `built.server` through an in-memory client and close it. */
export async function listAdvertisedTools(built: BuiltServer): Promise<Tool[]> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "fuse-browser-tokens", version: "0.0.0" });
  await Promise.all([built.server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    return (await client.listTools()).tools;
  } finally {
    await client.close();
    await built.sessions.closeAll();
  }
}

/** Per-tool sizes of the advertised surface for `preset` (and optional `caps`). */
export async function measureSurface(preset: PresetName, caps?: ReadonlySet<CapGroup>): Promise<ToolSize[]> {
  return (await listAdvertisedTools(createServer({ preset, caps }))).map(sizeTool);
}

/** Map each tool name to the capability group that registers it. */
export async function toolGroupMap(): Promise<Map<string, CapGroup>> {
  const map = new Map<string, CapGroup>();
  for (const group of CAP_GROUPS) {
    for (const size of await measureSurface("full", new Set([group]))) map.set(size.name, group);
  }
  return map;
}

/**
 * Render the per-tool table (largest first), per-group subtotals and the total.
 *
 * @param sizes - Per-tool sizes of the active surface.
 * @param groups - Tool name to capability group.
 * @param label - Active preset/caps label for the header.
 */
export function formatSizeTable(sizes: readonly ToolSize[], groups: ReadonlyMap<string, CapGroup>, label: string): string {
  const rows = [...sizes].sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
  const lines = [`fuse-browser tool definitions (${label})`, ESTIMATE_NOTE, ""];
  lines.push(`${"tool".padEnd(26)}${"group".padEnd(9)}${"bytes".padStart(8)}${"~tokens".padStart(9)}`);
  for (const r of rows) {
    lines.push(`${r.name.padEnd(26)}${(groups.get(r.name) ?? "?").padEnd(9)}${String(r.bytes).padStart(8)}${String(r.tokens).padStart(9)}`);
  }
  lines.push("", "per group:");
  for (const group of CAP_GROUPS) {
    const subset = sizes.filter((s) => groups.get(s.name) === group);
    if (subset.length === 0) continue;
    const t = totalSizes(subset);
    lines.push(`${group.padEnd(26)}${`${t.tools} tools`.padEnd(9)}${String(t.bytes).padStart(8)}${String(t.tokens).padStart(9)}`);
  }
  const all = totalSizes(sizes);
  lines.push(`${"TOTAL".padEnd(26)}${`${all.tools} tools`.padEnd(9)}${String(all.bytes).padStart(8)}${String(all.tokens).padStart(9)}`);
  lines.push(`(whole advertised tool objects incl. title/annotations: ${all.fullBytes} bytes, ~${estimateTokens(all.fullBytes)} tokens)`);
  return `${lines.join("\n")}\n`;
}
