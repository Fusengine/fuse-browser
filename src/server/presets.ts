/**
 * Task presets: named subsets of the MCP tool surface, selected by the
 * `FUSE_PRESET` env var or the `browser-mcp --preset <name>` flag. A preset
 * only narrows what is registered; it never renames or changes a tool.
 * Default is `full` (every tool, unchanged). `FUSE_CAPS` still applies on top:
 * a tool is registered only when both the preset and `FUSE_CAPS` allow it.
 * @module server/presets
 */
import type { ToolPreset } from "../interfaces/tool-presets.js";
import { CAP_GROUPS } from "./caps.js";

/** Every preset, keyed by name. */
export const PRESETS = {
  full: {
    description: "Every tool (default).",
    groups: CAP_GROUPS,
  },
  docs: {
    description: "Read documentation: HTTP fast-path fetch/crawl plus SERP search. No browser sessions.",
    groups: ["batch"],
    tools: ["browser_fetch", "browser_fetch_batch", "browser_crawl", "browser_map", "browser_serp_batch"],
  },
  qa: {
    description: "Test a running webapp: session, navigation, actions, snapshot, screenshot, console/network, visual diff.",
    groups: ["core", "debug"],
    tools: [
      "browser_open",
      "browser_status",
      "browser_close",
      "browser_navigate",
      "browser_back",
      "browser_forward",
      "browser_click",
      "browser_fill",
      "browser_scroll",
      "browser_press",
      "browser_type",
      "browser_select",
      "browser_wait",
      "browser_wait_for",
      "browser_act",
      "browser_snapshot",
      "browser_find",
      "browser_verify",
      "browser_screenshot",
      "browser_console",
      "browser_network",
      "browser_visual_diff",
    ],
  },
} as const satisfies Record<string, ToolPreset>;

/** A known preset name. */
export type PresetName = keyof typeof PRESETS;

/** Every preset name, in declaration order. */
export const PRESET_NAMES = Object.keys(PRESETS) as PresetName[];

/** The definition of preset `name`. */
export function getPreset(name: PresetName): ToolPreset {
  return PRESETS[name];
}

/** Whether `value` names a known preset. */
export function isPresetName(value: string): value is PresetName {
  return (PRESET_NAMES as string[]).includes(value);
}

/**
 * Parse a `FUSE_PRESET` value. Blank/undefined = `full`. An unknown name is
 * reported on stderr (stdout is reserved for JSON-RPC) and falls back to `full`
 * rather than an empty or half-configured server.
 *
 * @param raw - The raw env value.
 * @returns The preset to apply.
 */
export function parsePreset(raw: string | undefined): PresetName {
  const name = (raw ?? "").trim().toLowerCase();
  if (!name) return "full";
  if (isPresetName(name)) return name;
  console.error(`fuse-browser: unknown FUSE_PRESET "${name}" (known: ${PRESET_NAMES.join(", ")}); using "full"`);
  return "full";
}
