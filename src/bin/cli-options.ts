/**
 * The `parseArgs` option schema for the `fuse-browser` CLI. Extracted from
 * `cli.ts` so the entry point stays under the file-size limit. Every flag used
 * by any subcommand (batch or one-shot page command) is declared here.
 * @module bin/cli-options
 */
import type { parseArgs } from "node:util";

/** Option map type accepted by Node's `parseArgs`. */
type ParseArgsOptions = NonNullable<NonNullable<Parameters<typeof parseArgs>[0]>["options"]>;

/** Full flag schema shared by every CLI subcommand. */
export const CLI_OPTIONS: ParseArgsOptions = {
  engine: { type: "string" },
  country: { type: "string" },
  currency: { type: "string" },
  headed: { type: "boolean" },
  "auto-consent": { type: "boolean" },
  "extract-prices": { type: "boolean" },
  "detect-challenges": { type: "boolean" },
  "observe-visual": { type: "boolean" },
  "extract-serp": { type: "boolean" },
  "serp-pages": { type: "string" },
  "rank-domain": { type: "string" },
  csv: { type: "boolean" },
  viewports: { type: "string" },
  "settle-ms": { type: "string" },
  hl: { type: "string" },
  gl: { type: "string" },
  "delay-ms": { type: "string" },
  "human-mode": { type: "boolean" },
  approved: { type: "boolean" },
  replay: { type: "boolean" },
  "wait-ms": { type: "string" },
  "output-dir": { type: "string" },
  "storage-state": { type: "string" },
  proxy: { type: "string" },
  "browser-fallback": { type: "boolean" },
  text: { type: "boolean" },
  format: { type: "string" },
  concurrency: { type: "string" },
  "max-pages": { type: "string" },
  "max-depth": { type: "string" },
  "all-origins": { type: "boolean" },
  "no-robots": { type: "boolean" },
  "throttle-ms": { type: "string" },
  item: { type: "string" },
  container: { type: "string" },
  "max-steps": { type: "string" },
  "proxy-map": { type: "string" },
  "user-data-dir": { type: "string" },
  "site-memory-dir": { type: "string" },
  click: { type: "string", multiple: true },
  fill: { type: "string", multiple: true },
  steps: { type: "string" },
  "steps-file": { type: "string" },
  kind: { type: "string" },
  ref: { type: "string" },
  "full-page": { type: "boolean" },
  selectors: { type: "boolean" },
  output: { type: "string" },
  limit: { type: "string" },
  "block-resources": { type: "string" },
  tokens: { type: "boolean" },
  preset: { type: "string" },
};
