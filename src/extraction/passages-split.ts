/**
 * Split extracted markdown (or plain text) into heading-scoped passages: the
 * unit that `passages-bm25` ranks. Pure.
 * @module extraction/passages-split
 */
import type { PassageChunk } from "../interfaces/passages.js";

/** Soft cap of a chunk: paragraphs of one section are grouped up to this many characters. */
export const MAX_CHUNK_CHARS = 900;

/** A code-fence line: up to 3 spaces, 3+ backticks or tildes, then the (possibly empty) info string. */
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/** Longest heading kept (characters): bounds the inline-markdown strip below on hostile lines. */
const MAX_HEADING_CHARS = 200;

/**
 * Text of an ATX heading line (`#`..`######` after at most 3 spaces, then a space or tab,
 * optional closing `#`s), or null when the line is not a heading. One linear pass — a
 * regex with lazy + trailing-whitespace groups is cubic on a line of many spaces.
 */
function headingText(line: string): string | null {
  let i = 0;
  while (i < 3 && line[i] === " ") i++;
  let hashes = 0;
  while (line[i + hashes] === "#") hashes++;
  const after = line[i + hashes];
  if (hashes < 1 || hashes > 6 || (after !== " " && after !== "\t")) return null;
  let text = line.slice(i + hashes);
  let end = text.length;
  while (end > 0 && text[end - 1] === "#") end--;
  if (end < text.length && (end === 0 || text[end - 1] === " " || text[end - 1] === "\t")) text = text.slice(0, end); // closing sequence
  return text.trim();
}

/** Heading text without inline markdown (links, emphasis, code ticks), capped at {@link MAX_HEADING_CHARS}. */
function plainHeading(raw: string): string {
  return raw
    .slice(0, MAX_HEADING_CHARS)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .trim();
}

/** Group a section's paragraphs into chunks of at most {@link MAX_CHUNK_CHARS} (a longer paragraph stays whole). */
function chunkParagraphs(heading: string, body: string[]): PassageChunk[] {
  const paragraphs = body
    .join("\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: PassageChunk[] = [];
  let current = "";
  for (const p of paragraphs) {
    if (current && current.length + p.length + 2 > MAX_CHUNK_CHARS) {
      out.push({ heading, text: current });
      current = "";
    }
    current = current ? `${current}\n\n${p}` : p;
  }
  if (current) out.push({ heading, text: current });
  return out;
}

/**
 * Split `markdown` at ATX headings (`#`..`######`, ignored inside code fences).
 * Text before the first heading has heading `""`; a heading with no body yields nothing.
 *
 * @param markdown - Extracted markdown or plain text.
 * @returns Passage candidates in document order.
 */
export function splitPassages(markdown: string): PassageChunk[] {
  const chunks: PassageChunk[] = [];
  let heading = "";
  let body: string[] = [];
  let fence: { ch: string; len: number } | null = null;
  const flush = (): void => {
    chunks.push(...chunkParagraphs(heading, body));
    body = [];
  };
  for (const line of markdown.split(/\r?\n/)) {
    const f = FENCE.exec(line);
    const marks = f?.[1] ?? "";
    if (fence) {
      // CommonMark: the closing fence has the same character, is at least as long, and carries no info string.
      if (marks[0] === fence.ch && marks.length >= fence.len && (f?.[2] ?? "").trim() === "") fence = null;
    } else if (f && !(marks[0] === "`" && (f[2] ?? "").includes("`"))) {
      // CommonMark 0.31.2: the info string of a BACKTICK fence may not contain a backtick ("```js``` x" is inline code).
      fence = { ch: marks[0] ?? "`", len: marks.length };
    }
    const h = fence || f ? null : headingText(line);
    if (h !== null) {
      flush();
      heading = plainHeading(h);
    } else {
      body.push(line);
    }
  }
  flush();
  return chunks;
}
