/**
 * Calls a REAL registered MCP tool in-process: a fresh `McpServer` with only the
 * given registration(s), driven through an in-memory MCP client — so input
 * validation, the handler and the output schema all run, as in production.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/** Loosely typed `structuredContent` of a tool result (assertions narrow it). */
// biome-ignore lint/suspicious/noExplicitAny: test-only access to arbitrary tool output
export type ToolOut = Record<string, any>;

/** A tool call outcome. */
export interface ToolCall {
  isError: boolean;
  /** `structuredContent` (empty object when absent). */
  out: ToolOut;
  /** Raw JSON text block of the result. */
  text: string;
}

/**
 * Call tool `name` with `args` on a server that registered only `register`.
 *
 * @param register - Registration function(s), e.g. `registerFetchTool`.
 * @param name - Tool name.
 * @param args - Tool arguments.
 */
export async function callTool(register: ((s: McpServer) => void) | Array<(s: McpServer) => void>, name: string, args: Record<string, unknown>): Promise<ToolCall> {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  for (const r of Array.isArray(register) ? register : [register]) r(server);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(st), client.connect(ct)]);
  try {
    const res = await client.callTool({ name, arguments: args });
    const block = (res.content as Array<{ type: string; text?: string }>)[0];
    return { isError: res.isError === true, out: (res.structuredContent ?? {}) as ToolOut, text: block?.text ?? "" };
  } finally {
    await client.close();
    await server.close();
  }
}
