/**
 * The one token-estimate method used across the server (`fuse-browser tools
 * --tokens` and the `maxTokens` output budget): `ceil(UTF-8 bytes / 4)`. It is
 * an ESTIMATE; no tokenizer is bundled.
 * @module server/token-estimate
 */

/** Bytes per estimated token. */
export const BYTES_PER_TOKEN = 4;

/** Estimated tokens for `bytes` UTF-8 bytes. */
export function estimateTokens(bytes: number): number {
  return Math.ceil(bytes / BYTES_PER_TOKEN);
}

/** UTF-8 byte length of `text`. */
export function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}
