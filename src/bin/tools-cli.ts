/**
 * `tools --tokens` subcommand: print the size of the tool definitions the MCP
 * server advertises for the active preset (so the owner can see the context cost).
 * @module bin/tools-cli
 */
import { parseCaps } from "../server/caps.js";
import { parsePreset } from "../server/presets.js";
import { formatSizeTable, measureSurface, toolGroupMap } from "../server/tool-sizes.js";
import { presetFromFlag } from "./preset-flag.js";

type Values = Record<string, unknown>;

/**
 * Run `fuse-browser tools --tokens [--preset <name>]`. The active surface is the
 * preset (flag, else `FUSE_PRESET`, else `full`) narrowed by `FUSE_CAPS`.
 *
 * @param values - Parsed CLI option values.
 */
export async function runToolsCli(values: Values): Promise<void> {
  const preset = presetFromFlag(values.preset) ?? parsePreset(process.env.FUSE_PRESET);
  const caps = parseCaps(process.env.FUSE_CAPS);
  const [sizes, groups] = await Promise.all([measureSurface(preset, caps), toolGroupMap()]);
  const capsLabel = process.env.FUSE_CAPS?.trim() ? `, FUSE_CAPS=${process.env.FUSE_CAPS.trim()}` : "";
  process.stdout.write(formatSizeTable(sizes, groups, `preset ${preset}${capsLabel}`));
}
