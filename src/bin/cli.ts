#!/usr/bin/env node
/**
 * fuse-browser CLI entry point. Subcommands: `probe`, `fetch`, `fetch-batch`,
 * `crawl`, `collect-batch`, `serp-batch`, `shots`, `shots-batch`, `site-shots`,
 * plus the one-shot page commands `run`, `products`, `extract`, `snapshot`,
 * `screenshot`, `inspect`.
 * @module bin/cli
 */
import { handleMetaFlags, parseArgsOrExit } from "./cli-meta.js";
import { CLI_OPTIONS } from "./cli-options.js";
import { routePageCommand } from "./cli-page-routes.js";
import { CLI_USAGE } from "./cli-usage.js";
import { runCollectBatchCli } from "./collect-batch-cli.js";
import { runCrawlCli } from "./crawl-cli.js";
import { runFetchBatchCli } from "./fetch-batch-cli.js";
import { runFetchCli } from "./fetch-cli.js";
import { runProbeCli } from "./probe-cli.js";
import { runSerpBatch } from "./serp-batch-cli.js";
import { runShotsBatch } from "./shots-batch-cli.js";
import { runShots } from "./shots-cli.js";
import { runSiteShotsCli } from "./site-shots-cli.js";
import { runToolsCli } from "./tools-cli.js";
import { runVaultCli } from "./vault-cli.js";

const argv = process.argv.slice(2);
handleMetaFlags(argv, CLI_USAGE);

const { positionals, values } = parseArgsOrExit({
  args: argv,
  allowPositionals: true,
  options: CLI_OPTIONS,
});

const [command, ...rest] = positionals;
const opts = values as Record<string, unknown>;

if (command === "serp-batch") {
  await runSerpBatch(rest, opts);
} else if (command === "site-shots" && rest[0]) {
  await runSiteShotsCli(rest[0], opts);
} else if (command === "shots-batch" && rest.length > 0) {
  await runShotsBatch(rest, opts);
} else if (command === "shots" && rest[0]) {
  await runShots(rest[0], opts);
} else if (command === "fetch-batch" && rest.length > 0) {
  await runFetchBatchCli(rest, opts);
} else if (command === "crawl" && rest[0]) {
  await runCrawlCli(rest[0], opts);
} else if (command === "collect-batch" && rest.length > 0) {
  await runCollectBatchCli(rest, opts);
} else if (command === "fetch" && rest[0]) {
  await runFetchCli(rest[0], opts);
} else if (command === "probe" && rest[0]) {
  await runProbeCli(rest[0], opts);
} else if (command === "tools" && opts.tokens) {
  await runToolsCli(opts);
} else if (command === "vault") {
  await runVaultCli(rest);
} else if (command && (await routePageCommand(command, rest, opts))) {
  // Handled by a one-shot page command (run/products/extract/snapshot/screenshot/inspect).
} else {
  process.stderr.write(CLI_USAGE);
  process.exit(1);
}
