/**
 * The `fuse-browser` CLI help text. Kept in sync with the command routing in
 * `cli.ts` — every routed subcommand is listed here.
 * @module bin/cli-usage
 */

/** Full `--help` text: every one-shot subcommand plus the common options. */
export const CLI_USAGE = `fuse-browser <command> [options]

One-shot commands:
  probe <url>             Open a page and report text, screenshot, prices, challenges, SERP
  fetch <url>             Fast HTTP fetch (add --browser-fallback to retry in a browser)
  fetch-batch <url...>    Concurrent fetch of many URLs (--concurrency <n>)
  crawl <url>             Crawl same-origin pages (--max-pages <n> --max-depth <n>)
  collect-batch <url...>  Extract structured data from many URLs (--item --container)
  serp-batch <query...>   Google SERP scrape (--rank-domain <d> --serp-pages <n> --csv)
  shots <url>             Screenshot across --viewports mobile,tablet,desktop
  shots-batch <url...>    Screenshot many URLs (--concurrency <n>)
  site-shots <url>        Crawl a site and screenshot every page (--max-pages <n>)

Page commands (one-shot, JSON on stdout):
  run <url>               Execute a step plan (--steps '<json>' | --steps-file <path|->)
  products <url>          Extract product cards (--limit <n> --container <selector>)
  extract <url>           Pull page content (--kind text|prices|markdown)
  snapshot <url>          List interactive elements (--selectors for CSS selectors)
  screenshot <url>        Capture a PNG (--full-page, --output <file> or base64)
  inspect <url>           Computed style + WCAG contrast for one element (--ref <ref>)

MCP tool surface:
  tools --tokens          Print the size of the advertised tool definitions (--preset full|docs|qa)

Vault (local encrypted credentials — secrets never touch argv or the LLM):
  vault set <ref>         Store a credential (prompts: username/password/TOTP/origins)
  vault list              List stored refs — metadata only, no secrets
  vault rm <ref>          Delete a stored credential
  vault test <ref>        Print the current TOTP code + confirm the password is set

Common options:
  --engine <name>     playwright | patchright | firefox | webkit
  --country <cc>      Geo/locale identity (e.g. CH, FR)   --currency <code>   e.g. CHF, EUR
  --proxy <url>       Proxy URL          --proxy-map <file>   Country→proxy map
  --headed            Show the browser   --human-mode         Bézier cursor + human timing
  --extract-prices    Parse visible prices   --auto-consent    Dismiss cookie/consent walls
  --detect-challenges  Flag captchas/anti-bot   --wait-ms <n>    Settle delay
  --output-dir <dir>  Where to write shots/reports   --storage-state <file>  Reuse auth
  --text              Raw text instead of markdown   --format <fmt>   Output format

Session-based interaction (open/navigate/click/products/autoscroll/…) is exposed
through the MCP server: run the \`browser-mcp\` binary (or \`npm run mcp\`).

Flags: --help / -h, --version / -v
`;
