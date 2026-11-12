# fuse-browser: improvement and new-option ideas (2026-11-11)

Method: three scouts surveyed the field (MCP browser servers, agent frameworks and scrapers, standards and user demand). Every shortlisted idea below was re-checked today: the competitor source was re-opened (fast-path fetch) and our side was checked against our code (`path:line`, or a grep with a positive control). Anything not re-checked says NOT VERIFIED. No effort in days anywhere: size is S/M/L from the modules touched. Nothing here is implemented; the owner picks from the list.

Sources of the ideas: `fuse-browser-ideas-mcp-servers.md` (25), `fuse-browser-ideas-agents-scrapers.md` (26), `fuse-browser-ideas-trends.md` (19), our code map `fuse-browser-us-map.md`. Our own findings today are marked "measured".

## 1. The shortlist (top 12, ranked)

`#` is the global rank. Criteria in order: removes a failure our agents really hit (wrong click, context bloat, blocked or unreadable docs, unverifiable UI change), then token/cost reduction for host agents, then uniqueness in the field, then size. Evidence level differs: the failure is measured for #1 (live repro) and #2 (live fetch); #3 has the real-conditions test of this branch (`docs/blocked-fast-path-real-conditions-2026-11-11.md`); #5 sits above the token items because "unverifiable UI change" is one of the four named failures, but nobody measured it yet, which is why it is L and in the last release (R4).

### Improve what exists

| # | Idea | What it gives our agents | Who ships it | We have it? | Size |
|---|------|--------------------------|--------------|-------------|------|
| 1 | Refuse a stale ref instead of clicking another | A drifted ref fails with `ref_stale` instead of clicking another element | agent-browser, dev-browser | partial | M |
| 2 | Read PDFs and documents in `browser_fetch` | Specs, RFCs and papers arrive as readable markdown with page markers | Firecrawl, Jina Reader, Crawl4AI | no | M |
| 3 | Blocked pages: one verdict, legitimate next steps | Every route says blocked, paid or not allowed, and the allowed next step | none seen (parts: Cloudflare, agent-browser) | partial | M |
| 4 | Effect report on every action | Each action says what changed and whether the page settled | dev-browser, agent-browser, Playwright MCP, Chrome DevTools MCP | partial | M |
| 6 | Read docs through the site's own markdown | Exact markdown with fewer tokens via `.md`, llms.txt and `Link` headers | agent-browser, Cloudflare, llms.txt sites | partial | M |
| 7 | Snapshot that never truncates silently | A `truncated` flag, scoped snapshots and a find tool for refs | Playwright MCP, agent-browser, Charlotte, Steel | no | M |
| 8 | Token budget and file offload on every result | Estimated tokens, hard caps, and big outputs written to files | Chrome DevTools MCP, Cloudflare, Jina Reader | no | M |
| 9 | Task presets and tool annotations for 51 tools | Smaller tool list per task; hosts can auto-approve read-only tools | Charlotte, Chrome DevTools MCP, Playwright MCP, agent-browser | partial | S |
| 12 | Pause before destructive or paid clicks | `browser_act`/`browser_click` stop with `handoff_required` before delete, pay or confirm | agent-browser, Steel | partial | S |

### New options

| # | Idea | What it gives our agents | Who ships it | We have it? | Size |
|---|------|--------------------------|--------------|-------------|------|
| 5 | One-call UI-change receipt (`browser_verify`), our own combination | Pass/fail plus screenshots, diff, console and network evidence for a PR | none seen (primitives: Playwright, Chrome DevTools MCP) | partial (pieces) | L |
| 10 | Ask a page a question, get passages | Model-free BM25 passages from one page or from SERP results | Crawl4AI, Firecrawl, Jina Reader | no | M |
| 11 | Site map and best-page crawl | List a site's URLs from sitemap or llms.txt; crawl only matching paths | Firecrawl, Crawl4AI, Scrapling | no | M |

### Defects measured today (fix, not ideas)

- **Stale-ref wrong click (#1):** `browser_act {ref:"2"}` clicked "Delete account" and returned `ok:true`. Proof: `scratchpad/ref-drift/raw/variant-before.json` (path in card #1). Measured.
- **`browser_serp_batch` returns `results: []` while Google serves results:** no error is returned, so discovery silently breaks for every agent that uses it. Measured by the lead on the installed 0.1.64 (`{"rows":[{"query":"playwright mcp changelog","results":[]}]}`, also with `hl:"en", gl:"us"`); a session on the same Google URL showed ten organic results, no consent wall, `captcha:false`, every result link of the form `https://www.google.com/goto?url=<opaque>&gsessionid=…`. Cause as read in code, not executed in isolation: `src/extraction/serp.ts:16` `internal(u)` is true for any `google.com` host (and on a parse failure, `:16`); `:30` drops an organic result when `internal(a.href)`; `linkFor` (`:17-22`) returns the enclosing `a[href]` first (`:18`), and its fallbacks (`:21`) also yield an anchor whose `href` resolves to Google, so a `goto?url=` link is always classed internal and dropped. NOT VERIFIED: recovering the destination from `cite`, `data-*` or `ping` (`:39` already reads `cite` for the display URL only).
- **`challenges.cloudflare` false positive:** `browser_extract` reported `cloudflare:true` on a normal Google results page because a result mentions Cloudflare. Read in code: the flag is a bare substring test on the page text (`src/extraction/challenges.ts:36-37`, `lowered.includes("cloudflare")`). Measured by the lead; the code line is mine. Also measured: the extracted markdown keeps the `goto?url=` wrappers instead of destination URLs.

**Do first: #1, the stale-ref guard.** It is the only item with a live reproduction of a wrong action returning `ok:true` (a click on "Delete account" meant for "Save"). It is the prerequisite of #4 and of the planned differential snapshot (`ROADMAP.md:82`), which need the same ref-generation model, and it makes #12 meaningful because a guard that reads the clicked element's text must trust the ref.

Two of the twelve are "our own combination" (#3, #5): in the sources read nobody ships them as one feature; absence is not proven (SERP discovery returned `[]` for the scouts because of a defect in our own SERP extractor, see "Defects measured today" and section 6).

## 2. One card per shortlisted idea

Measured today, repeated in the cards where they matter: (1) ref drift reproduced live; (2) a PDF through `browser_fetch` returns raw `%PDF-1.5` bytes; (3) the blocked flag exists only on the fetch routes of this branch; (4) `humanMode` restarts each approach from a random corner (see section 6, not proposed).

### #1 Stale-ref guard (improve, M)
- Field: agent-browser keeps a ref bound to its DOM node; if the node was replaced it rebinds to the single element with the same role and name, only if the ref was unique in its snapshot, else "the action fails without acting" (https://agent-browser.dev/snapshots, re-opened). Our proposal is stricter: refuse on any identity mismatch, no rebinding. dev-browser's stale-ref text tells the agent to re-snapshot (scout notes, not re-opened).
- Us today: `browser_act` re-captures (and so re-numbers) every ref before resolving the agent's ref (`src/server/tools/snapshot.ts:73`), stamps by DOM order (`src/extraction/snapshot-walk.ts:62`), never removes stamps (grep `removeAttribute`: none; control: `setAttribute` at `snapshot-walk.ts:62`); the only miss signal is `ref_not_found` (`src/actions/act-by-ref.ts:54`, also `src/server/tools/screenshot.ts:63`, `src/server/tools/inspect.ts:48`); grep `ref_stale`: none. The act description calls the `annotate` re-mark "anti-drift" (`src/server/tools/snapshot.ts:56`), but that only re-numbers. Ref resolution is `src/actions/ref-locator.ts:27-30`.
- Measured: `scratchpad/ref-drift/raw/variant-before.json`: snapshot gave Cancel=0, Delete account=1, Save=2; the page then inserted an element; `browser_act {kind:"click", ref:"2"}` returned `ok:true`, empty `diff`, and the page log read `[Delete account]`. (Only `variant-before.json` was re-read by me; the lead's brief states the full result.)
- Shape: per session, remember `{ref → tag, role, text, frame}` as returned by `browser_snapshot` (not by the internal capture in `browser_act`); `browser_act`/`browser_inspect` with a `ref` compare the live node and refuse on mismatch: `{ok:false, error:"ref_stale", expected:{...}, found:{...}, hint:"browser_snapshot again"}`; add `generation` to snapshot output; internal captures stop stamping.
- Breaks/duplicates: planned differential snapshot (`ROADMAP.md:82`) needs the same generation; the annotate paths need an explicit new generation (`docs/competitive-analysis-2026-11.md` §5.1). Not on the recorded rejections.
- NOT VERIFIED: sub-frame refs after a frame comes or goes (code-derived only, `ref-locator.ts:27`); whether Playwright 1.64 `getByRef` could replace our indexing (idea T19 in section 4).

### #2 Read PDFs in `browser_fetch` (improve, M)
- Field: Firecrawl parses PDFs from a URL via `/scrape` with `numPages` vs `totalPages` so truncation is visible, plus `pageMarkers` (https://docs.firecrawl.dev/features/parse, re-opened); Jina Reader reads PDFs and Office files (https://github.com/jina-ai/reader, re-opened, "Updates" 2025-12); Crawl4AI size and page caps (scout notes).
- Us today: non-HTML bodies are returned verbatim as decoded text (`src/net/fetch-fast.ts:56-58,73-75`), no PDF dependency in `package.json` (grep `pdf`: none; control: the file lists other dependencies), grep `pdf` in `src/net`, `src/agent`, `src/extraction`: none (PDF code exists only for generation: `src/server/tools/pdf.ts`).
- Measured: `browser_fetch {url:"https://arxiv.org/pdf/1706.03762", format:"text"}` through the installed server returned status 200 and `%PDF-1.5 ... stream` binary garbage as `text`.
- Shape: on `application/pdf` return markdown with `<!-- page N -->` markers; output `pages`, `totalPages`, `truncated`; params `maxPages`; the existing 10 MB cap stays (`fetch-fast.ts:15`); scanned PDFs return `ocr_required` with a hint (no embedded model). Library choice is a dependency decision for the owner (NOT VERIFIED: none evaluated).
- Breaks/duplicates: none in ROADMAP. Every new fetch path needs the SSRF bypass matrix (idea A19, section 4).
- NOT VERIFIED: PDF parser quality on spec-style layouts; Office formats (Jina and Firecrawl do them, out of scope here).

### #3 Blocked pages: one verdict, legitimate next steps (improve, M, our own combination)
- Field: no generic block classification found in Playwright MCP (only non-2xx on navigate, https://github.com/microsoft/playwright-mcp/releases/tag/v0.0.78, re-opened), Chrome DevTools MCP or agent-browser (scout notes: absence in what was read). The legitimate signals exist separately: Cloudflare pay-per-crawl answers `HTTP 402` with a price (https://developers.cloudflare.com/ai-crawl-control/features/pay-per-crawl/what-is-pay-per-crawl/, re-opened), Content Signals in robots.txt (https://blog.cloudflare.com/content-signals-policy/, re-opened), agent-browser `read` takes site-offered markdown (https://agent-browser.dev/commands, re-opened).
- Us today, two detectors that do not talk to each other: (a) the table-driven `blocked`/`blockedBy`/`hint` only on `browser_fetch`, `browser_fetch_batch`, `browser_crawl` (grep `blockedBy|detectBlock` in `src`: `agent/fetch-render.ts`, `agent/fetch-resolve.ts`, `server/tools/{fetch,fetch-batch,crawl,schemas-fetch-output}.ts`, `net/block-*.ts`, `interfaces/block.ts`; all uncommitted on this branch); (b) the older opt-in page-text classifier `detectChallenges` returning `{captcha, turnstile, hcaptcha, cloudflare, login, otp, awsWaf}` (`src/extraction/challenges.ts:26-44`, via `browser_extract kind:"challenges"` and `browser_probe detectChallenges`, `src/agent/detect.ts:27`). `browser_navigate` and `browser_serp_batch` return neither. No 402 or content-signal rule in (a) (grep `402|content-signal|payment` in `src/net/block-signals.ts`, `src/interfaces/block.ts`: none; control: `cloudflare` matches). We also ship an opt-in CAPTCHA solver on the probe path (`captcha` option, `src/server/schemas-resilience.ts:19-21`, `src/net/captcha-client.ts`).
- Shape: merge (a) and (b) into one verdict on every route: `blocked.reason` in `challenge | payment_required | policy_denied | login_required` (`login_required` maps today's `login`/`otp` flags, not a new detector), `nextSteps:[{tool, params}]`; session tools and SERP rows run the same detector on the rendered page (it already handles bodies with no status, `src/net/block-detect.ts` header comment); errors carry `code` + `hint` (and the covering element for click failures, as agent-browser's `covered by <div#consent-banner>`); the ladder offers site-offered markdown only when the site advertises it (`Link` header, `<link rel=alternate>`, llms.txt), then `browserFallback`, then a session, then `browser_handoff`. `nextSteps` never emits the `captcha` solver option.
- Breaks/duplicates: the owner decision of 2026-11-11 (the agent side never solves a CAPTCHA, no new evasion, `respectRobots` not weakened) is respected. The ladder does move from the fast path to a real browser session, a route the owner already sanctioned (decision "while a fuse-browser route remains"); it adds no identity tricks beyond what those routes already do.
- NOT VERIFIED: whether a Cloudflare block page ever advertises a markdown twin; how often a 403 carries `Content-Signal`; Web Bot Auth drafts are expired/replaced (scout-trends) so signing stays in the backlog (`ROADMAP.md:88`).

### #4 Effect report on every action (improve, M)
- Field: dev-browser verifies with `snapshot({track}).incremental` ("a diff of only what changed") and a cost ladder url/title < incremental < interactive < full < screenshot (https://github.com/SawyerHood/dev-browser/blob/main/docs/help.md, re-opened); agent-browser `diff snapshot` against the last snapshot, "the primary use case for agents verifying that an action had the intended effect" (https://agent-browser.dev/diffing, re-opened); Playwright `--snapshot-mode` and Chrome DevTools `includeSnapshot` (scout notes; the Playwright default is itself disputed, section 6).
- Us today: only `browser_act` returns a diff, interactive elements only (`src/server/tools/snapshot.ts:73-79`); `browser_click/fill/press/scroll/type` return `{result, url}` (`src/server/tools/act.ts:64`); `browser_run` returns per-step results; `domChanged` exists only on the probe path (`src/agent/actions-loop.ts:54`, us-map, not re-read).
- Shape: `effect:{urlChanged, domChanged, settle:{ready, pending, ms}}` on all action tools and `browser_run` steps (cheap signals by default; do not flip the meaning of `ok`); param `return:"effect"|"diff"|"none"`; `browser_snapshot {since:"last"}` returns only changed lines; later a repeat hint when the same action fails twice (`docs/competitive-analysis-2026-11.md` §5.7).
- Breaks/duplicates: this is `ROADMAP.md:81` (post-action verification) and `:82` (differential snapshot), now with sources; needs #1 first.
- NOT VERIFIED: latency of the extra evaluate calls (measure before choosing the default); dev-browser's exact settle definition (300 ms no request, 200 ms no mutation) comes from scout notes.

### #5 One-call UI-change receipt `browser_verify` (new, L, our own combination)
- Field: Playwright added `page.screencast` in 1.59 (https://playwright.dev/docs/api/class-screencast, re-opened; the "agentic video receipts" wording is from the release notes via scout-trends, not re-opened); Chrome DevTools MCP is sold on "Verify in the browser that your change works as expected" (https://developer.chrome.com/blog/chrome-devtools-mcp, re-opened); agent-browser diffs (https://agent-browser.dev/diffing). A packaged single-call receipt: not seen in the sources read.
- Us today: the pieces exist separately: `browser_visual_diff` (`src/server/tools/visual-diff.ts:34`), screenshot, `browser_console`/`browser_network` (`src/server/tools/logs.ts:31,66`), snapshot diff. No assertions, no video or tracing (grep `recordVideo|\.tracing`: none; control: `startScreencast` matches in `src/live/`), no a11y audit (grep `lighthouse|axe-core`: none).
- Shape: `browser_verify {url|sessionId, expect:[{text}|{visible:selector}|{noConsoleErrors}|{noFailedRequests}], baseline?, evidenceDir}` returns `{pass, failed:[...], evidence:{before, after, diff, consoleLog, networkLog, receiptMd}}`; assertions come from the agent, no embedded LLM (consistent with `ROADMAP.md:78`).
- Breaks/duplicates: the `expect` postcondition of `ROADMAP.md:81` is its seed; overlaps rest rows "video", "test assertions", "audit", "`diff url`" (section 4): they become options of this tool, not tools.
- NOT VERIFIED: patchright parity for screencast and tracing; console capture is disabled on the default engine (`src/server/tools/logs.ts:16-21`), so console evidence needs `engine:"playwright"` or an explicit "unavailable" field.

### #6 Docs-native read ladder (improve, M)
- Field: agent-browser `read` sends `Accept: text/markdown`, retries `<url>.md`, walks up to the nearest `llms.txt`, offers `--outline` and `--filter` (https://agent-browser.dev/commands, re-opened); Cloudflare converts on `Accept: text/markdown` and returns `x-markdown-tokens`, sample 16,180 HTML tokens vs 3,150 markdown (https://blog.cloudflare.com/markdown-for-agents/, re-opened, its own measurement); llms.txt v2 proposes `.md` twins plus `Link: rel="alternate"; type="text/markdown"` (https://llmstxt.org/, re-opened).
- Us today: we send `Accept: text/markdown, text/html, ...` (`src/net/fetch-fast.ts:18`) and return a markdown response verbatim (`:56-58`); no `.md` twin, no llms.txt, no `Link` parsing, no token header (grep `x-markdown|rel=alternate|llms\.txt|sitemap` in `src`: none; control: `text/markdown` matches at `fetch-fast.ts:18`).
- Shape: `browser_fetch {prefer:"site-markdown"|"auto"|"html", outline:boolean, section:string}`; output `source:"native-markdown"|"md-twin"|"llms-txt"|"extracted"`, `siteTokens`, `llms:{url, links}`; extra requests only same-origin, through the existing SSRF check, only when advertised or when llms.txt exists; `browser_crawl` can seed from llms.txt (#11).
- Breaks/duplicates: extends `ROADMAP.md:55` (Accept header shipped in 0.1.40); no conflict with recorded rejections (not a hand-curated site guide: the site publishes it).
- NOT VERIFIED: `.md` twin coverage outside Mintlify-style docs hosts (scout-agents saw three, all Mintlify); how Impit orders `Accept` on the wire.

### #7 Snapshot that never truncates silently (improve, M)
- Field: Playwright MCP `browser_find` returns matching snapshot nodes with context, "cheaper than capturing the whole snapshot" (https://github.com/microsoft/playwright-mcp/releases/tag/v0.0.78, re-opened); agent-browser `-i -c -d -s` (https://agent-browser.dev/snapshots, re-opened); Charlotte `find` and detail levels (https://github.com/TickTockBent/charlotte, re-opened; its 364 vs 50,706 characters is self-reported); Steel `steel_find`, dev-browser `maxChars` (scout notes).
- Us today: `browser_snapshot` takes `sessionId, selectors, annotate, prune` only (`src/server/tools/snapshot.ts:28-33`); caps of 200 per frame and 400 total (`src/extraction/snapshot-walk.ts:58-60`, `src/extraction/snapshot.ts:18`), no `truncated` field (grep `truncated` in `snapshot.ts`, `snapshot-output.ts`: none; control: `MAX_ELEMENTS` found).
- Shape: output `total`, `count`, `truncated:true` with a hint naming the next step; params `scope` (CSS), `maxElements`, `interactiveOnly`; new `browser_find {sessionId, text|regex, maxResults}` returning matching elements with `ref`. The flag alone is S and can ship first.
- Breaks/duplicates: `docs/competitive-analysis-2026-11.md` §5.2 already says "take"; compatible with `ROADMAP.md:82`.
- NOT VERIFIED: the token saving on our own element JSON (not measured; this is why #8 starts with measuring).

### #8 Token budget and file offload (improve, M)
- Field: Chrome DevTools MCP writes "Token-Optimized" and "Reference over Value: for heavy assets ... return a file path or resource URI" (https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/design-principles.md, re-opened); Cloudflare's `x-markdown-tokens` "to calculate the size of a context window or to decide on your chunking strategy" (https://blog.cloudflare.com/markdown-for-agents/, re-opened); Jina `x-max-tokens` / `x-token-budget`, Playwright `--output-dir`, dev-browser 50k-character spill (scout notes).
- Us today: `maxChars` on fetch and crawl only; no token estimate, no `truncated`/`nextOffset` (grep `maxTokens|estimatedTokens|resource_link|approxTokens` in `src`: none; control: `progressToken` matches in `src/server/progress.ts`); screenshots already go to files (`src/server/tools/screenshot-write.ts`).
- Shape: one helper in `src/server/result.ts` adds `approxTokens` to every result; params `maxTokens` and `output:"inline"|"file"|"auto"` on fetch, snapshot, network, console, extract, crawl; over-cap results return a summary, a file path and `nextOffset`. Includes Jina-style fetch shaping: `links:"footer"|"none"`, `images:"alt"|"none"`.
- Breaks/duplicates: none recorded; do not pick a threshold without measuring.
- NOT VERIFIED: which hosts render `resource_link`; the cut-off value (to be derived from a measurement, not guessed); Jina header semantics were not re-opened (scout notes).

### #9 Task presets and tool annotations (improve, S)
- Field: Charlotte profiles `core` 7 / `browse` 23 / `full` 43 tools, 2,186 / 4,372 / 8,500 definition tokens (self-reported, https://github.com/TickTockBent/charlotte, re-opened); Anthropic: "Claude's ability to pick the right tool degrades once you exceed 30–50 available tools" (https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool, re-opened); MCP 2026-07-28: servers SHOULD list tools in a deterministic order (https://modelcontextprotocol.io/specification/2026-07-28/server/tools.md, re-opened); Chrome DevTools categories and `--slim`, Playwright `--caps` (scout notes).
- Us today: `FUSE_CAPS` has five groups, default all (`src/server/caps.ts:9`); 51 tools; no annotations anywhere (grep `readOnlyHint|destructiveHint|annotations` in `src`: none; control: `registerTool` calls at `src/server/tools/act.ts:47`); the installed SDK 1.29.0 accepts them (`annotations?: ToolAnnotations` in `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts:155`).
- Shape: aliases `FUSE_CAPS=docs|verify|full` mapped onto groups (move vault, handoff, hotel and product tools out of `core`); `readOnlyHint`, `destructiveHint`, `openWorldHint` on all registrations (`title` already exists: 48 `title:` occurrences in `src/server/tools/*.ts`) plus a unit test that every registered tool has them (the 51 is the docs and us-map count, 41 direct + 10 through `actTool`; the test should assert the real number); a `fuse-browser tools --tokens` command that prints the advertised definition size.
- Breaks/duplicates: extends `FUSE_CAPS`, nothing new to maintain; hosts treat annotations as untrusted from untrusted servers (spec).
- NOT VERIFIED: our own tool-definition weight (not measured, `browser_fetch` alone carries a long description); whether `tools/list` order is stable today; whether Claude Code honours `readOnlyHint` for auto-approval.

### #10 Ask a page a question, get passages (new, M)
- Field: Crawl4AI fit markdown: `PruningContentFilterLXML` (text/link density) and `BM25ContentFilter` with a user query, "raw_markdown / fit_markdown" (https://docs.crawl4ai.com/core/fit-markdown/, re-opened); Firecrawl `/search` with `scrapeOptions` and query-relevant highlights by default (https://docs.firecrawl.dev/features/search, re-opened); Jina `s.jina.ai` (https://github.com/jina-ai/reader, re-opened).
- Us today: none (grep `bm25` in `src`: none; control: `frontmatter` matches in `src/extraction/serialize/`); `browser_serp_batch` returns titles and snippets only (`src/agent/serp-batch.ts:53`).
- Shape: `browser_fetch {focus:"refresh token rotation", topK:3}` returns `passages:[{heading, text, score}]`, model-free BM25 over the extracted markdown; `browser_serp_batch {read:{top:3, focus, maxTokens}}` reuses `fetch_batch`; same engine later feeds the adaptive crawl (rest row).
- Breaks/duplicates: none recorded; consistent with "no internal LLM loop" (`ROADMAP.md:78`).
- NOT VERIFIED: how Firecrawl computes highlights (model or lexical); BM25 quality on API-reference pages; SERP read depends on `browser_serp_batch` working: it currently returns `results: []` while Google serves results (see "Defects measured today"; fix that first).

### #11 Site map and best-page crawl (new, M)
- Field: Firecrawl `/map`: URLs "primarily from the sitemap, supplemented with SERP results", with a `search` param (https://docs.firecrawl.dev/features/map, re-opened); Crawl4AI URL seeding by `sitemap`/`sitemap+cc` with `pattern="*/docs/*"` (https://github.com/unclecode/crawl4ai/blob/main/docs/md_v2/core/url-seeding.md, re-opened); BestFirst scoring and Scrapling `SitemapSpider` (scout notes).
- Us today: crawl is same-origin BFS with `maxPages, maxDepth, sameOrigin, concurrency, format, maxChars, browserFallback, respectRobots, throttleMs, proxyUrl` (`src/server/tools/crawl.ts:26-36`); no sitemap, path filters or scoring (grep `sitemap` in `src`: none; control: `robots` matches in `src/net/robots.ts`).
- Shape: new `browser_map {url, search?, limit}` returning `[{url, title?, source:"sitemap"|"llms-txt"|"link"}]`; `browser_crawl` gains `includePaths`, `excludePaths`, `scoreKeywords`, `order:"bfs"|"best-first"`; the `robots.txt` fetch already exists and can read `Sitemap:` lines.
- Breaks/duplicates: none recorded; every secondary fetch (sitemap, llms.txt) must pass the SSRF check (rest row A19).
- NOT VERIFIED: sitemap coverage on the docs hosts the owner reads; Firecrawl's SERP supplement is not proposed (our own SERP path is broken today, see "Defects measured today").

### #12 Pause before destructive or paid clicks (improve, S)
- Field: agent-browser `--action-policy` and `--confirm-actions` ("prevent the agent from performing dangerous operations ... without explicit approval", 60 s auto-deny) (https://agent-browser.dev/security, re-opened); Steel `steel_batch` hands off before login, payment or final confirmation (scout notes; the README was re-opened but the tool table was cut, so this is not re-verified).
- Us today: `preflight` blocks text matching `pay|payment|checkout|card|book|booking|reserve|confirm|ticket|purchase` (+ FR forms) unless `humanApproved` (`src/guardrails/preflight.ts:7-8,28-39`); imported only by `src/server/tools/run.ts` and `src/agent/browser-agent.ts` (grep `preflight` in `src`); `browser_act`, `browser_click`, `browser_fill` do not call it, and the word list has no delete/remove/close-account.
- Shape: `browser_act` and the click/fill tools run the preflight on the LIVE element's text (a ref has no target text today) and return `{ok:false, error:"handoff_required", reason, hint:"browser_handoff or retry with humanApproved:true"}`; word list extended by the owner, not by us.
- Breaks/duplicates: `ROADMAP.md:26` ("no pay/book without `humanApproved`") already promises this for the whole surface; this closes the gap.
- NOT VERIFIED: false-positive rate on real pages ("Confirm" buttons are everywhere), so it should signal and let the owner tune the list.

## 3. Bundles (green-lightable blocks)

| Release | Items, in order | Why this order |
|---------|-----------------|----------------|
| R1 "Safe actions" | #1 stale-ref guard, then #4 effect report, then #12 sensitive-step pause (the `truncated` flag of #7 rides along as an S fix) | #4 and the differential snapshot need #1's generation model; #12 reads the element #1 now guarantees |
| R2 "Docs-native reading" | #2 PDF, then #6 site markdown ladder, then #3 blocked verdict, then #11 map | #2 is independent and fixes a measured failure; #6 and #3 share the "site-offered" probes; #11 reuses llms.txt and robots fetches |
| R3 "Token diet" | #9 presets, annotations and `--tokens` measurement, then #7 snapshot controls, then #8 token budget, then #10 passages | measure first (#9), then cut (#7, #8), then add the model-free relevance step (#10) |
| R4 "Proof of UI change" | #5 `browser_verify` | needs R1 (effect report, stable refs); absorbs the rest rows video, assertions, audit, `diff url` as options |

Suggested order: R1, R2, R3, R4. Each is releasable on its own; R4 depends on R1.

## 4. The rest (every other idea, nothing dropped)

Arithmetic: 25 + 26 + 19 = 70 raw ideas in the three notes; 13 are duplicates of another (list at the end of this section) so 57 distinct; the 12 cards cover 18 distinct ideas (cards fold related ideas, listed just below); 57 - 18 = 39 rows in the table. Verdicts: "later" = worth doing after the bundles; "skip" = not for us now; "already have" = the field has nothing on us here.

Cards fold these ideas: #1 M7; #2 A17; #3 T7 + M18; #4 M2 + M10; #5 T5; #6 M1; #7 M4; #8 T2 + T16 + A1; #9 M3 + T4; #10 A2 + A3; #11 A5; #12 A24 (M = MCP scout, A = agents scout, T = trends scout, numbers as in each note).

| Idea | Source | We have it? | Verdict |
|------|--------|-------------|---------|
| M5 WebMCP list/call (+ probe check) | Playwright MCP 0.0.81-82, Chrome DevTools MCP, agent-browser, Stagehand 3.6.0 | no (grep `webmcp` in `src`, `docs`, `README.md`: none) | later: parity only, experimental behind a Chrome flag, HN split (scout-trends) |
| M6 `browser_audit` (a11y, SEO, vitals) | Chrome DevTools MCP `lighthouse_audit`, agent-browser `vitals`, Charlotte `dev_audit` | no (grep `lighthouse|axe-core`: none) | later: an option of #5; reuse `private-net-guard` (browser-tools-mcp shipped an SSRF in this tool class, 2.0.3) |
| M8 untrusted-content hygiene: nonce boundaries, `untrusted`, hidden-text strip with counts, URL-param redaction | agent-browser `--content-boundaries`, Scrapling MCP, Playwright `--redact-url-params`, Jina `x-detach-invisibles` | partial (`prune` in `src/extraction/snapshot-hidden.ts`, vault redaction `src/extraction/redact.ts`; no envelope) | later, first of the rest: signalling only; differs from the FSB regex scrub we skipped (`docs/competitive-analysis-2026-11.md` §5.16) |
| M9 screenshot token discipline (`ifChanged`, `maxEdge`, path-only) | agent-browser `--if-changed`, Chrome DevTools `--screenshotMax*`, dev-browser downscale | partial (file output `screenshot-write.ts`; grep `ifChanged|maxEdge`: none) | later: small, fold into #8 |
| M11 HAR to derived client / OpenAPI (= A15) | agent-browser `derive-client`, Browserbase `browser-to-api`, Playwriter recorder | partial (HAR record/replay, `ROADMAP.md:46`; no export) | later |
| M12 `diff url a b` | agent-browser | no (`browser_visual_diff` needs a baseline, `visual-diff.ts:34`) | later: option of #5 |
| M13 egress containment + audit log + URL-param redaction (= A13) | agent-browser `--allowed-domains`, Stagehand `setDomainPolicy`, Browserbase `safe-browser`, Chrome DevTools `--allowedUrlPattern` | partial (guard is opt-in and fast-path only: `fetch-fast.ts:53`, off unless `FUSE_BLOCK_PRIVATE_NETS=1`) | later: high value for untrusted docs; the field documents its limits, we would too |
| M14 named isolated contexts in one browser | Chrome DevTools `isolatedContext`, Playwright MCP 0.0.84 | partial (each session builds its own context, `src/engine/configured-context.ts:59`; `browser_tabs` has no context param) | later |
| M15 attach hardening: Chrome 136/144 rules, many tabs, timeouts (= T10) | Chrome DevTools MCP, Playwriter, dev-browser, Playwright `--background` | partial (`src/server/tools/connect.ts`; grep `136` in `connect.ts`, `cdp-launch.ts`, `docs/sessions.md`: none) | later: docs and a clear error first (`docs/competitive-analysis-2026-11.md` §5.6) |
| M16 evidence video with chapters | Playwright screencast 1.59, Chrome DevTools `screencast`, Playwriter | no (grep `recordVideo`: none) | later: option of #5 |
| M17 locators and `verify_*` assertions | Playwright MCP | no | later: the `verify_*` core is #5's `expect` |
| M19 network mock parity (hit counts, `upstream`, resource type) | Chrome DevTools MCP 1.13, Playwright MCP | partial (`src/server/tools/route.ts:65`) | later |
| M20 one `emulate` tool, `mobile` for lighter pages | Chrome DevTools MCP, Playwright `--mobile`, pointclick | partial (screenshot viewports/`colorScheme`, `src/net/throttle.ts`) | later |
| M21 `browser_help` version-matched guidance | agent-browser `skills get`, dev-browser `help` | no (no such tool in the 51) | later: the skill drifting from the tools is a known failure; cheap once #9 exists |
| M22 human annotation round-trip | Playwright `browser_annotate` | partial (handoff + live view; the viewer has no input relay, issue #42) | later |
| M23 console/network retention across navigations, pagination, body-to-file | Chrome DevTools MCP | partial (`src/server/tools/logs.ts`, `logs-filter.ts`) | later: console is empty on the default engine (`logs.ts:16-21`) |
| M24 multi-agent hygiene: page-id routing, worktree-scoped session ids | Chrome DevTools MCP, agent-browser | partial (session ids per open; per-session mutation lock planned, `ROADMAP.md:85`) | later |
| M25 eight small extras: any-of text wait, dialog `warning`, CVE warning, hide password/file inputs, persist security settings, roots escape hatch, idle timeout, no telemetry | agent-browser, Chrome DevTools MCP, Playwright MCP, pointclick | mixed: already have password value nulled (`src/extraction/snapshot-walk.ts:45`), idle TTL (`src/session/manager.ts`), local-only counters (no telemetry); partial dialog ring buffer (`src/session/dialogs.ts`); no any-of wait (`src/server/tools/wait.ts:25`, `text` is one string) | mostly skip; any-of wait is S and rides with #4 |
| A6 adaptive stop-when-enough crawl | Crawl4AI AdaptiveCrawler (statistical mode) | no | later, after #10 and #11 |
| A7 resumable/cancellable crawl, `errors[]` apart from `pages[]` | Crawl4AI, Scrapling, Firecrawl | no (crawl output is `{count, pages}`, `src/server/tools/crawl.ts:15`) | later |
| A8 fetch cache + conditional GET | Firecrawl `maxAge`, Jina, Crawl4AI `CacheValidator` | no (grep `etag|if-none-match|cacheState`: none) | later: already planned (`ROADMAP.md:62,91`) |
| A9 change tracking on fetch | Firecrawl `changeTracking` | no | later: reuse `src/extraction/snapshot-diff.ts`; docs-drift checks |
| A10 recorded flows replay, selector-first then heal | Stagehand cache, Skyvern, agent-browser `flow` (experimental) | partial (strategy-name memory only, `src/state/site-memory.ts`) | later: this is `ROADMAP.md:83`; no change |
| A11 `fetch{actions}`: click before read, optional session handoff | Firecrawl actions/Interact | partial (`browserFallback` renders, no actions) | later |
| A12 TOTP + origin-scoped secrets + redaction | Skyvern, browser-use 1.0, Stagehand | **yes** (`src/vault/totp.ts`, origin binding `src/vault/resolve.ts:20`, redaction `src/extraction/redact.ts`) | already have: nothing in the field beats it; masking typed values in later screenshots is NOT VERIFIED either way |
| A18 structured-data dump, schema induction, inline-HTML input | Lightpanda, Crawl4AI `raw://`, Scrapling | partial (`browser_extract_schema` `extract-schema.ts:38`, `browser_probe_html` `probe.ts:49`) | later |
| A19 hardening checklist: every secondary fetch through the SSRF check, capped numerics, safe regex | Crawl4AI 0.8.7-0.9.5 changelog | partial (bypass-matrix tests exist; redirect and DNS-rebinding gaps documented, `src/net/private-net-guard.ts:24-32`) | later: a test matrix attached to #2, #6, #11 |
| A20 named settle strategies | Jina `x-respond-timing`, Firecrawl `waitFor` | partial (`src/agent/probe-settle.ts`, `src/state/realtime.ts`) | later: becomes `settle` in #4 |
| A22 `browser_report_block`: scrubbed local repro bundle | browser-use `report_issue`, Firecrawl feedback tools | no | later: pairs with #3; never auto-sent |
| A23 session history / diagnostics | Stagehand history, Steel diagnostics | partial (`browser_metrics` counters only) | later |
| A25 export site memory as notes/skill | Browserbase `autobrowse` | no | skip: our memory stores strategy names only (`site-memory.ts`), little to export |
| A26 in-repo benchmark with a token metric | Stagehand evals, Browser Use matched eval | no (only the weekly stealth bench, `.github/workflows/stealth-bench.yml`) | later: needed to prove #6-#8 savings; FSB doc §8 already proposes one measurement |
| T8 per-agent isolated sessions + lease | agent-browser #1068, Chrome DevTools MCP #3070 | partial (own context per `browser_open`; `browser_connect` reuses `contexts()[0]`, `src/engine/cdp-engine.ts:48`) | later |
| T13 trace capture tool | Playwright 1.63, Chrome DevTools MCP | no (grep `\.tracing`: none) | later: option of #5 |
| T14 MCP 2026-07-28 readiness: tasks extension, `server/discover`, OTel `_meta` | MCP spec 2026-07-28 | partial (`structuredContent`, progress notifications `src/server/progress.ts`; SDK `^1.29.0`) | later: SDK support for the new revision NOT VERIFIED; do not build on Sampling/Roots/Logging (deprecated) |
| T15 CLI with tool parity + generated SKILL.md | playwright-cli, Chrome DevTools CLI | partial (CLI = one-shot commands; session tools MCP-only, `src/bin/cli-usage.ts`) | later |
| T17 visual diff as an MCP App (`ui://`) | MCP Apps extension | no | skip for now: the owner's hosts are terminal-based |
| T18 auth profiles with TTL + handoff on expiry | chrome-devtools-mcp #825, Playwright `--storage-state` | partial (named profiles saved on close/login `src/session/persist-auth.ts`; no expiry) | later |
| T19 Playwright 1.65 + `ariaSnapshot('ai')`/`getByRef` | Playwright 1.64-1.65 | no (`package.json`: `playwright ^1.61.1`, `patchright ^1.61.1`) | later: evaluate after #1; our own indexing covers shadow DOM and cross-origin frames |

Merged duplicates (13, counted once in the 57): A4 = M3 (#9); A13 = M13; A14 = M8; A15 = M11; A16 = M5; A21 = M1 (#6); T1 = M2 (#4); T3 = M3 (#9); T6 = M1 (#6); T9 = M8; T10 = M15; T11 = M5; T12 = M6.

Extra items from the FSB analysis, not counted above (cited from `docs/competitive-analysis-2026-11.md` §5): upload path denylist (`src/actions/upload.ts:36`, item 4, "take"), `doctor` and dry-run installer (item 5, "adapt"), repeat/stuck hint (item 7, rides with #4), coordinate click (`ROADMAP.md:84`, item 9, low priority).

## 5. Field snapshot (stars and last release as recorded by the scouts, 2026-11-11; "from scout notes", not re-checked by me)

| Project | Stars | Last release | Licence | Slice |
|---------|-------|--------------|---------|-------|
| microsoft/playwright-mcp | 39,509 | v0.0.85 (2026-11-09) | Apache-2.0 | MCP |
| microsoft/playwright-cli | 15,126 | v0.1.24 (2026-11-10) | Apache-2.0 | MCP |
| ChromeDevTools/chrome-devtools-mcp | 55,104 | v1.13.0 (2026-11-11) | Apache-2.0 | MCP |
| vercel-labs/agent-browser | 49,776 | v0.42.0 (2026-11-10) | Apache-2.0 | MCP |
| jackwener/opencli | 31,022 | v2.0.3 (2026-11-07) | Apache-2.0 | MCP |
| SawyerHood/dev-browser | 6,727 | v1.0.0 (2026-11-03) | MIT | MCP |
| AgentDeskAI/browser-tools-mcp | 7,342 | 2.0.4 (2026-10-27) | MIT | MCP |
| BrowserMCP/mcp | 7,341 | no GitHub release; npm 2.4.0 modified 2026-11-02 | Apache-2.0 | MCP |
| remorses/playwriter | 4,075 | 0.10.0 (2026-11-06) | MIT | MCP |
| TickTockBent/charlotte | 184 | v0.8.0 (2026-08-09) | MIT | MCP |
| dashgin/pointclick | 6 | none | MIT | MCP |
| hangwin/mcp-chrome | 12,542 | 1.0.0 (2025-12-29), stale | MIT | MCP |
| executeautomation/mcp-playwright | 5,681 | last push 2025-12-13, stale | MIT | MCP |
| lightpanda-io/browser (engine) | 41,900 | 1.0.3 (2026-11-05) | AGPL-3.0 | engine |
| browser-use/browser-use | 120,730 | 1.0.2 (2026-11-11); 1.0 on 2026-11-10 | MIT | agents |
| browser-use/browser-harness | 19,027 | not checked | MIT | agents |
| browserbase/stagehand | 26,004 | 3.7.3 (2026-08-28); server v3.7.7 (2026-10-23) | MIT | agents |
| browserbase/mcp-server-browserbase | 3,397 | v3.0.0 (2026-03-31), archived | Apache-2.0 | agents |
| browserbase/skills | 3,757 | not read | n/a | agents |
| Skyvern-AI/skyvern | 23,387 | v1.0.57 (2026-11-06) | AGPL-3.0 | agents |
| firecrawl/firecrawl | 200,900 | v2.11.0 (2026-06-19) | AGPL-3.0 | scrapers |
| firecrawl/firecrawl-mcp-server | 7,802 | v3.36.1 (2026-11-03) | MIT | scrapers |
| jina-ai/reader | 12,252 | no release; last push 2026-05-22 | Apache-2.0 | scrapers |
| unclecode/crawl4ai | 87,230 | v0.9.5 (2026-10-14) | Apache-2.0 | scrapers |
| steel-dev/steel-browser | 7,948 | v0.5.5-beta (2026-10-31) | Apache-2.0 | cloud |
| steel-dev/steel-mcp-server | 58 | 3.0.0 per README | MIT | cloud |
| hyperbrowserai/mcp | 793 | stale (push 2025-11-20) | not checked | cloud |
| hyperbrowserai/HyperAgent | 1,606 | not checked | NOASSERTION | agents |
| D4Vinci/Scrapling | 101,588 | not checked | BSD-3-Clause | scrapers |
| ScrapeGraphAI/Scrapegraph-ai | 32,723 | not checked | MIT | scrapers |
| apify/crawlee | 26,423 | not checked | Apache-2.0 | scrapers |
| nanobrowser/nanobrowser | 14,286 | not checked | Apache-2.0 | agents |

Where the field has nothing on us (from the rows above): TOTP + origin-bound vault fills (A12), the no-browser TLS-impersonating fast path with JSON passthrough, multi-viewport screenshots in one call, schema extraction by container, SERP tooling as a tool (FSB comparison, `docs/competitive-analysis-2026-11.md` §6). The scouts found no generic block classification in the MCP servers read (#3).

## 6. Not proposed, and not verified

### Not proposed: seen in the field, not proposed
Several projects ship features whose purpose is to defeat bot detection or CAPTCHAs: stealth or anti-detect browsers (feder-cr/invisible_playwright_mcp, 879 stars; redf0x1/camofox-mcp, 126 stars), TLS and fingerprint impersonation with Turnstile solving in Scrapling, residential proxies and CAPTCHA solvers in Skyvern Cloud, Firecrawl "enhanced" proxies, Browserbase verified browsers, human-like pointer movement in agent-browser (`--human`). None is proposed here, and the 2026-11-11 decision (the agent side never solves a CAPTCHA, no new evasion) stands. For transparency: fuse-browser itself already ships an opt-in solver (`captcha` option for 2captcha, anti-captcha, capmonster: `src/server/schemas-resilience.ts:19-21`, `src/net/captcha-client.ts`, probe path only) and a human-mouse mode; neither is extended by any idea in this document. The legitimate alternatives are in the shortlist: site-offered markdown (#6), a clear blocked verdict with `payment_required` and `policy_denied` (#3), agent-authentication standards (Web Bot Auth stays in the backlog, `ROADMAP.md:88`, needs an operator domain; the IETF drafts are expired/replaced), profiles saved after a human pass (`src/session/persist-auth.ts`) and `browser_handoff`. One measured defect in our own evasion feature is reported, not proposed for work: `humanMode` starts each approach from a random point in the top-left 80 x 80 px (`src/actions/human-mouse.ts:43`) instead of the last cursor position.

### NOT VERIFIED (consolidated)
- `browser_serp_batch` empty results (reported by two scouts): REPRODUCED by the lead on the installed 0.1.64 (`results: []`, also with `hl:"en", gl:"us"`) while a session on the same Google URL showed ten organic results and no consent wall. The earlier consent/interstitial explanation is refuted for that moment. Cause as read in code, not executed in isolation: see "Defects measured today". NOT VERIFIED: whether the destination URL can be recovered from the DOM (`cite`, `data-*`, a `ping` attribute); no fix is proposed here. #3 (SERP rows carrying `blocked`) is a separate, still valid need.
- Today's competitor numbers are vendor-run: Charlotte 364 vs 50,706 characters and 8,500 to 2,186 definition tokens, Cloudflare 16,180 to 3,150 tokens, pointclick and Stagehand benchmarks, Browser Use "2.7-5.2x cheaper". None was reproduced.
- Playwright MCP `--snapshot-mode` default: README says `full`, a Stagehand blog says files since 0.0.82 (scout-trends); not resolved.
- Scouts had no Exa (HTTP 401) and no SERP discovery today (our `browser_serp_batch` returned `[]`, see above); "nobody ships X" is "not seen in the sources read", never proven.
- Items marked "scout notes" in the cards (dev-browser `maxChars` and stale-ref text, Jina header table, Chrome DevTools `includeSnapshot`, Steel handoff tools, Playwright 1.59 "video receipts" wording) were not re-opened by me.
- Whether the installed MCP SDK 1.29.0 serves the 2026-07-28 revision; whether hosts honour tool annotations or `resource_link`.
- Our tool-definition token weight (not measured); latency of the extra calls in #4; PDF library choice for #2; patchright parity for tracing and screencast.
- The `variant-none.json` and `variant-after.json` ref-drift results were not re-read by me; only `variant-before.json`.
- Our-code statements in the rest table marked "partial" or "no" come from the us-map and spot greps; only the top 12 were re-read against the code by me. A grep "control" proves the search reaches code, not that the pattern was well chosen: the `llms` pattern must be written `llms\.txt` (an unescaped `llms` matches `pollMs` in `src/net/captcha-client.ts`).
