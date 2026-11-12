/**
 * Test helper: real MCP tools wired exactly as a tool owner would wire the
 * output budget (shapes spread into the schemas + one `budgetResult` call),
 * driven through the real protocol with an in-memory client.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BUDGET_INPUT_SHAPE, BUDGET_OUTPUT_SHAPE, budgetResult } from "../../../src/server/output-budget.js";

/** ~40 paragraphs separated by blank lines. */
export const TEXT = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} ${"lorem ipsum ".repeat(8).trim()}.`).join("\n\n");
/** Multi-byte text (2-, 3- and 4-byte characters). */
export const MULTIBYTE = "é日本語🙂 ".repeat(200);
/** A literal U+FFFD run and a lone surrogate: both must survive paging untouched. */
export const TRICKY = "��bbbbb ab\uD800cdefghijkl �x";
/** 30 small structured items. */
export const ITEMS = Array.from({ length: 30 }, (_, i) => ({ ref: String(i), name: `element-${i}`, role: "button" }));

export type Out = Record<string, unknown>;
export type Called = { content: Array<{ type: string; text: string }>; structuredContent: Out };

const elementShape = z.object({ ref: z.string(), name: z.string(), role: z.string() });

/** Server with `big_text` (string field), `big_list` (array field) and `multibyte` tools. */
export async function budgetClient(): Promise<Client> {
  const server = new McpServer({ name: "t", version: "0" });
  const make = (name: string, payload: Out, field: string, shape: z.ZodRawShape) =>
    server.registerTool(
      name,
      { inputSchema: { ...BUDGET_INPUT_SHAPE }, outputSchema: { ...shape, ...BUDGET_OUTPUT_SHAPE } },
      async (args) => budgetResult(name, payload, field, args as Out),
    );
  make("big_text", { url: "https://x.test/", text: TEXT }, "text", { url: z.string(), text: z.string() });
  make("big_list", { count: ITEMS.length, elements: ITEMS }, "elements", { count: z.number(), elements: z.array(elementShape) });
  make("multibyte", { text: MULTIBYTE }, "text", { text: z.string() });
  make("tricky", { text: TRICKY }, "text", { text: z.string() });
  // A tool with its own `truncated` (element cap, maxChars...): the budget must leave it alone.
  make("own_false", { truncated: false, text: TEXT }, "text", { truncated: z.boolean(), text: z.string() });
  make("own_true", { truncated: true, text: "short" }, "text", { truncated: z.boolean(), text: z.string() });
  make("scalar", { count: 3 }, "count", { count: z.number() });
  make("absent_field", { count: 3 }, "text", { count: z.number() });
  make("with_undefined", { items: [{ a: 1 }, undefined, { a: 3 }] }, "items", { items: z.array(z.unknown()) });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: "c", version: "0" });
  await Promise.all([server.connect(st), c.connect(ct)]);
  return c;
}

/** Call a tool and type the result. */
export async function call(c: Client, name: string, args: Out = {}): Promise<Called> {
  return (await c.callTool({ name, arguments: args })) as Called;
}
