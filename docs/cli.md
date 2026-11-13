# CLI

`fuse-browser` is a command-line front-end for the browser agent. It exposes 15 one-shot subcommands — nine batch/fast-path commands (`probe`, `fetch`, `fetch-batch`, `crawl`, `collect-batch`, `serp-batch`, `shots`, `shots-batch`, `site-shots`) plus six [page commands](#page-commands-one-shot) (`run`, `products`, `extract`, `snapshot`, `screenshot`, `inspect`) — plus [`tools --tokens`](#tools---tokens) and `vault` — that all share a single flag parser (`node:util` `parseArgs`, strict mode), so any flag is accepted globally but only consumed by the subcommands documented below. Stateful, multi-turn session interaction (open → navigate → click → snapshot → …) is exposed through the MCP server (`browser-mcp`), not the CLI.

```
fuse-browser probe <url> [flags]
fuse-browser fetch <url> [--extract-prices] [--proxy <url>]
fuse-browser serp-batch <query...> --rank-domain <domain> [flags]
fuse-browser shots <url> [--viewports mobile,desktop] [flags]
```

Output is JSON on stdout for every subcommand except `serp-batch --csv` (CSV). Guardrail-blocked probes print `BLOCKED: ...` to stderr and exit with code `2`. Invalid usage exits `1`.

---

## `probe <url>`

Runs one full agent probe against `url` (navigation, optional consent handling, optional extraction passes, optional scripted actions) and prints a compact JSON report.

```bash
fuse-browser probe https://example.com --extract-prices --observe-visual
```

Scripted actions are built from repeatable flags and run in order: all `--fill TARGET=VALUE` first, then all `--click TARGET`. A `--fill` value without `=` exits `1` with `--fill must be TARGET=VALUE`.

Applicable flags: `--engine`, `--country`, `--currency`, `--headed`, `--auto-consent`, `--extract-prices`, `--detect-challenges`, `--observe-visual`, `--extract-serp`, `--serp-pages`, `--rank-domain`, `--human-mode`, `--approved`, `--replay`, `--wait-ms`, `--output-dir`, `--storage-state`, `--proxy`, `--proxy-map`, `--user-data-dir`, `--site-memory-dir`, `--click`, `--fill`.

## `fetch <url>`

HTTP fast-path fetch using TLS impersonation (no full browser). Returns `status`, `url`, the response body truncated to the first 20,000 characters, and optional extracted prices. HTML is rendered to markdown by default; non-HTML responses (JSON, `text/plain`) are returned verbatim. The body download is capped at 10 MB. Pass `--browser-fallback` to re-render an empty SPA/CSR shell in a real browser (`escalated: true` in the output).

```bash
fuse-browser fetch https://example.com --extract-prices --proxy http://user:pass@host:8080
fuse-browser fetch https://app.example.com --browser-fallback   # render a client-side app
```

Applicable flags: `--proxy`, `--extract-prices`, `--browser-fallback`, `--text`, `--format <markdown|text>`.

## `fetch-batch <url...>`

Fetch multiple URLs in parallel via the HTTP fast-path (bounded concurrency, default 8). Prints `{ count, results }`; each result keeps `fetch` semantics, and a failed URL becomes `{ url, error }` without aborting the batch.

```bash
fuse-browser fetch-batch https://a.example https://b.example https://c.example --concurrency 5
```

Applicable flags: `--proxy`, `--browser-fallback`, `--text`, `--format <markdown|text>`, `--concurrency <n>`.

## `crawl <url>`

Bounded same-origin crawl from a seed URL via the HTTP fast-path (BFS, parallel per depth level). Prints `{ count, pages }`, one clean-markdown entry per page (with its `depth`). Same-origin and robots.txt-honored by default.

```bash
fuse-browser crawl https://docs.example.com --max-pages 30 --max-depth 2
```

Applicable flags: `--max-pages <n>`, `--max-depth <n>`, `--concurrency <n>`, `--throttle-ms <n>` (per-host gap, default 250, 0 disables), `--all-origins` (cross-origin), `--no-robots` (opt out of robots.txt), `--browser-fallback`, `--text`, `--format <markdown|text>`, `--proxy`.

## `shots-batch <url...>`

Full-page responsive screenshots for multiple URLs in parallel (real browser per page, low concurrency by default). Prints `{ count, results }` with saved PNG paths per URL.

```bash
fuse-browser shots-batch https://a.example https://b.example --viewports mobile,desktop --concurrency 2
```

Applicable flags: `--viewports`, `--settle-ms`, `--concurrency`, `--engine`, `--country`, `--headed`, `--output-dir`, `--proxy`.

## `collect-batch <url...>`

Exhaust the infinite-scroll/paginated list of multiple URLs in parallel (one real browser per URL). Requires `--item` (the row CSS selector). Prints `{ count, results }` with collected items per URL.

```bash
fuse-browser collect-batch "https://site/search?q=x" --item ".listing-card" --extract-prices
```

Applicable flags: `--item` (required), `--container`, `--max-steps`, `--extract-prices`, `--concurrency`, `--throttle-ms`, `--engine`, `--country`, `--headed`, `--proxy`.

## `site-shots <url>`

Full-site snapshot: crawl the site then screenshot each page. Prints `{ count, pages }` with content (markdown) + saved PNG paths per page. Heavy (a browser per page) — keep `--max-pages` modest.

```bash
fuse-browser site-shots https://example.com --max-pages 20 --viewports mobile,desktop
```

Applicable flags: `--max-pages`, `--max-depth`, `--throttle-ms`, `--all-origins`, `--no-robots`, `--viewports`, `--settle-ms`, `--concurrency`, `--engine`, `--country`, `--headed`, `--output-dir`, `--proxy`.

## `serp-batch <queries...>`

Runs one Google search per query and prints one row per query. Requires at least one query (otherwise exits `1`). Output is JSON by default, or CSV with `--csv`.

```bash
fuse-browser serp-batch "best running shoes" "trail shoes" \
  --rank-domain example.com --serp-pages 2 --csv > ranks.csv
```

Applicable flags: `--engine`, `--country`, `--headed`, `--output-dir`, `--proxy`, `--rank-domain`, `--serp-pages`, `--hl`, `--gl`, `--delay-ms`, `--csv`.

## `shots <url>`

Captures responsive screenshots of `url` to disk and prints the saved-shot metadata as JSON. Viewports come from `--viewports` (defaults to `mobile,desktop`). Each entry is either a preset (`mobile`, `tablet`, `desktop`) or `WIDTHxHEIGHT` (e.g. `1280x720`); unrecognized entries fall back to `desktop`.

```bash
fuse-browser shots https://example.com --viewports mobile,tablet,1280x720 --settle-ms 800
```

Applicable flags: `--engine`, `--country`, `--headed`, `--output-dir`, `--viewports`, `--settle-ms`.

---

## Page commands (one-shot)

These commands open a page, run one operation, print JSON on stdout (errors on stderr), and tear the browser down. Exit codes: `0` success, `1` functional/step failure, `2` bad usage or malformed JSON. They all share the page flags `--engine`, `--country`, `--currency`, `--headed`, `--human-mode`, `--proxy`, `--proxy-map`, `--output-dir`, `--storage-state`, `--no-robots`, `--wait-ms`, `--block-resources`.

### `run <url>`

Executes a multi-step plan in one session. Steps come from `--steps '<json>'` (inline array) or `--steps-file <path>` (`-` reads stdin). Each step is `{type, …}`: `navigate`, `click`, `fill`, `scroll`, `press`, `wait`, `select`, `upload`, `hover`, `drag`, `extract`. An `upload` step is `{"type":"upload","target":"<selector>","files":"<path>"}` — `files` accepts one path, a comma-separated string, or an array, and is set on the matching `<input type=file>`. A `hover` step is `{"type":"hover","target":"<selector>"}` (moves the pointer over the element to reveal hover menus/tooltips). A `drag` step is `{"type":"drag","target":"<source-selector>","to":"<destination-selector>"}` (drops the source onto the destination). Prints `{ok, url, steps}`; on a failed step prints `{ok:false, error:{kind:"step_failed", step, message}}` and exits `1`. Malformed/non-array JSON exits `2`.

```bash
fuse-browser run https://example.com \
  --steps '[{"type":"wait","ms":500},{"type":"extract","kind":"text"}]'
```

```bash
fuse-browser run https://example.com/apply \
  --steps '[{"type":"upload","target":"input[type=file]","files":"/path/cv.pdf"}]'
```

```bash
fuse-browser run https://example.com/board \
  --steps '[{"type":"hover","target":".menu-trigger"},{"type":"drag","target":"#card-1","to":"#column-done"}]'
```

### `products <url>`

Extracts repeated product cards from the rendered DOM. `--limit <n>` caps the result; `--container <selector>` forces the card container. Prints `{url, count, products}`.

```bash
fuse-browser products "https://www.digitec.ch/en/search?q=macbook" --limit 20
```

### `extract <url>`

Pulls page content. `--kind text` (default) returns main text, `prices` returns parsed prices, `markdown` returns LLM-ready markdown + metadata. Prints `{url, kind, …}`.

```bash
fuse-browser extract https://example.com --kind markdown
```

### `snapshot <url>`

Captures the indexed interactive-element snapshot (each element gets a stable `ref`). Add `--selectors` for per-element CSS selectors. Prints `{url, count, elements}`.

```bash
fuse-browser snapshot https://example.com --selectors
```

### `screenshot <url>`

Captures a PNG. Add `--full-page` for the full scroll height. With `--output <file>` it writes the file and prints `{url, path, bytes}`; otherwise it prints `{url, base64}`.

```bash
fuse-browser screenshot https://example.com --full-page --output shot.png
```

### `inspect <url>`

Snapshots the page (tagging elements with `data-fuse-ref`) then reports computed style, box, and WCAG contrast for the element named by `--ref <ref>` (a `ref` from `snapshot`). `--ref` is required (else exits `2`); an unknown ref exits `1`. Prints `{url, ref, style}`.

```bash
fuse-browser inspect https://example.com --ref 0
```

---

## `tools --tokens`

Print the size of the tool definitions the MCP server advertises in `tools/list`, so the context cost is visible: one row per tool (largest first, with its capability group), per-group subtotals and the total.

```bash
fuse-browser tools --tokens                 # active surface: FUSE_PRESET (default full), narrowed by FUSE_CAPS
fuse-browser tools --tokens --preset docs   # a named preset: full | docs | qa
```

Bytes are the UTF-8 length of the compact JSON of `name` + `description` + `inputSchema` + `outputSchema`. Tokens are an **estimate** (`ceil(bytes / 4)`, no tokenizer is bundled); the method is printed above every table. The last line adds the whole advertised tool objects (title and [annotations](./mcp-tools.md#tool-annotations) included). `--preset` takes precedence over `FUSE_PRESET`; an unknown name exits `1`. `tools` without `--tokens` prints the usage text and exits `1`. The server itself takes the same flag: `browser-mcp --preset <name>`.

---

## `vault <set|list|rm|test>`

Manage the local encrypted credential vault (AES-256-GCM). Secrets are read from stdin **without echo**, never from argv, and never leave the machine except to fill a field in the browser. This is the only vault write path — the MCP surface is read-only.

```bash
fuse-browser vault set github     # prompts: username, password, TOTP (optional), allowed origins
fuse-browser vault list           # ref, username, totp?, origins — no secrets
fuse-browser vault test github    # prints the current TOTP code + confirms the password is set
fuse-browser vault rm github
```

Each credential is bound to one or more origins (`scheme://host`); a fill is refused on any other origin (anti-phishing). Reference it from an agent with `browser_login { credentialRef: "github" }` or `browser_fill { credentialRef, field }` — the secret is resolved server-side and never enters the model context. Set `FUSE_VAULT_KEY` to inject the master key from a secret manager; see [configuration](./configuration.md).

---

## Approval guardrail

Sensitive actions (pay / book / checkout / confirm) are blocked unless `--approved` is passed. When blocked, `probe` prints `BLOCKED: <reason>` to stderr and exits `2`. `--approved` sets the `humanApproved` flag on the probe.

---

## Flags

| Flag | Type | Description |
|------|------|-------------|
| `--engine` | string | Engine/browser name to launch (probe, serp-batch, shots). |
| `--country` | string | Country code for geo/locale context (probe, serp-batch, shots). |
| `--currency` | string | Currency context for the probe (probe). |
| `--headed` | boolean | Run with a visible browser; absent means headless. |
| `--auto-consent` | boolean | Automatically handle cookie/consent dialogs (probe). |
| `--extract-prices` | boolean | Extract prices from the page (probe, fetch). |
| `--browser-fallback` | boolean | Re-render an empty SPA/CSR shell in a real browser (fetch). |
| `--text` | boolean | Return raw text instead of markdown (fetch, fetch-batch). |
| `--format` | string | Output format `markdown` or `text` (fetch, fetch-batch). |
| `--concurrency` | string | Max parallel fetches; parsed as a number (fetch-batch). |
| `--tokens` | boolean | Print advertised tool-definition sizes (`tools --tokens`). |
| `--preset` | string | Task preset `full` / `docs` / `qa` (`tools --tokens`, and `browser-mcp --preset`). |
| `--help`, `-h` | boolean | Print usage and exit (both `fuse-browser` and `browser-mcp`). |
| `--version`, `-v` | boolean | Print the package version and exit (both bins). |
| `--max-pages` | string | Crawl page cap; parsed as a number (crawl). |
| `--max-depth` | string | Crawl BFS depth; parsed as a number (crawl). |
| `--all-origins` | boolean | Allow cross-origin links during crawl (crawl). |
| `--no-robots` | boolean | Opt out of robots.txt during crawl (crawl). |
| `--throttle-ms` | string | Min gap between same-host hits; parsed as a number (crawl, collect-batch). |
| `--item` | string | CSS selector for one list row (collect-batch). |
| `--container` | string | Scroll container selector (collect-batch). |
| `--max-steps` | string | Max scroll steps per page; parsed as a number (collect-batch). |
| `--detect-challenges` | boolean | Detect anti-bot / challenge pages (probe). |
| `--observe-visual` | boolean | Run the visual observation pass (probe). |
| `--extract-serp` | boolean | Extract SERP results from the page (probe). |
| `--serp-pages` | string | Number of SERP pages to process; parsed as a number (probe, serp-batch). |
| `--rank-domain` | string | Domain to find/rank within SERP results (probe, serp-batch). |
| `--csv` | boolean | Emit `serp-batch` output as CSV instead of JSON (serp-batch). |
| `--viewports` | string | Comma-separated viewports for `shots`: presets `mobile`/`tablet`/`desktop` or `WIDTHxHEIGHT`. Defaults to `mobile,desktop` (shots). |
| `--settle-ms` | string | Milliseconds to wait before capturing screenshots; parsed as a number (shots). |
| `--hl` | string | Google `hl` interface-language parameter (serp-batch). |
| `--gl` | string | Google `gl` geolocation parameter (serp-batch). |
| `--delay-ms` | string | Delay between queries; parsed as a number (serp-batch). |
| `--human-mode` | boolean | Enable human-like interaction behavior (probe). |
| `--approved` | boolean | Authorize sensitive actions (pay/book/checkout/confirm) (probe). |
| `--replay` | boolean | Enable replay of recorded interactions (probe). |
| `--wait-ms` | string | Extra wait after load; parsed as a number, defaults to `0` (probe). |
| `--output-dir` | string | Directory for output artifacts (probe, serp-batch, shots). |
| `--storage-state` | string | Path to a Playwright storage-state file for session reuse (probe). |
| `--proxy` | string | Proxy URL for all requests (probe, fetch, serp-batch). |
| `--proxy-map` | string | Path to a per-domain proxy mapping file (probe). |
| `--user-data-dir` | string | Persistent browser user-data directory (probe). |
| `--site-memory-dir` | string | Directory for per-site memory (probe). |
| `--click` | string (repeatable) | Click the given target; repeat for multiple clicks, run after all `--fill` (probe). |
| `--fill` | string (repeatable) | Fill a field as `TARGET=VALUE`; repeatable, run before clicks (probe). |

> **Note:** `--channel` is **not** a recognized flag in the current CLI (`src/bin/cli.ts`). Because `parseArgs` runs in strict mode, passing it will cause an "unknown option" error. It is documented here only to record its absence.

---

## More examples

Probe with price + visual extraction:

```bash
fuse-browser probe https://shop.example.com/product/42 --extract-prices --observe-visual
```

Fetch fast-path (no browser):

```bash
fuse-browser fetch https://example.com/api/page --extract-prices
```

SERP batch ranks to CSV:

```bash
fuse-browser serp-batch "wireless earbuds" "noise cancelling earbuds" \
  --rank-domain example.com --csv > ranks.csv
```

Responsive screenshots:

```bash
fuse-browser shots https://example.com --viewports mobile,tablet,desktop --settle-ms 500
```

Booking flow with geo proxy and replay (sensitive, hence `--approved`):

```bash
fuse-browser probe https://booking.example.com \
  --country JP --proxy-map ./proxies.json --replay \
  --fill "checkin=2026-07-01" --click "Search" --approved
```
