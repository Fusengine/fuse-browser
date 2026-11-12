/**
 * `outputMode:"file"`: write the full value of a big output field under the
 * output dir and return `{path, bytes, preview}` instead of the content. The
 * path is chosen by the server (content-addressed under `<outputDir>/offload/`),
 * never by the caller, and goes through the same write guard as the other
 * caller-visible writes (`FUSE_CONFINE_WRITES`, `O_NOFOLLOW`).
 * @module server/output-offload
 */
import { join } from "node:path";
import { sha1 } from "../lib/fs.js";
import { resolveDefaultOutputDir } from "../lib/output-dir.js";
import { checkWriteConfinement, writeConfinedBytes } from "../lib/write-guard.js";

/** Characters of the field returned inline as a preview (about 100 estimated tokens). */
export const PREVIEW_CHARS = 400;

/** First {@link PREVIEW_CHARS} characters of `text`, never ending on half a surrogate pair. */
function head(text: string): string {
  const cut = text.slice(0, PREVIEW_CHARS);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/**
 * Offload `payload[field]` to a file. On a refused or failed write nothing is
 * written and the payload comes back unchanged with `outputError` set.
 *
 * @param tool - Tool name (file name prefix).
 * @param payload - The tool's full result payload.
 * @param field - The big field (string or array) to offload.
 * @returns The payload with `field` replaced by a preview (string) or `[]` (array), plus `outputMode`, `path`, `bytes`, `preview`.
 */
export function offloadField(tool: string, payload: Record<string, unknown>, field: string): Record<string, unknown> {
  const value = payload[field];
  const isText = typeof value === "string";
  const content = isText ? value : JSON.stringify(value);
  const dir = join(process.env.FUSE_OUTPUT_DIR || resolveDefaultOutputDir(), "offload");
  const name = `${tool.replace(/[^a-z0-9_-]/gi, "_")}-${sha1(content).slice(0, 12)}${isText ? ".txt" : ".json"}`;
  const path = join(dir, name);
  const refused = checkWriteConfinement(path);
  if (refused) return { ...payload, outputError: "path_outside_confinement" };
  const bytes = Buffer.from(content, "utf8");
  try {
    writeConfinedBytes(path, bytes);
  } catch {
    return { ...payload, outputError: "write_failed" };
  }
  const preview = head(content);
  return { ...payload, [field]: isText ? preview : [], outputMode: "file", path, bytes: bytes.length, preview };
}
