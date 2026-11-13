/**
 * Strict handling of the `--preset <name>` CLI flag shared by both bin entry
 * points (the env var is forgiving, an explicit flag typo is an error).
 * @module bin/preset-flag
 */
import { isPresetName, PRESET_NAMES, type PresetName } from "../server/presets.js";

/**
 * Validate a `--preset` flag value.
 *
 * @param value - The parsed flag value (`undefined` when the flag is absent).
 * @returns The preset, or `undefined` when the flag is absent. Exits(1) on an unknown name.
 */
export function presetFromFlag(value: unknown): PresetName | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim().toLowerCase();
  if (isPresetName(name)) return name;
  process.stderr.write(`error: unknown preset '${value}' (known: ${PRESET_NAMES.join(", ")})\n`);
  process.exit(1);
}
