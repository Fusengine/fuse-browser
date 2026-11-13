# MCP tools

Complete reference for the 54 `browser_*` tools exposed by the fuse-browser MCP server.

Tools fall into two families:

- **One-shot / fast-path** (`browser_probe`, `browser_probe_html`, `browser_fetch`, `browser_fetch_batch`, `browser_crawl`, `browser_collect_batch`, `browser_shots_batch`, `browser_site_shots`, `browser_serp_batch`) open a fresh browser (or do a pure HTTP fetch) per call and return a report. No session id needed.
- **Structured extraction** (`browser_products`, `browser_collect`, `browser_extract`, `browser_extract_schema`) and `browser_autoscroll` (drain lazy lists) run against a live session.
- **Session tools** require a `sessionId` obtained from `browser_open` (or `browser_connect`). They drive one persistent, stateful page.

Every field is optional unless **Required** says `yes`. Defaults shown below come from the tool itself; many can also be set globally via `FUSE_*` environment variables — see [configuration](./configuration.md). Per-call arguments always override env defaults.

The shared identity/profile options (the `agentOptionShape`) are listed once under [`browser_open`](#browser_open); tools that accept them say so and link back.

## Return format (structured output)

Every tool declares an `outputSchema` (zod) and returns a **typed `structuredContent`** validated against it, alongside the human-readable `content`. Clients that support MCP structured output read `structuredContent` directly (typed, no parsing); clients that don't fall back to the `content` block. The `content` text is **compact JSON** (non-indented) — the pretty-print whitespace only inflated the token cost, and it stays semantically identical to `structuredContent`. Image tools (`browser_screenshot`, and any tool called with `annotate:true`) return the image in `content` **plus** the structured metadata in `structuredContent`. Error results set `isError` and, when a machine-readable code applies, expose `structuredContent: { code, message }`.

## Capability groups (`FUSE_CAPS`)

By default all 54 tools are registered. Set the `FUSE_CAPS` env var (comma-separated group names) to expose fewer tools — a lighter context for the LLM client:

| Group | Tools |
| --- | --- |
| `core` | Session lifecycle (`browser_open`/`browser_status`/`browser_close`/`browser_connect`), navigation (`browser_navigate`/`browser_back`/`browser_forward`), actions (`browser_click`/`browser_fill`/`browser_login`/`browser_scroll`/`browser_press`/`browser_type`/`browser_select`), `browser_tabs`, `browser_dialog`/`browser_downloads`, `browser_snapshot`/`browser_find`/`browser_verify`/`browser_act`, `browser_wait`/`browser_wait_for`, `browser_screenshot`, `browser_autoscroll`, `browser_vault`. |
| `batch` | `browser_probe`, `browser_probe_html`, `browser_fetch`, `browser_fetch_batch`, `browser_crawl`, `browser_map`, `browser_collect_batch`, `browser_shots_batch`, `browser_site_shots`, `browser_serp_batch`. |
| `extract` | `browser_collect`, `browser_run`, `browser_extract`, `browser_extract_schema`, `browser_products`. |
| `debug` | `browser_inspect`, `browser_console`, `browser_network`, `browser_visual_diff`, `browser_metrics`, `browser_pdf`, `browser_cookies`. |
| `live` | `browser_handoff`, `browser_live_view`, `browser_live_view_stop`. |

```sh
FUSE_CAPS=core,extract browser-mcp   # only the core + extract groups
```

Parsing is forgiving: names are case-insensitive and whitespace-tolerant (`"  CORE , Extract "` works), unknown names are reported on stderr and ignored, and a blank/unset value — or one containing **only** unknown names — falls back to all groups (never an empty server).

### Task presets (`FUSE_PRESET` / `--preset`)

A preset is a named set of groups and tools, for one kind of task. It only narrows what is registered: no tool is renamed or changed, and the default is `full` (every tool). Select it with the `FUSE_PRESET` env var or `browser-mcp --preset <name>` (the flag wins). `FUSE_CAPS` still applies on top: a tool is registered only when both allow it. If the two select no group in common (e.g. `FUSE_PRESET=docs FUSE_CAPS=core`), `FUSE_CAPS` is ignored with a stderr notice, so the server is never empty.

| Preset | Tools | For |
| --- | --- | --- |
| `full` | all 54 | default |
| `docs` | `browser_fetch`, `browser_fetch_batch`, `browser_crawl`, `browser_map`, `browser_serp_batch` | reading documentation (HTTP fast-path + search); no browser session |
| `qa` | 22: `browser_open`/`status`/`close`, `browser_navigate`/`back`/`forward`, `browser_click`/`fill`/`scroll`/`press`/`type`/`select`/`wait`/`wait_for`, `browser_act`, `browser_snapshot`, `browser_find`, `browser_verify`, `browser_screenshot`, `browser_console`, `browser_network`, `browser_visual_diff` | testing a running webapp |

```sh
FUSE_PRESET=docs browser-mcp            # or: browser-mcp --preset docs
fuse-browser tools --tokens --preset qa # advertised definition size of that preset
```

Advertised definition size, measured on 2026-11-12, 54 tools (name + description + `inputSchema` + `outputSchema`, compact JSON; tokens are an **estimate**, `ceil(bytes / 4)`, no tokenizer):

| Surface | Tools | Bytes | ~Tokens |
| --- | --- | --- | --- |
| `full` | 54 | 116,675 | 29,169 |
| `qa` | 22 | 42,180 | 10,545 |
| `docs` | 5 | 19,978 | 4,995 |

The numbers move whenever a tool's description or schema changes; `fuse-browser tools --tokens` prints the current ones (per tool, per group, total).

### Output budget (`maxTokens`, `offset`, `outputMode`)

The big-output tools (target: `browser_fetch`, `browser_fetch_batch`, `browser_crawl`, `browser_extract`, `browser_snapshot`) take three optional params, all off by default (without them the result is byte-identical to before):

- `maxTokens` caps the one big field (e.g. `text`, a list of `elements`/`pages`) to about that many tokens. The estimate is the one `fuse-browser tools --tokens` uses (`ceil(UTF-8 bytes / 4)`, no tokenizer), so a text field is cut to at most `maxTokens * 4` bytes, at a paragraph, line or word boundary (a list keeps whole items within that size, except that one item is always returned so paging makes progress). A cut result carries `nextOffset` (present only when the field was cut; the budget never writes `truncated`, which stays each tool's own flag, e.g. the snapshot element cap); call again with `offset: nextOffset` to continue. The pages concatenate back to the full text. `approxTokens` reports the size of the returned result.
- `offset` is the resume position (characters for text, items for a list).
- `outputMode: "file"` writes the full field under the output dir (`<outputDir>/offload/<tool>-<hash>.txt|json`, a server-chosen path, never a caller path) and returns `{ outputMode: "file", path, bytes, preview }`; the field itself is replaced by the 400-character `preview` (an empty list). `maxTokens` and `offset` are ignored in this mode. When `FUSE_CONFINE_WRITES` is set and the output dir is outside that root, nothing is written and the result stays inline with `outputError: "path_outside_confinement"` (`"write_failed"` if the write itself fails). If the big field is absent or is neither text nor a list, nothing is written and the result carries `outputError: "field_not_offloadable"`; without `outputMode:"file"` such a result is returned unchanged.

A tool accepts these params only once it is wired to the shared helper (`budgetResult`, `src/server/output-budget.ts`); the tool's own parameter list is authoritative.

### Tool annotations

Every tool is advertised with MCP `annotations` from one central table (`src/server/tool-annotations.ts`), so hosts can tell observation from action: `readOnlyHint` (true for fetch, extract, snapshot, console, network, ...; false for click, fill, act, run, navigate, and for every tool that can write a file: screenshot, probe, shots, site_shots, serp_batch, pdf, visual_diff, ...), plus `destructiveHint`, `idempotentHint` and `openWorldHint` where they differ from the MCP defaults (destructive `true`, idempotent `false`, open-world `true`; destructive and idempotent are only meaningful for non-read-only tools). `readOnlyHint:true` means no write side effect on any input (page, remote site or disk), so a client that auto-approves read-only tools never writes a file unasked. Annotations are **hints**: the MCP spec tells clients not to base trust decisions on them. They add about 3.4 KB (~850 estimated tokens) to the full `tools/list`.

**Progress notifications.** The batch tools (`browser_fetch_batch`, `browser_crawl`, `browser_collect_batch`, `browser_shots_batch`, `browser_site_shots`, `browser_serp_batch`) emit MCP `notifications/progress` (`progress`/`total` per finished item, with the item URL/query as `message`) when the client sends a `progressToken` with the request. Clients that don't request progress see no change.

---

## One-shot

### browser_probe

Open a real browser, load a URL, and return text, screenshot path, network/console logs, and optional prices/visual/challenge analysis.

Accepts the full [agentOptionShape](#browser_open) (engine, proxy, locale, captcha, etc.) plus `url` and the probe flags below.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `url` | string | yes | Page to load. |
| `actions` | array of `{type, ...}` | no | Pre-extraction actions to run (loose: `type` + arbitrary fields). |
| `humanApproved` | boolean | no | Authorize sensitive actions (guardrail gate). |
| `autoConsent` | boolean | no | Auto-dismiss cookie/consent banners. |
| `extractPrices` | boolean | no | Run the price extractor on the page text. |
| `waitMs` | integer | no | Extra wait (ms) after load before extracting. |
| `detectChallenges` | boolean | no | Detect bot-challenge / captcha walls. |
| `observeVisual` | boolean | no | Produce a visual observation of the rendered page. |
| `solveCaptcha` | boolean | no | Attempt captcha solving (needs `captcha` provider config). |
| `extractSerp` | boolean | no | Parse the page as a Google SERP. |
| `serpPages` | integer | no | Number of SERP pages to collect when `extractSerp`. |
| `rankDomain` | string | no | Report the SERP rank of this domain. |
| `extractContacts` | boolean | no | Extract `{ emails, phones, hasContactForm }` into `report.contacts`. |
| `contactCrawl` | object | no | `{ enabled, maxPages? }` — when no email is found, follow same-domain contact/impressum links (bounded). |
| `contactFilter` | enum `strict` \| `off` | no | Drop placeholder/template emails (default `strict`). |
| `fastPathFirst` | boolean | no | With `extractContacts`: try HTTP extraction first, escalate to the browser only if the card is incomplete (email AND phone). Sets `report.fastPath`. |
| _+ all_ [agentOptionShape](#browser_open) | — | no | Engine, proxy, identity, captcha, etc. |

```json
{ "url": "https://example.com", "extractPrices": true, "detectChallenges": true, "headless": true }
```

### browser_probe_html

Same engine as `browser_probe`, but loads an inline HTML fixture instead of a URL. Useful for tests and dry-runs.

Accepts the full [agentOptionShape](#browser_open) plus the same probe flags as `browser_probe` (`actions`, `humanApproved`, `autoConsent`, `extractPrices`, `waitMs`, `detectChallenges`, `observeVisual`, `solveCaptcha`, `extractSerp`, `serpPages`, `rankDomain`).

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `html` | string | yes | Inline HTML document to render. |
| _+ probe flags_ | — | no | Same as `browser_probe`. |
| _+ all_ [agentOptionShape](#browser_open) | — | no | Engine, proxy, identity, captcha, etc. |

```json
{ "html": "<h1>Hi</h1><p>$19.99</p>", "extractPrices": true }
```

---

## Fast-path

### browser_fetch

HTTP fetch with browser TLS/HTTP2 impersonation — no browser launch, ~10x faster. For server-rendered HTML; for JS/SPA pages set `browserFallback: true` (or use `browser_probe`). Non-HTML responses (JSON APIs, `text/plain`) are returned **verbatim** — the markdown/HTML pipeline is skipped — so this also works as a fast JSON-API fetcher. The body download is capped at 10 MB. Shares its network layer with `browser_fetch_batch`/`browser_crawl`: set `FUSE_BLOCK_PRIVATE_NETS=1` to block loopback/link-local/RFC1918/CGNAT targets — including every IPv6 literal form (`[::1]`, IPv4-mapped, `[::]`) — for all three (see [configuration](./configuration.md) for exactly what is and isn't covered; off by default, so `http://127.0.0.1:3000` keeps working).

With `browserFallback: true`, escalation to a real browser render fires on **either** of two independent signals: (1) the raw HTML itself looks like an unrendered SPA shell (thin visible text + SPA/script markers), or (2) the raw HTML looks JS-rendered (SPA hydration mount point or heavy `<script>` count) **and** the fast-path extraction still came back empty/near-empty (`wordCount < 15`, not already recovered by the hollow-extraction path) — this covers chrome-heavy pages (nav/footer markup clearing 600+ visible chars) whose real content only exists after client-side hydration. Either path sets `escalated: true` and re-renders from the browser's rendered HTML; a body that already escalated is never escalated twice. If the content extractor still finds nothing on the real browser-rendered HTML (rare — a dense, non-article layout like an e-commerce grid homepage can defeat its content-scoring even post-render), the browser's own raw visible text is shipped instead of near-empty markdown, with `extraction: "recovered"` and a real `wordCount` — no extra browser launch.

**Blocked responses.** A response that is an anti-bot interstitial (a Cloudflare / DataDome / AWS WAF challenge page) is not the page, and is never returned as if it were. The result then carries `blocked: true`, `blockedBy` (vendor slug: `cloudflare`, `datadome`, `aws-waf`, or `unknown` when only vendor-agnostic signals matched) and a one-line `hint` naming the next tools. Detection is table-driven (`src/net/block-signals.ts`) and combines signals rather than trusting one string: a vendor-documented response header (`cf-mitigated: challenge`, `x-amzn-waf-action: challenge|captcha`) decides at any status; a challenge-specific HTML marker decides on a non-2xx status or thin visible text — the marker must be in executable/loading context (Cloudflare's inline `_cf_chl_opt = {` assignment, a `src="…captcha-delivery.com…"` DataDome script/frame), so a page that merely names them in prose or in a CSP meta is not matched; weaker page-level hints (interstitial title, "enable JavaScript to continue" / "verify you are human" text, `<meta http-equiv="refresh">`) only count when **three** distinct ones match together on a thin 4xx/5xx page — any two are common on legitimate error pages, and one phrase never counts twice. The `x-datadome` header is on every response of a DataDome-protected site, so it never counts toward the three (it only attributes `blockedBy: "datadome"` once the page-level hints decide). HTML-based detection is skipped for bodies over 1 MiB (header rule only). Normal results are unchanged — the three fields are absent unless `blocked`. The sparse-page shapes covered by the test matrix (a 404, a login page, a real 403 with text, a bare 403, a 503 maintenance page — also behind a DataDome-protected site or with a refresh tag —, a 429, an SPA shell, a 401 "Security Check" form) are not flagged. Known coverage gap: vendors without an entry in the signal table (e.g. a PerimeterX or Akamai "Access Denied" page) are only caught if they also match three weak hints, so they can still come back as an ordinary-looking result — adding one is a single table entry. Known limit: a long 4xx page that reproduces a vendor's own snippet verbatim anywhere in its markup (e.g. a tutorial quoting the full `window._cf_chl_opt = {…}` assignment) would still match the HTML marker on a non-2xx status.

Escalation is **opt-in**: `browserFallback: true` re-renders a detected block in a real browser (`escalated: true`); if that render still carries the challenge's own HTML marker on thin text, the result still says `blocked: true` and the `hint` then points at a headed session and `browser_handoff`. A rendered page has no headers or status, so a block that only response headers can identify (a vendor with no HTML marker in the table, today AWS WAF) is carried over to a render that is as thin as an interstitial; a Cloudflare/DataDome block is not carried over — a short legitimate page rendered fine is returned as the page, and a still-challenged render is caught by its own marker. A header-only block whose render is long enough to look like a page is not re-flagged. Known limit: the converse also holds — a GENUINE short page behind a header-identified block (e.g. AWS WAF), rendered successfully but thin (under 600 visible characters), is still reported `blocked: true`, because a render carries no headers to tell it from the interstitial. Set `FUSE_FETCH_ESCALATE_BLOCKED=1` on the server to escalate detected blocks even without `browserFallback` (it does not turn on SPA-shell escalation). With `escalated: true`, `status` is still the fast-path HTTP status. The agent never solves a CAPTCHA: a human step on the live page goes through `browser_handoff`.

**PDFs.** A response that is a PDF (`application/pdf`, or the `%PDF-` signature under a generic content-type) is read, not returned as bytes: `text` is the text layer with a `<!-- page N -->` marker before each page, and `pageCount` is the page count of the whole document (`maxChars` still truncates `text`). Parsing uses `unpdf` (pdf.js, pure JS) in a worker thread bounded in time (20 s, `pdfError: "timeout"`) and memory (`pdfError: "memory"`), so a small file that inflates to hundreds of MB cannot pin or exhaust the server. The memory cap is `FUSE_PDF_MAX_MB` (default `256`; a positive number, anything else falls back to the default): it is the worker's V8 heap limit (`resourceLimits.maxOldGenerationSizeMb` — honoured by Node, **ignored by Bun**) and, portably on both runtimes, a ceiling on how far the process RSS may grow while the worker runs (RSS is process-wide, so other non-PDF work running at the same time can count against it; raise the value on a busy server). PDF extractions run one at a time process-wide, so several PDFs in one `browser_fetch_batch` never charge each other's memory (the batch's other URLs are unaffected). Measured: the real 15-page arXiv paper peaks at about 100 MB RSS (Node 26 and Bun 1.4.4; its heap stays under 64 MB), a 150 MB-inflating bomb PDF is cut off at 410 MB (Node, 128 MB cap) / when RSS has grown past the cap (Bun). A PDF over the 10 MB download cap is refused (`pdfError: "too_large"`, empty `text`), a corrupt or encrypted one gives `pdfError: "unreadable"`; a scanned PDF has no text layer and returns an empty `text` (no OCR). The same applies in `browser_fetch_batch` and `browser_crawl`; a PDF is a leaf in a crawl (no links are followed out of it).

**Site-authored markdown.** When the site publishes markdown for the page, that markdown is returned as-is (`format: "text"`, `source: "site-markdown"`): (1) the server answers markdown to our `Accept: text/markdown`; (2) the page advertises a twin with `Link: <…>; rel="alternate"; type="text/markdown"`; (3) with `preferMarkdown: true`, the `<path>.md` twin of the URL (a docs page `/docs/intro` → `/docs/intro.md`; the site root has none). At most one extra request per call, same origin only, only on a 2xx page, through the same SSRF guard as the main fetch; a twin that is HTML (a SPA catch-all), non-200 or empty is ignored. With `preferMarkdown` and no markdown found the result says `source: "html"`. Without any site markdown the result is unchanged (no `source` field). `browser_crawl` does not use this ladder (it needs the HTML to find links).

The markdown path auto-detects a **hollow extraction** — when the content extractor silently captures only a sliver of the page's real non-link prose (e.g. some forum threads whose posts sit inside a wrapper element the extractor drops as boilerplate) — and recovers the raw page text instead, gated so a genuinely sparse or link-heavy page (listing/index, login, 404) never gets dumped as raw link soup: recovery only fires when the page holds a substantial amount of reading content outside its `<a>` chrome that the extractor missed. The result carries `wordCount` and `extraction` (`"primary"` | `"recovered"`) so callers can see which path produced `text`. Pass `contentSelector` to pin the main content container yourself when auto-detection still picks the wrong element.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `url` | string | yes | URL to fetch. |
| `format` | enum `markdown` \| `text` | no | Output format (default `markdown`: main content + YAML frontmatter). Forced to raw `text` for non-HTML bodies (JSON, plain text). |
| `contentSelector` | string | no | CSS selector pinning the main content element, bypassing auto-detection. Markdown path only. |
| `extractPrices` | boolean | no | Run the price extractor on the body. |
| `extractContacts` | boolean | no | Extract `{ emails, phones, hasContactForm }` from the fetched HTML (no browser). |
| `contactFilter` | enum `strict` \| `off` | no | Drop placeholder/template emails (default `strict`). |
| `countryCode` | string | no | Default region for phone E.164 parsing (default `CH`). |
| `proxyUrl` | string | no | Proxy to route the request through. |
| `maxChars` | integer | no | Truncate returned `text` (default `20000`). |
| `browserFallback` | boolean | no | When the HTTP response is an empty SPA/CSR shell or a detected anti-bot interstitial, re-render it in a real browser and return the rendered markdown. Off by default. The response sets `escalated: true` when this happens (and `blocked: true` if the browser render is blocked too). |
| `preferMarkdown` | boolean | no | Also try the `<url>.md` twin of a docs page and use the site's own markdown (`source: "site-markdown"`; `"html"` when none). Off by default. |
| `focus` | string | no | A question or keywords: adds `passages` — the best-matching sections of the **whole** page (see below). Off by default; blank = off. |
| `topK` | integer (> 0) | no | Passages returned for `focus` (default `3`). |

**Passages (`focus`).** The extracted markdown (plain text for non-HTML bodies) is split at headings into passages (long sections are grouped by paragraph, ≈ 900 characters each) and ranked with BM25 against `focus` — lexical, deterministic, no model: lowercased Unicode word tokens, no stemming, a passage's heading counts toward its score. `passages: [{ heading, text, score }]`, best first, only passages that contain at least one query term, so a query that matches nothing gives `[]`. Ranking runs on the full page, not on the `maxChars` slice; `text` itself is unchanged, so pair `focus` with a small `maxChars` to read only the passages. Without `focus` the result is byte-identical to before.

```json
{ "url": "https://example.com", "extractContacts": true }
```

Returns `{ status, url, format, escalated, text, wordCount?, extraction?, blocked?, blockedBy?, hint?, pageCount?, pdfError?, source?, passages? }` — `wordCount`/`extraction` are set on the markdown path only; `blocked` (always `true`), `blockedBy` and `hint` are set only when the response is an anti-bot interstitial (see above); `pageCount`/`pdfError` only for a PDF; `source` only when site markdown was used or `preferMarkdown` was set.

---

### browser_fetch_batch

Fetch **many URLs in parallel** via the HTTP fast-path (TLS impersonation, no browser launch), bounded concurrency. Each URL keeps `browser_fetch` semantics (markdown for HTML, JSON/plain-text verbatim, per-URL `browserFallback`). Results come back in input order; a failed URL becomes `{ url, error }` and never aborts the batch.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `urls` | string[] | yes | URLs to fetch. |
| `format` | enum `markdown` \| `text` | no | Output format (default `markdown`; forced to `text` for non-HTML). |
| `maxChars` | integer | no | Truncate each returned `text` (default `20000`). |
| `browserFallback` | boolean | no | Re-render empty SPA/CSR shells in a real browser (per URL). |
| `preferMarkdown` | boolean | no | Per URL, also try the `.md` twin and use the site's own markdown (see `browser_fetch`). |
| `proxyUrl` | string | no | Proxy to route the requests through. |
| `concurrency` | integer | no | Max parallel fetches (default `8`). |

```json
{ "urls": ["https://a.example", "https://b.example"], "concurrency": 5 }
```

Returns `{ count, results: [{ status, url, format, escalated, text, blocked?, blockedBy?, hint?, pageCount?, pdfError?, source? } | { url, error }] }` (`pageCount`/`pdfError`: PDFs are read as page-marked text; `source`: site markdown — see `browser_fetch`). Each URL is checked for an anti-bot interstitial exactly like `browser_fetch`; a blocked URL carries `blocked: true`, `blockedBy` and `hint` (it is not turned into an `error`, and `browserFallback` / `FUSE_FETCH_ESCALATE_BLOCKED=1` apply per URL — mind the cost: one browser render per blocked URL, up to `concurrency` at once).

---

### browser_crawl

Crawl a site from a seed URL via the HTTP fast-path (no browser launch): breadth-first, fetching each depth level in parallel, returning clean markdown per page. Same-origin and robots.txt-honored **by default**; bounded by `maxPages`/`maxDepth`. For JS/SPA pages set `browserFallback:true` (renders empty shells per page).

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `url` | string | yes | Seed URL. |
| `maxPages` | integer | no | Page cap (default `25`). |
| `maxDepth` | integer | no | BFS depth from the seed (default `2`). |
| `sameOrigin` | boolean | no | Stay on the seed's origin (default `true`). |
| `concurrency` | integer | no | Parallel fetches per level (default `5`). |
| `format` | enum `markdown` \| `text` | no | Per-page output (default `markdown`). |
| `maxChars` | integer | no | Truncate each page's `text` (default `20000`). |
| `browserFallback` | boolean | no | Re-render empty SPA/CSR shells per page. |
| `respectRobots` | boolean | no | Honor robots.txt (default `true`; set `false` to opt out). |
| `throttleMs` | integer | no | Base gap between hits on the same host (default `250`; `0` disables), **jittered** per request (`[base/2, base*1.5]`) to look human. Keeps big crawls polite / unblocked. |
| `proxyUrl` | string | no | Proxy to route requests through. |

```json
{ "url": "https://docs.example.com", "maxPages": 30, "maxDepth": 2 }
```

Returns `{ count, pages: [{ status, url, format, escalated, text, depth, blocked?, blockedBy?, hint?, pageCount?, pdfError? }] }`. A PDF page is read as page-marked text (`pageCount`) and is a leaf: no links are followed out of it. A page answered by an anti-bot interstitial carries `blocked: true`, `blockedBy` and `hint` (same detection as `browser_fetch`) and its links are **not followed** — they would be challenge-page chrome, not the site. `browserFallback` / `FUSE_FETCH_ESCALATE_BLOCKED=1` escalate such a page to a browser render per page. `browser_serp_batch` is unaffected: it drives a real browser session and never goes through the HTTP fast-path.

---

### browser_map

List a site's URLs **without crawling it** — HTTP fast-path, no browser launch, read-only. Sources, in order: the `Sitemap:` lines of `/robots.txt` (else `/sitemap.xml`), following sitemap indexes and `.gz` sitemaps; if the site has no sitemap at all, the links of `/llms.txt`. Only files on the seed's origin are fetched (an index child or a `Sitemap:` line on another origin is ignored, and so is a sitemap that redirects to another origin); at most 50 sitemap files are **attempted** per call (a dead child counts), and every request goes through the same network guard as `browser_fetch` (`FUSE_BLOCK_PRIVATE_NETS=1` makes it refuse loopback/private targets with `blocked_private_network`). With `respectRobots` (default) robots.txt gates every file `browser_map` picks ITSELF (`/sitemap.xml`, `<path>/sitemap.xml`, `/llms.txt`, `<path>/llms.txt`): it is not even requested when robots disallows its path, and each skip is counted in `skippedByRobots` (absent when 0). The exception is what the site advertises: sitemaps named in its robots `Sitemap:` lines, and the child sitemaps listed by an index `browser_map` was allowed to read, are always fetched — so an advertised index can lead to a child under a `Disallow` path. The page URLs listed in a sitemap or `llms.txt` are filtered by robots (disallowed ones are left out, and a URL whose percent-escapes cannot be decoded is dropped too — fail closed). `respectRobots:false` lifts all of this. Per [sitemaps.org](https://www.sitemaps.org/protocol.html#location) every URL of a sitemap must use the sitemap's own protocol, host and port, so listed URLs on any other origin (another host, `http` vs `https`, another port, or a link in `llms.txt` pointing elsewhere) are dropped and counted in `offOrigin` (absent when 0) — map the other origin separately if you want it. Parsing is linear in the size of the input (no regex backtracking on hostile XML or glob patterns).

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `url` | string | yes | Any http(s) URL of the site; its origin is mapped. |
| `includePaths` | string[] | no | Keep only URLs whose path matches (`*` = any characters; a pattern without `*` also matches everything below it: `/docs` matches `/docs` and `/docs/a`). |
| `excludePaths` | string[] | no | Drop URLs whose path matches (same syntax). |
| `limit` | integer | no | Max URLs returned (default `1000`). |
| `respectRobots` | boolean | no | Drop robots-disallowed URLs (default `true`). |
| `proxyUrl` | string | no | Proxy to route requests through. |

```json
{ "url": "https://docs.example.com", "includePaths": ["/docs/*"], "limit": 200 }
```

Returns `{ source: "sitemap" \| "llms-txt", count, urls: [{ url, lastmod? }], truncated?, offOrigin?, skippedByRobots?, warning?, tried? }`. `truncated: true` appears only when the list is incomplete: more URLs matched than `limit`, or the 50-file budget ended the walk of a large sitemap index. An empty list is never silent: with `count: 0` the result also carries `warning` (`no_sitemap_found` — nothing usable at any tried URL; `all_filtered` — entries existed but `includePaths`/`excludePaths`/robots removed them all; `budget_exhausted` — the 50-file budget ended the walk first; `blocked_by_robots` — the candidate files were not fetched because robots.txt disallows them) and `tried` (every URL actually requested, in order); it is not an error. A site published under a sub-path of a shared host (e.g. `https://user.github.io/project/`) is found because, when the origin root has nothing, the URL's own path is tried too: `<path>/sitemap.xml`, then `<path>/llms.txt` (at most those 2 extra requests; robots and network-guard rules unchanged).

---

### browser_shots_batch

Full-page **responsive screenshots for many URLs in parallel** — the visual counterpart of `browser_fetch_batch`. Each URL is rendered in a real browser at each viewport and saved as a PNG. Concurrency is **low by default (2)** — every page is a full Chromium instance. A failed URL becomes `{ url, error }`.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `urls` | string[] | yes | URLs to capture. |
| `viewports` | string | no | CSV of presets/sizes, e.g. `mobile,desktop,1280x720` (default `mobile,desktop`). |
| `settleMs` | integer | no | Settle delay before each capture. |
| `concurrency` | integer | no | Max browsers in flight (default `2`). |
| `engine` | string | no | Engine to launch. |
| `countryCode` | string | no | Identity country. |
| `headless` | boolean | no | Run headless (default true). |
| `proxyUrl` | string | no | Proxy to route through. |

```json
{ "urls": ["https://a.example", "https://b.example"], "viewports": "mobile,desktop" }
```

Returns `{ count, results: [{ url, shots: [{ viewport, width, height, path }] } | { url, error }] }`.

---

### browser_collect_batch

The collect side of **crawl + collect**: exhaust the **infinite-scroll / paginated list** of many listing URLs in parallel. One real browser per URL drains the page (scroll + dedup by row key) and returns all items. Low concurrency (default 2), jittered per-host throttle, per-URL error isolation. Use `browser_crawl` to find category/search pages, then drain each here.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `urls` | string[] | yes | Listing/search URLs to exhaust. |
| `item` | string | yes | CSS selector for one list row. |
| `container` | string | no | Scroll container selector (auto-detected if omitted). |
| `maxSteps` | integer | no | Max scroll steps per page (default 60). |
| `extractPrices` | boolean | no | Run the price extractor on each row. |
| `concurrency` | integer | no | Max browsers in flight (default 2). |
| `throttleMs` | integer | no | Jittered per-host gap between URLs (default 250; 0 disables). |
| `engine` / `countryCode` / `headless` / `proxyUrl` | — | no | Browser options. |

```json
{ "urls": ["https://site/search?q=x"], "item": ".listing-card", "extractPrices": true }
```

Returns `{ count, results: [{ url, count, steps, reachedEnd, items } | { url, error }] }`.

---

### browser_site_shots

**Full-site snapshot in one call**: crawl the site (HTTP fast-path, same-origin, robots-honored) then screenshot each discovered page. Returns **both** the content (markdown, from the crawl) **and** responsive full-page PNGs per page. For visual QA/audit, design review, or a regression baseline. Heavy — one browser per page — so `maxPages` stays modest and shots run at low concurrency.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `url` | string | yes | Seed URL. |
| `maxPages` / `maxDepth` | integer | no | Crawl bounds (default 25 / 2). |
| `sameOrigin` / `respectRobots` | boolean | no | Default true. |
| `throttleMs` | integer | no | Jittered per-host crawl gap (default 250). |
| `viewports` | string | no | CSV (default `mobile,desktop`). |
| `settleMs` | integer | no | Settle delay before each capture. |
| `shotsConcurrency` | integer | no | Max browsers in flight (default 2). |
| `engine` / `countryCode` / `headless` / `proxyUrl` | — | no | Browser options. |

```json
{ "url": "https://example.com", "maxPages": 20, "viewports": "mobile,desktop" }
```

Returns `{ count, pages: [{ url, depth, text, shots: [{ viewport, width, height, path }], shotsError? }] }`.

---

## Session

### browser_open

Open a persistent browser session and return `{ sessionId, expiresAt, identity }`. This is the canonical home of the **agentOptionShape** — every field below is also accepted by `browser_probe`, `browser_probe_html`, and `browser_serp_batch`.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `engine` | enum `playwright` \| `patchright` \| `firefox` \| `webkit` | no | Browser engine. |
| `channel` | enum `chrome` \| `chrome-beta` \| `chrome-dev` \| `chrome-canary` \| `msedge` \| `msedge-beta` \| `msedge-dev` \| `msedge-canary` | no | Installed browser channel (real Chrome/Edge). |
| `executablePath` | string | no | Path to a browser binary. |
| `cdpEndpoint` | string | no | Attach to an existing browser over CDP (local `http://localhost:9222` or remote `wss://…`, e.g. Browserless). |
| `cdpHeaders` | object | no | Extra headers for the CDP connect handshake (e.g. `{ "Authorization": "Bearer …" }`). |
| `cdpCloseOnDone` | boolean | no | Close the remote CDP session on teardown (default `true` for `ws/wss`). |
| `cdpTimeoutMs` | integer | no | CDP connect timeout (default `20000`). |
| `respectRobots` | boolean | no | Honor the origin's `robots.txt` (opt-in; off by default — nothing is blocked unless enabled). |
| `headless` | boolean | no | Run headless (set `false` for `browser_handoff`). |
| `humanMode` | boolean | no | Human-like timing/movement for actions. |
| `locale` | string | no | Browser locale (e.g. `en-US`). |
| `timezoneId` | string | no | IANA timezone (e.g. `Europe/Paris`). |
| `countryCode` | string | no | Country code for geo/identity. |
| `currency` | string | no | Currency hint. |
| `userDataDir` | string | no | Persistent profile directory. |
| `proxyUrl` | string | no | Single proxy URL. |
| `proxyMapPath` | string | no | Path to a per-domain proxy map. |
| `proxiesPath` | string | no | Path to a proxy pool file. |
| `storageStatePath` | string | no | Load/save cookies + localStorage. |
| `harPath` | string | no | Record/replay HAR file path. |
| `harMode` | enum `minimal` \| `full` | no | HAR recording detail. |
| `harReplay` | string | no | HAR file to replay responses from. |
| `realisticProfile` | boolean | no | Apply a realistic fingerprint profile. |
| `replayEnabled` | boolean | no | Enable action replay capture. |
| `replayDir` | string | no | Directory for replay artifacts. |
| `siteMemoryDir` | string | no | Directory for per-site action memory. |
| `outputDir` | string | no | Output directory for artifacts. |
| `retry` | object | no | `{ maxAttempts?, baseMs?, capMs?, throttleMs? }` (all integers). |
| `captcha` | object | no | `{ provider: "2captcha" \| "anticaptcha" \| "capmonster", apiKey, baseUrl?, timeoutMs?, pollMs? }`. |

```json
{ "engine": "patchright", "headless": false, "locale": "en-US", "proxyUrl": "http://user:pass@host:8000" }
```

### browser_status

Status of one session (by `sessionId`) or all sessions if omitted.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | no | Target session; omit for a list of all sessions. |

```json
{ "sessionId": "s_abc123" }
```

### browser_close

Close a browser session by id.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Session to close. |

```json
{ "sessionId": "s_abc123" }
```

### browser_connect

Launch an installed browser with remote debugging, attach to it, and return a session id. Drives the user's real browser.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `browser` | enum `dia` \| `chrome` \| `edge` \| `brave` \| `arc` | no | Known browser to launch (default `chrome`). |
| `executablePath` | string | no | Explicit binary path (overrides `browser`). |
| `port` | integer | no | Remote-debugging port (default `9222`). |
| `userDataDir` | string | no | Profile directory for the launched browser. |
| `launch` | boolean | no | If `false`, attach to an already-running instance instead of spawning. |

Browser lookup (when `browser` is used instead of `executablePath`) is **platform-aware**: macOS resolves fixed `.app` bundle paths, Linux resolves common binary names (`google-chrome`, `chromium`, `microsoft-edge`, `brave-browser`, …) via `PATH`, and Windows probes standard install roots (`%ProgramFiles%`, `%LOCALAPPDATA%`). Every candidate is checked to exist on disk before being spawned; if none resolves, the tool returns `browser_not_found` listing what was tried. A spawn failure (bad `executablePath`, missing binary) is also returned as a structured `browser_spawn_failed` error — it never crashes the server.

```json
{ "browser": "chrome", "port": 9222 }
```

### browser_tabs

Manage the tabs of a live session: list them, open a new tab (optional `url`), select one as the active target of every other `browser_*` tool, or close one. Use it when a click spawned a popup (OAuth login, `target=_blank` link): `list` to find it, `select` to drive it, `close` then `select` to come back.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Target session. |
| `action` | enum `list` \| `new` \| `select` \| `close` | yes | Tab action to perform. |
| `index` | number | no* | Tab index (**required** for `select`/`close`; `missing_index` error otherwise). |
| `url` | string | no | URL to open in the new tab (for `new`). |

Always returns the tab list plus the active index after the action: `{ tabs, active }`. Closing the last tab is refused (`cannot_close_last_tab`) — use `browser_close` to end the session. An out-of-range `index` returns `invalid_tab_index`.

```json
{ "sessionId": "s_abc123", "action": "select", "index": 1 }
```

### browser_dialog

Set how native dialogs (`alert`/`confirm`/`prompt`/`beforeunload`) are handled on this session: accept or dismiss, with optional text for prompts. Applies to **upcoming** dialogs; the default policy (before any call) is **dismiss**. Dialog handling is auto-attached when the session opens, so dialogs never block a run.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Target session. |
| `action` | enum `accept` \| `dismiss` | yes | Policy applied to upcoming dialogs. |
| `promptText` | string | no | Text typed into `prompt` dialogs when accepting. |

Returns `{ policy, recent }` — `recent` is the last observed dialogs (max 20, oldest first), each `{ type, message, at, handled }`.

```json
{ "sessionId": "s_abc123", "action": "accept", "promptText": "yes" }
```

### browser_downloads

List the files downloaded by this session. Download capture is auto-attached when the session opens: every download is saved under `<outputDir>/downloads/<suggestedFilename>` (suffixing `-1`, `-2` on name collisions) and recorded.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Target session. |
| `read` | number \| string | no | Index in the list, or a `suggestedFilename`, of the download whose content to also return. |
| `encoding` | `"utf8"` \| `"base64"` | no | How to decode the read file. Default `utf8`. Use `base64` for binary files (PDF, images, archives). |

Returns `{ count, downloads }` — each download is `{ url, suggestedFilename, path, at, error? }` (`path` is empty while saving or when `error` is set).

When `read` is given, the result also includes `content: { filename, encoding, data }`. Files over 5 MB, an invalid index/filename, or a file not yet on disk return an error (`code: DOWNLOAD_READ_FAILED`). Without `read`, the behaviour is unchanged (list only).

```json
{ "sessionId": "s_abc123" }
```

```json
{ "sessionId": "s_abc123", "read": 0, "encoding": "utf8" }
```

```json
{ "sessionId": "s_abc123", "read": "invoice.pdf", "encoding": "base64" }
```

---

## Navigate

### browser_navigate

Navigate a live session to a URL; returns the resulting `{ url, title }`.

When the live page is an anti-bot interstitial the result also carries `blocked: true`, `blockedBy` (`cloudflare` \| `datadome` \| `aws-waf` \| `unknown`) and a `hint` with the next tools (wait and call `browser_extract` again, retry from a headed `browser_open`, `browser_handoff` when the page shows a CAPTCHA/Turnstile step; never a solver). Same fields on `browser_extract`. Normal pages return exactly the fields above, nothing added. Detection is the `browser_fetch` table detector on the rendered HTML plus the challenge evidence of `browser_extract kind:"challenges"`: a Cloudflare challenge marker, a Cloudflare 1xxx block page, an AWS WAF interstitial, or — on a page with under 600 characters of text — a DataDome challenge or a bare CAPTCHA/Turnstile widget element or iframe with no fillable field (`unknown`). A login or contact form with a widget, a page that only loads a captcha `<script>`, a long page, or an article that names Cloudflare is not reported. Akamai/PerimeterX "Access Denied" pages are not detected on session routes (a rendered page has no HTTP status, which the weak-signal rule needs).

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Target session. |
| `url` | string | yes | Destination URL. |
| `waitMs` | integer | no | Extra wait (ms) after load. |

```json
{ "sessionId": "s_abc123", "url": "https://example.com" }
```

### browser_back

Navigate back in session history.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Target session. |

Success (`ok`) is decided from the URL before vs. after, not from Playwright's navigation response — same-document SPA history (`history.pushState` then back/forward) resolves `ok:true` with the new URL even though Playwright itself returns no navigation response for it. A slow page whose load hasn't settled within the internal timeout still reports `ok:true` (URL already changed) with `warning:"load_timeout"`, instead of throwing. When there really is no history to go to, it returns `ok:false` with `reason:"no_history"`.

```json
{ "sessionId": "s_abc123" }
```

### browser_forward

Navigate forward in session history. Same `ok`/`warning`/`reason` semantics as [`browser_back`](#browser_back).

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Target session. |

```json
{ "sessionId": "s_abc123" }
```

### browser_wait

Wait for a fixed number of milliseconds.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Target session. |
| `ms` | integer | yes | Milliseconds to wait. |

```json
{ "sessionId": "s_abc123", "ms": 1500 }
```

### browser_wait_for

Wait until a semantic condition holds: text appears, selector visible, selector gone, or URL contains a substring. Prefer over fixed delays.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Target session. |
| `text` | string | no | Wait until this text appears. |
| `selector` | string | no | Wait until this selector is visible. |
| `gone` | string | no | Wait until this selector disappears. |
| `urlContains` | string | no | Wait until the URL contains this substring. |
| `timeoutMs` | integer | no | Max wait before failing. |

```json
{ "sessionId": "s_abc123", "selector": "#results", "timeoutMs": 10000 }
```

---

## Act

### browser_click

Click a target in the session. Like every session action tool (`browser_click`/`fill`/`scroll`/`press`/`type`/`select`/`back`/`forward`/`wait`/`login`) the result also carries `effect: { urlChanged, domChanged, settleMs }` — cheap signals (URL compared, DOM signature compared, one 150 ms re-read when nothing changed yet), so a click that did nothing is visible as `domChanged:false`. `ok` keeps its meaning.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Target session. |
| `target` | string | yes | Selector or text of the element to click. |
| `confirmSensitive` | boolean | no | Opt-in (default off; env `FUSE_CONFIRM_SENSITIVE=1` enables it globally): a click whose live element name matches the destructive/payment vocabulary (`src/actions/sensitive-vocab.ts`) returns `error:"confirmation_required"` + `element` without clicking. |
| `confirmed` | boolean | no | Repeat the call with `true` to proceed after a `confirmation_required`. |

`effect.settleMs` is 150 when nothing changed immediately (one extra DOM re-read) and 0 for `browser_scroll` and `browser_wait`, which skip it. Measured on a 9,000-node page: DOM signature 3-4 ms, a no-op click with effect about 205-240 ms in total, a scroll 7-8 ms. `browser_run` steps do not carry `effect`. `browser_press` takes the same `confirmSensitive`/`confirmed`: Enter/Space on a focused destructive/payment-looking control is paused. Vocabulary (`src/actions/sensitive-vocab.ts`): "Unsubscribe"/"Se désabonner", delete/supprimer, deactivate, cancel subscription, pay/buy/checkout/payer/acheter...; "Remove"/"Erase"/"Effacer" count only with an object (account, card, all, everything, data, history); a plain "Subscribe" is not a payment.

```json
{ "sessionId": "s_abc123", "target": "Sign in" }
```

### browser_fill

Fill a field in the session.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Target session. |
| `target` | string | yes | Selector or label of the field. |
| `value` | string | no | Value to type (omit when using `credentialRef`). |
| `credentialRef` | string | no | Fill a vault secret by reference instead of `value` — resolved server-side, never exposed to the LLM. |
| `field` | enum `username`/`password`/`totp` | no | Which credential field to fill when `credentialRef` is set (default `password`). |

```json
{ "sessionId": "s_abc123", "target": "#otp", "credentialRef": "github", "field": "totp" }
```

### browser_login

Structured login (username + password + submit).

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Target session. |
| `username` | string | no | Username/email value (omit when using `credentialRef`). |
| `password` | string | no | Password value (omit when using `credentialRef`). |
| `credentialRef` | string | no | Fill username + password from the vault — resolved server-side, never exposed to the LLM, and refused off the credential's bound origin (anti-phishing). |
| `usernameTarget` | string | no | Selector for the username field (auto-detected otherwise). |
| `passwordTarget` | string | no | Selector for the password field. |
| `submitTarget` | string | no | Selector for the submit button. |

```json
{ "sessionId": "s_abc123", "credentialRef": "github" }
```

### browser_scroll

Scroll by a pixel delta, or jump to the end of a scrollable container.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Target session. |
| `deltaY` | number | no | Vertical scroll (positive = down, default `600`). |
| `deltaX` | number | no | Horizontal scroll (default `0`). |
| `selector` | string | no | Scroll a specific container (auto-detected when omitted with `to`). |
| `to` | enum `end` | no | Jump to the container's bottom. |

```json
{ "sessionId": "s_abc123", "selector": "#list", "to": "end" }
```

### browser_press

Press a key or shortcut (e.g. `Enter`, `ArrowDown`, `Control+a`).

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Target session. |
| `key` | string | yes | Key or shortcut to press. |

```json
{ "sessionId": "s_abc123", "key": "Enter" }
```

### browser_type

Type text into whatever element currently has focus — no `ref`/`target` (it drives `page.keyboard.type`, not a locator). Use for elements a ref can't reach, e.g. a closed shadow-DOM search input: `browser_click` the field first, then `browser_type`.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Target session. |
| `text` | string | yes | Text to type into the focused element. |

```json
{ "sessionId": "s_abc123", "text": "iphone" }
```

### browser_select

Select an option in a `<select>` by value, label, or index.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Target session. |
| `target` | string | yes | Selector of the `<select>`. |
| `value` | string | yes | Value, label, or index to select. |

```json
{ "sessionId": "s_abc123", "target": "#country", "value": "France" }
```

---

## Agentic

### browser_snapshot

Return the indexed interactive elements of the live page, each with a `ref` to use with `browser_act`. Pierces open Shadow DOM and iframes (same- and cross-origin); sub-frame refs look like `"3:4"`.

Refs are stamped once per element and never renumbered: inserting an element before another does not move its ref. A node cloned from a stamped one (`cloneNode`) copies the stamp but not the in-page record of who received it, so a walk gives the clone a fresh id and an action on the old ref never lands on a clone (`ambiguous_ref` / `not_original` / `element_gone`). Refs are unique across the tabs of a session: each tab gets a 10,000,000-wide slot in the order of its first snapshot (the first tab numbers from 0), never reused after a tab is closed (still plain numbers, same `"3:4"` frame form), so a ref from another tab is refused. Past the end of a tab's slot nothing more is stamped and the snapshot reports `truncated`. The server remembers what each ref was (tag, role, id, name, type, href, text, frame); `browser_act`, `browser_inspect` and `browser_screenshot` with a `ref` refuse with `error:"ref_stale"` (plus `reason`, `expected`, `found`, `generation`, `hint:"call browser_snapshot again"`) when the node is gone, was replaced, or now shows other content — they never act on another element. Each snapshot returns a `generation` (new on every `browser_snapshot`, `annotate`, or `browser_act annotate:true`); only the latest snapshot's refs (plus elements added by an action, from its `diff.added`) are accepted. A label that changes on the same node ("Follow" to "Following", "Cart (1)" to "Cart (2)") is accepted: the action proceeds and `result.refNote:{nameChanged:{from,to}}` says so; a label change together with any other identity change (tag, role, id, name, type, href, frame, document) is still refused. A page (tab, or a page recovered after a crash) with no `browser_snapshot` of its own accepts no ref: the call is refused with `ref_stale` and `reason:"no_snapshot"`.

The output also carries `truncated` and `dropped`: the caps (200 elements per frame, 400 in total) are no longer silent; when a cap hides matches, `truncated:true`, `dropped` is the number of matches not returned (an upper bound: it may include elements `prune` would have removed) and `hint` says what to do.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Target session. |
| `selectors` | boolean | no | Also return a durable CSS `selector` per element (cacheable to act later without re-snapshotting). |
| `prune` | boolean | no | Drop only genuinely hidden or decorative elements (default `false`, output unchanged). When `true`, prunes an element iff it is **CSS-hidden** — `display:none`/`visibility:hidden`/`collapse`/`content-visibility` on itself or an ancestor, via `Element.checkVisibility()` — **or decorative**: under an `aria-hidden="true"` ancestor **and** not focusable. A **visible, focusable** element is **kept even under an `aria-hidden` ancestor**, so the controls of an **open modal** (whose SPA focus-trap marks a root/sibling wrapper `aria-hidden`) stay in the snapshot. Never prunes on off-screen, `opacity:0`, or off-viewport position. |
| `annotate` | boolean | no | Also return a Set-of-Marks JPEG: numbered badges (= each `ref`) drawn over the page, for vision models (main-frame, viewport-only). |
| `within` | string | no | Scope to a subtree: a `ref` or a CSS selector (see below). |

```json
{ "sessionId": "s_abc123", "annotate": true }
```

```json
{ "sessionId": "s_abc123", "prune": true }
```

`within` scopes the snapshot to a subtree: a snapshot `ref` (that element and its descendants) or a CSS selector (every match, in every frame). Output gains `scope:{matched, error?}` (`matched:0` = nothing matched; `error:"invalid_selector"`). Refs keep their stamps and are guarded exactly like full-snapshot refs; a scoped snapshot starts a new `generation` but keeps every ref already accepted (it adds, never drops). A `within` ref that is no longer the element you saw returns no elements with `scope.error:"ref_stale"`. Limits: a CSS `within` does not enter shadow roots (use a host selector or a ref), and `within` set to an `<iframe>` element does not include the frame's content (snapshot the frame's controls with a selector valid inside it). Absent = the whole page, output unchanged (no `scope` key).

```json
{ "sessionId": "s_abc123", "within": "form#checkout" }
```

### browser_find

Find interactive elements by accessible name, role or text and get their `ref`s without a full `browser_snapshot`. Every word of `query` must match (case-insensitive) in the element's text, name, placeholder, role, tag, id, value or type; exact and prefix name matches rank first, then DOM order. The refs are registered like snapshot refs: actionable with `browser_act`, refused with `ref_stale` if the element changed.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Target session. |
| `query` | string | yes | Words to look for. |
| `limit` | integer | no | Matches returned (default 10, max 50). |

Output: `{ url, query, generation, total, count, matches[], truncated, dropped, hint? }` — `total` is the number of matches, `matches` the best `limit` (same element shape as `browser_snapshot`). The search covers the same capture as `browser_snapshot`, including its caps (200 per frame, 400 total): when `truncated:true` a miss does not prove absence (scroll, or use `browser_snapshot` `within`). The text searched is the element's visible text, else its `aria-label`/placeholder (so an icon button showing "×" labelled "Close" is not found by "close"), cut at 120 characters. `generation` moves when a frame's document changed since the last snapshot/find (ref numbers restart per document).

```json
{ "sessionId": "s_abc123", "query": "sign in", "limit": 3 }
```

### browser_verify

Check that a page meets YOUR expectations and get a receipt, in one call. Deterministic: no model decides anything, every verdict comes from an expectation you wrote. Give `url` (loads it; without `sessionId` a temporary session is opened with the usual browser options and closed afterwards) and/or `sessionId` (verifies the session's current page, or loads `url` in it first).

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `url` | string | one of | Page to load. |
| `sessionId` | string | one of | Existing session. |
| `expect` | array | yes | Expectations (at least one; an empty list is rejected). Each is exactly one of `{ "text": "..." }` (the visible body text contains it, case-sensitive), `{ "visible": "css selector" }` (first match is visible), `{ "noConsoleErrors": true }`, `{ "noFailedRequests": true }` (no response with status >= 400 since the verification started). |
| `baseline` | string | no | A previous `after.png` or `receipt.md`: `evidence.diff` reports the pixel change. Informational, it never fails the verification; a baseline that cannot be found is a failed expectation (`baseline_not_found`). |
| `evidenceDir` | string | no | Where the evidence goes (default `<outputDir>/verify/verify-<time>-<session>/`). Confined like screenshot paths: with `FUSE_CONFINE_WRITES` set, a directory outside the root is refused (`path_outside_confinement`) and nothing is written. |
| `fullPage` | boolean | no | Full-page after screenshot. |
| (browser options) | | no | `engine`, `headless`, `outputDir`... as in `browser_open`, used when `url` is given without `sessionId`. |

Output: `{ pass, url, title, failed[], consoleAvailable, evidence, blocked?, blockedBy?, hint? }`.
- `failed[]` = `{ expect, reason, detail? }`. Reasons: `text_not_found`, `not_visible`, `selector_not_found`, `invalid_selector`, `failed_requests` (`detail`: the URLs with status or network error), `console_errors` (`detail`: the messages), `page_errors` (uncaught exceptions, `detail`: the messages), `console_unavailable_on_patchright`, `baseline_not_found`, `blocked:<vendor>`. Empty `text`/`visible` strings are rejected at input.
- `pass` is true only if nothing failed AND the page is not an anti-bot interstitial that the session detector recognises (Cloudflare, DataDome, AWS WAF, a bare captcha/Turnstile widget): then it fails with `blocked:<vendor>` plus the session `blocked`/`blockedBy`/`hint` fields, whatever the other expectations say. Limits: other walls (Akamai, PerimeterX...) are not detected on session routes, a detector error means "no verdict", and the HTTP status of the main document is not checked (a 500 page that contains your text passes).
- Console: capture is disabled upstream on the default `patchright` engine, and so are uncaught-exception events (measured). A clean `noConsoleErrors` there fails with `console_unavailable_on_patchright` and `consoleAvailable:false` rather than passing silently. Use `engine:"playwright"` to check the console and uncaught exceptions (`page_errors`).
- Failures: with `url`, every failed request during the load is recorded individually (a 500 followed by a 200 on the same URL still fails; not subject to the session log cap): HTTP >= 400 and network errors (cancelled requests excluded). Without `url`, only the session's own buffers are checked (last 250 requests, no exceptions); that buffer never records network failures, so, failing closed, a request with no matching response counts as failed (`error:"no_response"`): a still-pending long-poll request can therefore fail the check.
- Window: with `url`, only what happens from the load on counts; entries from earlier calls do not leak in.
- A `receipt.md` baseline must name an `after.png` (as the receipts written by this tool do); anything else is `baseline_not_found`.
- Confinement covers the evidence directory including the default `<outputDir>/verify/`. In `url`-only mode the temporary session's config may create `<outputDir>/site-memory` before the check (unavoidable: it is created when the config is resolved).
- `evidence` = `{ before?, after, diff?, consoleLog, networkLog, receiptMd }`: file paths for `after.png`, `console.json`, `network.json`, `receipt.md` (a short Markdown table of expectations and evidence paths), plus `before` (the baseline PNG used) and `diff` (`{image?, diffPixels, diffRatio, regions, changed, error?}`; `diff.png` is written when the sizes match, `error:"dimension_mismatch"` counts as changed).
- Not included: video/screencast, tracing, accessibility audit.

```json
{ "url": "https://example.org", "expect": [{ "text": "Example Domain" }, { "visible": "h1" }, { "noFailedRequests": true }] }
```

### browser_act

Execute click/fill/select/pick/upload/hover/drag on an element by `ref` (from `browser_snapshot`) or by `target` text. Returns a diff of what changed on the page (added/removed/text/url), the same `effect:{urlChanged,domChanged,settleMs}` as the action tools (around the action itself; covers hover/drag/upload), and the current `generation`. A stale `ref` (or drag destination `to`) is refused with `error:"ref_stale"` (see `browser_snapshot`). Opt-in `confirmSensitive:true` (or env `FUSE_CONFIRM_SENSITIVE=1`): a `click` on a destructive/payment-looking control returns `error:"confirmation_required"` with `category` and `element` and does not click; repeat with `confirmed:true`. Default off.

`pick` = type `value` into a combobox, then click the matching suggestion (`option` text, defaults to `value`) — for airport/city autocompletes.

`upload` = set local file path(s) on an `<input type=file>` via `files` (single path, a comma-separated string, or an array). Resolves the same `ref`/`target` as the other kinds, then calls Playwright's `setInputFiles`.

`hover` = move the pointer over the element (Playwright's `locator.hover()`) — reveals hover menus/tooltips so a follow-up `browser_snapshot` sees the newly-shown elements.

`drag` = drag the source element (`ref`/`target`) onto a destination given by `to` (a snapshot `ref` or a CSS selector), via Playwright's `locator.dragTo()`.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Target session. |
| `kind` | enum `click` \| `fill` \| `select` \| `pick` \| `upload` \| `hover` \| `drag` | yes | Action to perform. |
| `ref` | integer \| string | no | Element ref from `browser_snapshot` (e.g. `12` or `"3:4"`). |
| `target` | string | no | Text/selector fallback when no `ref`. |
| `value` | string | no | Value to type/select (for `fill`/`select`/`pick`). |
| `option` | string | no | Suggestion text to click for `pick` (defaults to `value`). |
| `files` | string \| string[] | no | File path(s) for `upload` — one path, a comma-separated string (split into many), or an array. |
| `to` | string | no | Drop destination for `drag` — a snapshot `ref` (e.g. `"7"`) or a CSS selector. |
| `annotate` | boolean | no | Also return a Set-of-Marks JPEG of the NEW state (re-marked, anti-drift). |

Provide either `ref` or `target`.

```json
{ "sessionId": "s_abc123", "kind": "fill", "ref": 12, "value": "Paris" }
```

```json
{ "sessionId": "s_abc123", "kind": "upload", "target": "input[type=file]", "files": "/path/cv.pdf" }
```

```json
{ "sessionId": "s_abc123", "kind": "hover", "ref": 5 }
```

```json
{ "sessionId": "s_abc123", "kind": "drag", "ref": 3, "to": "7" }
```

### browser_run

Execute an ordered multi-step plan (navigate, click, fill, scroll, press, select, upload, wait_for, extract) in one call. Stops at the first failed step. Sensitive actions require `humanApproved`. An `upload` step takes `{type:"upload", target, files}` where `files` is a path, a comma-separated string, or an array.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Target session. |
| `steps` | array of `{type, ...}` | yes | Ordered steps (loose: `type` + arbitrary fields). |
| `humanApproved` | boolean | no | Authorize sensitive steps (preflight gate). |

```json
{ "sessionId": "s_abc123", "steps": [{ "type": "navigate", "url": "https://x.com" }, { "type": "click", "target": "Next" }] }
```

### browser_collect

Scroll a virtualized/infinite list and return the deduped union of its rows — items beyond the first screen that a single snapshot misses. Returns DATA (key/text/url/prices), not actionable refs. To act on a found row, use `browser_act` by text, or `browser_scroll(selector)` then `browser_snapshot`.

The optional `pipeline` runs a declarative clean→validate→dedupe→emit pass over collected rows — see [extraction](./extraction.md).

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Target session. |
| `item` | string | yes | CSS selector for a single row. |
| `container` | string | no | Scrollable container selector (auto-detected otherwise). |
| `maxSteps` | integer | no | Max scroll iterations. |
| `extractPrices` | boolean | no | Extract prices from each row. |
| `pipeline` | object | no | `{ clean?: {numericFields?}, validate?: {field→rule}, dedupeBy?, keep?: "first"\|"last", columns?, emit?: "json"\|"csv" }`. See [extraction](./extraction.md). |

```json
{ "sessionId": "s_abc123", "item": ".result-card", "extractPrices": true, "maxSteps": 20 }
```

### browser_autoscroll

Repeatedly scroll a long / infinite list to the bottom to trigger lazy-load until it stabilises — run it **before** `browser_extract` / `browser_collect` / `browser_products` on lazy-loaded result pages so every item is in the DOM. Stops after `idleRounds` rounds without growth, at `maxScrolls`, or once `untilSelector` reaches `minCount` elements.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Target session. |
| `maxScrolls` | integer | no | Hard cap on scroll rounds. |
| `idleRounds` | integer | no | Stop after this many rounds with no height growth. |
| `untilSelector` | string | no | Stop once this selector reaches `minCount` matches. |
| `minCount` | integer | no | Element count target for `untilSelector`. |
| `delayMs` | integer | no | Pause between scroll rounds. |

Returns `{ rounds, height, url }`.

```json
{ "sessionId": "s_abc123", "untilSelector": ".result-card", "minCount": 100 }
```

---

## Extract

### browser_extract

Extract text, prices, hotel offers, and/or challenges from the live page.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Target session. |
| `kind` | enum `text` \| `prices` \| `hotels` \| `challenges` \| `all` | no | What to extract (default `all`). |

`challenges` returns `{ captcha, turnstile, hcaptcha, cloudflare, login, otp, awsWaf }`. A flag fires on challenge **evidence**, not on a word in the page content: `turnstile` / `hcaptcha` need the widget (element, iframe or script), `cloudflare` needs the Cloudflare challenge marker (`_cf_chl_opt = {` in a script, the same signal as the `browser_fetch` blocked detector), or a **thin** page (< 600 chars of text) carrying the interstitial sentence "checking if the site connection is secure", or an error code `1000`–`1015`/`1020` together with "Ray ID" (Cloudflare 1xxx hard-block pages; matched on text because Cloudflare publishes no default-page markup, and covered by synthetic fixtures only, no real capture). An article that names Cloudflare, Turnstile or "Error 1020" no longer sets the flags.

`login` semantics changed (measured by `tests/unit/challenges-evidence.test.ts`): it is `true` when the page has an `input[type=password]`, **or** an `input[autocomplete=username]` (so a username-first step with no password field is `true`), **or** login-wall wording (`sign in to…`, `log in with…`, `please sign in`, `you must be logged in`, whitespace/newlines tolerated). A page whose only sign-in signal is a nav link (`Sign in` / `Log in`) is now `false` (it was `true`). A username-first form with none of those three cues would also be `false`. `captcha` is evidence-based too: it is `true` on a vendor widget (reCAPTCHA, hCaptcha, Arkose/FunCaptcha, DataDome `captcha-delivery`: element, iframe, script or response field) or a `<form>` with a captcha image and a text input; the words "captcha" / "I'm not a robot" in the text no longer set it (Turnstile keeps its own flag). `awsWaf` is `true` on the `awsWafCookieDomainList` global or a script naming it (the global alone is invisible to `page.evaluate` on the default patchright engine, measured), or `chal_t=` in the URL. The AWS WAF integration SDK (`AwsWafIntegration.getToken()`, `jsapi.js`) that AWS documents for normal protected pages does **not** set it. A page rendering the AWS WAF CAPTCHA puzzle (`AwsWafCaptcha.renderCaptcha`) sets `captcha`. A probe using a pool proxy reports it as blocked when `cloudflare`, `captcha` or `awsWaf` is set. `otp` is unchanged.

```json
{ "sessionId": "s_abc123", "kind": "prices" }
```

### browser_extract_schema

Extract typed data from the live page via a field map. Deterministic; reads the rendered DOM, so it works on Next.js/SPA pages.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Target session. |
| `schema` | record of `field → fieldSpec` | yes | Map of output field to a `fieldSpec`. |

`fieldSpec`: `{ selector: string, attr?: string, all?: boolean, abs?: boolean }` — `attr` reads an attribute instead of text, `all` returns an array of matches, `abs` resolves URLs to absolute.

```json
{
  "sessionId": "s_abc123",
  "schema": {
    "title": { "selector": "h1" },
    "links": { "selector": "a", "attr": "href", "all": true, "abs": true }
  }
}
```

### browser_products

Extract structured **per-card** product rows from an e-commerce / search-results page: one `{title, price, currency, url?}` per card, each price tied to its own title (unlike flat price scraping). Generic — detects repeated card containers by structure, so it works on Digitec, Booking, Amazon… Prices are parsed **layout-agnostically** (prefix/suffix currency, thousands/decimal markup, CH/EU formats). Sort the rows by price to answer "which is the cheapest?". Also exposed as the CLI `products` command.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Target session. |
| `limit` | integer | no | Cap the number of returned rows. |
| `containerSelector` | string | no | Pin the card-container selector (auto-detected otherwise). |

Returns `{ url, count, products: [{ title, price, currency, url? }] }`.

```json
{ "sessionId": "s_abc123", "limit": 20 }
```

---

## SERP

### browser_serp_batch

Run several Google searches in one session; returns per-query organic results and optional domain rank. Sequential and throttled (small batches; high volume needs proxies). Accepts the full [agentOptionShape](#browser_open).

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `queries` | array of string | yes | Search queries to run. |
| `rankDomain` | string | no | Report the SERP rank of this domain per query. |
| `pages` | integer | no | SERP pages per query (default `1`). |
| `hl` | string | no | Google UI language (e.g. `en`). |
| `gl` | string | no | Google country (e.g. `us`). |
| `delayMs` | integer | no | Delay between queries. |
| _+ all_ [agentOptionShape](#browser_open) | — | no | Engine, proxy, identity, etc. |

Returns `{ rows: [{ query, results: [{ position, title, url, displayUrl?, snippet?, redirect? }], rank?, error?, warning? }] }`.

- **`redirect: true`** — Google's current layout links every organic result as `https://www.google.com/goto?url=<opaque>&gsessionid=…`; the destination is not in the page (the `url` value is an opaque binary token and the `cite` breadcrumb in `displayUrl` is abbreviated and can omit path segments, e.g. `https://host › docs › release` for `https://host/mcp-playwright/docs/release`). `url` is then the wrapper, not the destination. Measured 2026-11-11: a `browser_fetch` of one captured wrapper, outside the SERP session, returned status 200 with the destination as final `url`, so the wrapper is usable as a link (token expiry not measured). With a direct-link layout `url` is the destination and `redirect` is absent. `rankDomain` matches a redirect result on the host of its `displayUrl`.
- **`warning`** — present only when `results` is empty and there is no `error`: `no_results_extracted` (a results page where nothing was extracted: layout change, or a query with no hits), `consent_wall` (a `consent.google.*` page), `blocked` (Google `/sorry/` page or a reCAPTCHA). Rows with results are unchanged.

> The CLI exposes a `--csv` output flag for this command; it is **CLI-only** and not an MCP parameter. (The probe flag `serpPages` is the equivalent of `pages` for `browser_probe`'s inline SERP extraction.)

```json
{ "queries": ["best running shoes", "trail shoes"], "rankDomain": "example.com", "pages": 2, "gl": "us" }
```

---

## Vision

### browser_screenshot

Capture the live page as PNG(s) for vision. Pass `ref` for one element, `viewport` for one size, or `viewports` for a responsive set.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Target session. |
| `fullPage` | boolean | no | Capture the full scrollable page. |
| `ref` | integer \| string | no | Screenshot a single element by ref. |
| `viewport` | enum `mobile` \| `tablet` \| `desktop` _or_ `{width, height}` | no | Capture at one viewport size. |
| `viewports` | array of the above | no | Capture across several viewport sizes. |
| `colorScheme` | enum `light` \| `dark` | no | Emulate `prefers-color-scheme` and toggle `themeClass` on `<html>`, then restore. |
| `themeClass` | string | no | Class toggled on `<html>` for class-based dark themes (default `dark`). |
| `annotate` | boolean | no | Set-of-Marks JPEG: numbered badges (= each `ref`) over the viewport, for vision models. |
| `path` | string | no | Also write the captured image to disk and return its `path` in `structuredContent`. Single-image captures only. Without `path`, the image is returned base64-inline as before (unchanged). |

When `path` is set, its extension must match the output mime — `.png` for element/page/multi captures, `.jpg`/`.jpeg` for the `annotate` JPEG. Error codes:

- `path_multi_viewport_unsupported` — `path` given with `viewports.length > 1` (multiple images); use a single viewport with `path`.
- `path_extension_mismatch` — `path`'s extension does not match the output mime (e.g. `.png` for the `annotate` JPEG, or `.jpg` for a PNG capture).
- `path_outside_confinement` — only when `FUSE_CONFINE_WRITES=<root>` is set (see [configuration](./configuration.md)): `path` does not canonicalize under that root. Unset by default (`path` writes wherever the caller asks, unchanged).

```json
{ "sessionId": "s_abc123", "annotate": true, "colorScheme": "dark" }
```

```json
{ "sessionId": "s_abc123", "fullPage": true, "path": "./shots/home.png" }
```

### browser_inspect

Computed styles, box model and WCAG text-contrast (AA/AAA) for one element by `ref` — for design review (typography, color, spacing, contrast). Main-frame refs.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Target session. |
| `ref` | integer \| string | yes | Element ref from `browser_snapshot`. |

```json
{ "sessionId": "s_abc123", "ref": 12 }
```

### browser_visual_diff

Pixel-compare the live page against a `baseline` PNG (created on the first call, diffed on later calls), or two explicit PNGs (`a` + `b`). Returns `diffPixels`/`diffRatio` and changed-region boxes, and writes a highlighted `<path>.diff.png`. Fails if image sizes differ.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | no* | Session to screenshot (required with `baseline`). |
| `baseline` | string | no* | Baseline PNG path (created first run, then diffed). |
| `a` | string | no* | First PNG path (explicit two-image mode). |
| `b` | string | no* | Second PNG path; diff written to `<b>.diff.png`. |
| `fullPage` | boolean | no | Full-page capture in baseline mode. |
| `threshold` | number | no | Per-pixel match threshold (default `0.1`). |

\* Provide **either** `a` + `b`, **or** `sessionId` + `baseline`.

```json
{ "sessionId": "s_abc123", "baseline": "./baselines/home.png", "fullPage": true, "threshold": 0.1 }
```

---

## Human

### browser_handoff

Pause the agent and let a human complete a step in the live browser (login / 2FA / hard captcha), then resume when `url` (substring/regex) or `selector` appears. Same session, so auth carries over. Needs `headless:false` for a human to actually interact (headless still waits but surfaces a warning).

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Target session. |
| `reason` | string | no | Human-readable reason for the handoff. |
| `url` | string | no | Resume when the URL matches (substring; `*` becomes regex). |
| `selector` | string | no | Resume when this selector appears. |
| `timeoutMs` | integer | no | Max wait before timing out (default `300000`). |

If neither `url` nor `selector` is given, it resumes on the next navigation.

```json
{ "sessionId": "s_abc123", "reason": "Solve captcha", "selector": "#dashboard", "timeoutMs": 300000 }
```

---

## Diagnostics

### browser_metrics

Read the process-global scraping metrics: a point-in-time snapshot of probe counts, durations, resilience rejections, the live probe-queue depth, RSS and uptime. No session needed. Pass `reset:true` to zero the counters after reading (e.g. at the start of a new job).

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `reset` | boolean | no | Zero all counters **after** returning the snapshot. |

Returned fields: `uptimeMs`, `probesOk`, `probesFailed`, `avgDurationMs`, `minDurationMs`, `maxDurationMs`, `breakerRejects` (requests blocked by an open [circuit breaker](./configuration.md#circuit-breaker)), `queueRejects` / `budgetRejects` (from the [probe queue](./configuration.md#probe-queue)), `queue` (`{ running, admitted, waiting }`), `rssBytes`. Counters are process-global and persist until reset; the HTTP fast-path is not counted (only browser probes).

```json
{ "reset": false }
```

### browser_console

Console messages captured in the session since open (last 80 kept). Use to debug JS errors, CSP violations, or why a page misbehaves.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Target session. |
| `level` | enum `error` \| `warning` \| `info` \| `log` \| `debug` | no | Keep only this console message type. |
| `limit` | number | no | Last N entries returned (default `50`). |

Returns `{ count, entries }`. **Limitation**: the default `patchright` engine deliberately disables Chromium's whole Console API upstream (an anti-detection patch), so an empty buffer on that engine returns `{ count:0, entries:[], unavailable:"console_disabled_on_patchright", hint:"reopen the session with engine:\"playwright\" to capture console output" }` instead of a bare `count:0` — the tool never silently implies "no console messages" when the API itself is unavailable.

```json
{ "sessionId": "s_abc123", "level": "error", "limit": 20 }
```

### browser_network

Network requests captured in the session since open (last 80 kept), merged into one row per URL: `method`, `url`, `status`, `resourceType`. Use to debug why a page does not load: failed requests (`status: 404/500`), blocked APIs (`urlContains`). Entries without `status` got no response (pending/failed).

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Target session. |
| `status` | number | no | Keep only rows with this exact HTTP status. |
| `urlContains` | string | no | Keep only rows whose URL contains this substring. |
| `limit` | number | no | Last N rows returned (default `50`). |

Returns `{ count, requests }`.

```json
{ "sessionId": "s_abc123", "status": 404 }
```

### browser_pdf

Render the live page to PDF. **Headless chromium only** — Playwright's `page.pdf()` throws in headed mode or on a non-chromium engine; in that case the tool returns a clear error (`code: pdf_unsupported`, message `browser_pdf requires headless chromium`). With `path` the PDF is written to disk; otherwise it is returned base64-encoded. `path` must end in `.pdf`, else `path_extension_mismatch`; when `FUSE_CONFINE_WRITES` is set, `path` must also resolve under that root, else `path_outside_confinement` (see [configuration](./configuration.md); a no-op when unset).

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Target session. |
| `path` | string | no | If set, write the PDF here and return `{ path }`. |
| `format` | string | no | Paper format (`Letter`, `Legal`, `Tabloid`, `Ledger`, `A0`–`A6`). |
| `landscape` | boolean | no | Landscape orientation. |
| `printBackground` | boolean | no | Print background graphics. |

Returns `{ path, bytes }` when `path` is given, otherwise `{ pdfBase64, bytes }`.

```json
{ "sessionId": "s_abc123", "format": "A4", "printBackground": true }
```

```json
{ "sessionId": "s_abc123", "path": "/tmp/page.pdf", "landscape": true }
```

### browser_cookies

Read, set, or clear cookies on this session's `BrowserContext`. Cookies use the Playwright shape (`{ name, value, domain?, url?, path?, expires?, httpOnly?, secure?, sameSite? }`); either `url` or both `domain` and `path` are required per cookie when setting. Errors surface as `code: cookies_failed`.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Target session. |
| `action` | enum `get` \| `set` \| `clear` | yes | Operation to perform. |
| `cookies` | array | for `set` | Playwright cookies to add. |
| `urls` | string[] | no | For `get`: return only cookies that affect these URLs. |

Returns `{ cookies }` for `get`, `{ added: n }` for `set`, `{ cleared: true }` for `clear`.

```json
{ "sessionId": "s_abc123", "action": "get", "urls": ["https://example.com"] }
```

```json
{ "sessionId": "s_abc123", "action": "set", "cookies": [{ "name": "sid", "value": "abc", "url": "https://example.com" }] }
```

```json
{ "sessionId": "s_abc123", "action": "clear" }
```

### browser_route

Intercept network requests matching a glob/URL `pattern` on this session. `mock` fulfills matching requests with a canned response (`status` / `body` / `contentType`); `abort` blocks them; `unroute` removes a route previously installed with the same pattern. Patterns are Playwright globs, e.g. `**/api/**` or `https://x/*`.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Target session. |
| `pattern` | string | yes | Playwright URL glob to match. |
| `action` | enum `mock` \| `abort` \| `unroute` | yes | Fulfill, block, or remove the route. |
| `status` | number | no | HTTP status for `mock` (Playwright default `200`). |
| `body` | string | no | Response body for `mock`. |
| `contentType` | string | no | `Content-Type` header for `mock`. |

Returns `{ routed, action }`.

```json
{ "sessionId": "s_abc123", "pattern": "**/api/me", "action": "mock", "status": 200, "body": "{\"id\":1}", "contentType": "application/json" }
```

```json
{ "sessionId": "s_abc123", "pattern": "**/analytics/**", "action": "abort" }
```

```json
{ "sessionId": "s_abc123", "pattern": "**/api/me", "action": "unroute" }
```

### browser_permissions

Grant or clear runtime browser permissions on this session. `grant` (default) allows the listed permissions, optionally scoped to a single `origin`; `clear` revokes every permission granted so far. Names follow Playwright: `geolocation`, `notifications`, `clipboard-read`, `clipboard-write`, `camera`, `microphone`, `midi`, etc.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Target session. |
| `permissions` | string[] | no | Permissions to grant (default `[]`; ignored on `clear`). |
| `origin` | string | no | Scope the grant to this origin (`grant` only). |
| `action` | enum `grant` \| `clear` | no | Default `grant`. |

Returns `{ granted, origin }` for `grant`, `{ cleared: true }` for `clear`.

```json
{ "sessionId": "s_abc123", "permissions": ["geolocation", "clipboard-read", "clipboard-write"], "origin": "https://example.com" }
```

```json
{ "sessionId": "s_abc123", "action": "clear" }
```

### browser_clipboard

Read from or write to the page clipboard via `navigator.clipboard`. `read` returns the current text; `write` sets it to `text`. The clipboard API needs the `clipboard-read` / `clipboard-write` permissions — they are granted best-effort before the call, but if the browser still denies access the tool returns `code: clipboard_denied`; grant them explicitly with `browser_permissions` first.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Target session. |
| `action` | enum `read` \| `write` | yes | Read from or write to the clipboard. |
| `text` | string | for `write` | Text to put on the clipboard. |

Returns `{ text }` for `read`, `{ written: true }` for `write`.

```json
{ "sessionId": "s_abc123", "action": "write", "text": "copied value" }
```

```json
{ "sessionId": "s_abc123", "action": "read" }
```

---

## Live view

Watch a session's browser in real time from a normal web page — works even for **headless** sessions. A CDP screencast streams JPEG frames over an ephemeral, token-gated `127.0.0.1` server (Server-Sent Events) to a `<canvas>`/`<img>` viewer. **Read-only** (no click-through). The frame stream binds to the page at start; after a crash recovery it does not auto-reattach — call `browser_live_view` again.

### browser_live_view

Start the live view for a session and return the viewer URL (token embedded). Opens it in the OS default browser unless `open:false`.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Target session. |
| `quality` | integer | no | JPEG quality 1–100 (default `60`). |
| `maxWidth` | integer | no | Max frame width in px (default `1280`). |
| `maxHeight` | integer | no | Max frame height in px (default `720`). |
| `open` | boolean | no | Open the URL in the default browser (default `true`). |

Returns `{ url, note }`. The server auto-closes when the page closes or on `browser_live_view_stop`.

```json
{ "sessionId": "s_abc123", "quality": 60, "open": true }
```

### browser_live_view_stop

Stop a session's live view and shut down its local server. Returns `{ stopped: true|false }` (`false` if none was running).

```json
{ "sessionId": "s_abc123" }
```

### browser_vault

List stored credential references — **metadata only, never secrets**. Writing is CLI-only (`fuse-browser vault set <ref>`); the MCP surface is read-only by design so a secret never travels through a tool argument.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `action` | enum `list` | yes | Only `list` is supported. |
| `sessionId` | string | no | When set, only credentials whose bound origin matches the live page are returned (origin-scoped discovery). |

Returns `{ credentials: [{ ref, username, hasTotp, origins }] }`. To actually use a secret, pass `credentialRef` to `browser_login` or `browser_fill` — the value is resolved server-side and never enters the model context. See [CLI `vault`](./cli.md#vault-setlistrmtest) to store credentials and [configuration](./configuration.md) for `FUSE_VAULT_KEY` / `FUSE_VAULT_ALLOW_ANY_ORIGIN`.

```json
{ "action": "list" }
```
