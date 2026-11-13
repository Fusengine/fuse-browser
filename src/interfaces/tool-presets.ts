/**
 * Types for the MCP tool-surface controls: task presets and the advertised
 * tool-definition size report (`fuse-browser tools --tokens`).
 * @module interfaces/tool-presets
 */
import type { CapGroup } from "../server/caps.js";

/** A named, task-shaped subset of the tool surface. */
export interface ToolPreset {
  /** One-line description shown in docs and `--help`. */
  readonly description: string;
  /** Capability groups the preset registers (a subset of {@link CapGroup}). */
  readonly groups: readonly CapGroup[];
  /** Explicit tool allow-list within those groups; absent = every tool of the groups. */
  readonly tools?: readonly string[];
}

/** Advertised definition size of one tool. */
export interface ToolSize {
  /** Tool name. */
  readonly name: string;
  /** UTF-8 bytes of the compact JSON of name + description + inputSchema + outputSchema. */
  readonly bytes: number;
  /** Estimated tokens: `ceil(bytes / 4)`. An estimate, not a tokenizer count. */
  readonly tokens: number;
  /** UTF-8 bytes of the whole advertised tool object (adds title, annotations, ...). */
  readonly fullBytes: number;
}

/** Sum of a set of {@link ToolSize} entries. */
export interface ToolSizeTotal {
  /** Number of tools summed. */
  readonly tools: number;
  /** Total definition bytes. */
  readonly bytes: number;
  /** Total estimated tokens (`ceil(bytes / 4)` of the total). */
  readonly tokens: number;
  /** Total bytes of the whole advertised tool objects. */
  readonly fullBytes: number;
}
