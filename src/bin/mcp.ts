#!/usr/bin/env node
/**
 * fuse-browser MCP server entry point (stdio transport).
 * @module bin/mcp
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { logger } from "../lib/logger.js";
import { createServer } from "../server/server.js";
import { PRESET_NAMES } from "../server/presets.js";
import { handleMetaFlags, parseArgsOrExit } from "./cli-meta.js";
import { presetFromFlag } from "./preset-flag.js";

// Resolve metadata flags before the stdio transport binds — any stdout write
// after `server.connect` would corrupt the MCP protocol stream.
const argv = process.argv.slice(2);
handleMetaFlags(argv, `usage: browser-mcp [--preset ${PRESET_NAMES.join("|")}] [--help] [--version]\n`);
const { values } = parseArgsOrExit({ args: argv, allowPositionals: true, options: { preset: { type: "string" } } });
const presetFlag = presetFromFlag(values.preset);

async function main(): Promise<void> {
  const { server, sessions } = createServer({ preset: presetFlag });
  let closing = false;
  const shutdown = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    await sessions.closeAll();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  await server.connect(new StdioServerTransport());
  logger.info("fuse-browser MCP server running on stdio");
}

main().catch((err) => {
  logger.error("fatal", { err: String(err) });
  process.exit(1);
});
