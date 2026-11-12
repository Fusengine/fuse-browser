# Blocked fast path: real-conditions test (built, packed, installed, over stdio)

Date: 2026-11-11, run 15:22-15:26 UTC. Runner: `e2e-runner`. Subject: the uncommitted "blocked fast path" fix on top of `254644b` (v0.1.64 base).

Scope: the BUILT, PACKED and INSTALLED package, driven by a real MCP client through a real server process over stdio. Not the in-memory `createServer()` client, not the source tree. Nothing here changes code; every number below comes from a raw JSON file listed at the end.

## 1. Environment and code state

| Item | Value |
|---|---|
| OS | macOS 27.2.1 (Darwin 27.2.0), arm64 |
| Node / Bun / npm | v26.13.0 / 1.4.4 / 12.2.2 |
| MCP SDK used by client and by the installed server | `@modelcontextprotocol/sdk` 1.32.2 (`Client`, `StdioClientTransport`; API checked in the installed `.d.ts`) |
| HEAD | `254644bb600f94e33595c77dabe02231753e4d27` |
| Tracked diff hash (`git diff \| shasum -a 256`, taken before the build) | `42257842f24c91843023c7d7393b7a62acee13a08c74b2a04aac14de2b84b8fa` (includes docs that `fastpath-fix` may still edit) |
| Combined tracked+untracked hash | `198b0858ae53d2feb4b919898ce16d35135090fc8d063efbdb1cd1e74c8a5e60` |
| `src/` content hash (all files sorted, sha256 of per-file sha256s) | `581b88104a44e4a726b5eb5cf9de8fd7cbf48cbd30cc8df91d127a8b02954ae0` before the build and again after the run (src did not move during the test) |
| Untracked source files built | `src/interfaces/block.ts`, `src/net/block-detect.ts`, `src/net/block-signals.ts` (per-file sha256 in `code-state.txt`) |
| Build | `bun run build` (= `tsc -p tsconfig.json`), 0.6 s, `dist/` did not exist beforehand, so no stale file can ship. `dist/` is git-ignored (`.gitignore:2`), not tracked. |
| `dist` vs `src` | 297 `.ts` in `src` and 297 `.js` in `dist`, identical name sets (diff empty) |
| Tarball | `fusengine-browser-mcp-0.1.64.tgz`, 399,852 bytes, sha256 `5a019a98ad8ea81fdcb9adbb700c44576931fdc59877e819fd7b011ad9355d9e`, sha1 `6ab285eb8791fc39d8c2a5fab6d6492429ad994e` |
| Tarball content | 1193 files: 1188 under `dist/` (js, d.ts, maps only) + `LICENSE`, `package.json`, `proxies.example.json`, `README.md`, `scripts/postinstall.mjs`. No tests, fixtures, docs, `.env`. Nothing odd. |
| Version collision | the tarball is also `0.1.64`, same as the published package. The two installs are in separate directories; the published one lacks `dist/net/block-detect.js` and `block-signals.js` (proof it is the unfixed code). |

### Install, like a user

```
npm init -y && npm install <tarball>            # fixed   (install-fixed/, 3.0 s, 135 packages, 0 vulnerabilities)
npm install-scripts approve @fusengine/browser-mcp && npm rebuild @fusengine/browser-mcp   # see finding below (17.1 s)
npm init -y && npm install @fusengine/browser-mcp@0.1.64   # published control (install-pub/, 2.4 s)
```

Finding (not caused by the fix): on npm 12.2.2 the package's `postinstall` (`scripts/postinstall.mjs`, downloads Chromium via `patchright install chromium`) is BLOCKED by default ("install scripts blocked because they are not covered by allowScripts"). A user must run `npm install-scripts approve` (or equivalent) and rebuild. After approval it ran in 17 s and added `chromium-1248`, `chromium_headless_shell-1248`, `ffmpeg-1013` to the shared `~/Library/Caches/ms-playwright` (additive; the machine's installed 0.1.64 MCP server and its config were not touched). Without that approval, browser rungs would depend on a Chromium already on the machine. This is a documentation candidate for `docs/installation.md`; it was not investigated further.

### How the server was launched

The client script spawns the documented bin through the installed package: `npx --no-install browser-mcp` with `cwd` = the install dir (stdio transport, stderr piped; the documented MCP command is `npx -y @fusengine/browser-mcp`, whose bin is `browser-mcp`). `node install-fixed/node_modules/.bin/browser-mcp --version` prints `0.1.64`. Server `initialize` returned `serverInfo` `fuse-browser 0.1.64`. Default env for the child = the SDK's `getDefaultEnvironment()`; the E1 process additionally had `FUSE_FETCH_ESCALATE_BLOCKED=1`. Server stderr contained only the startup line.

## 2. Tool surface (`tools/list`, installed fixed package)

- Tool count: 51 (published 0.1.64: also 51).
- `browser_fetch`, `browser_fetch_batch`, `browser_crawl` present.
- Fixed `outputSchema`: `browser_fetch` top-level declares `blocked`, `blockedBy`, `hint`; `browser_fetch_batch` result items (the first `anyOf` branch) declare `blocked` (`const: true`), `blockedBy`, `hint`, the error branch (`{url,error}`) is separate; `browser_crawl` page items declare `blocked`, `blockedBy`, `hint`, `depth`.
- Published 0.1.64: `browser_fetch` declares none of the three, `browser_crawl` items none.

## 3. Results

Expectation key: PASS = matched the brief's expectation; "info" = recorded, no expectation of content. Times are call start, UTC, 2026-11-11. "Fix" = installed tarball above; "Pub" = published 0.1.64.

| Case | UTC | Tool and exact params | Host | status | blocked / blockedBy | escalated | wordCount | Result |
|---|---|---|---|---|---|---|---|---|
| F1 | 15:22:03 | Fix `browser_fetch {url:"https://ai.miraheze.org/wiki/Agnostic_AI"}` | ai.miraheze.org | 403 | true / cloudflare | false | 0 | PASS (hint present) |
| F4a | 15:22:03 | Fix `browser_fetch {url:"https://example.com/"}` | example.com | 200 | key absent | false | 25 | PASS |
| B1 (as planned) | 15:22:23 | Fix `browser_fetch_batch {urls:["https://stockx.com/","https://example.com/"]}` | stockx.com, example.com | 200, 200 | stockx: key absent (!), example: absent | false, false | 0, 25 | PRECONDITION NOT MET: stockx was not blocked today (see 3.1). Not a test of the blocked path; example.com is a valid normal control. |
| C1 | 15:22:23 | Fix `browser_crawl {url:"https://www.g2.com/", maxPages:1, maxDepth:0}` | www.g2.com | 403 | true / datadome | false | 8 | PASS: `count:1`, seed flagged, `depth:0` |
| F2 | 15:22:24 | Fix `browser_fetch {url:"https://ai.miraheze.org/wiki/Agnostic_AI", browserFallback:true}` | ai.miraheze.org | 403 | true / cloudflare | true | 9 | info: the browser rung ran (11.2 s) and the page stayed blocked (title "Un instant..."); no page content read |
| B1b | 15:23:29 | Fix `browser_fetch_batch {urls:["https://www.glassdoor.com/","https://en.wikipedia.org/wiki/Hypertext_Transfer_Protocol"]}` | glassdoor.com, en.wikipedia.org | 403, 200 | glassdoor: true / cloudflare; wiki: absent | false, false | 73, 8239 | PASS: blocked URL is a normal result (not `error`), wiki has no `blocked` key |
| F3 | 15:23:29 | Fix `browser_fetch {url:"https://www.g2.com/"}` | www.g2.com | 403 | true / datadome | false | 8 | PASS (second vendor) |
| F5a | 15:23:29 | Fix `browser_fetch {url:"https://example.com/", browserFallback:true}` | example.com | 200 | key absent | false | 25 | PASS (no escalation on a normal page) |
| C3 | 15:23:50 | Fix `browser_crawl {url:"https://example.com/", maxPages:1, maxDepth:0}` | example.com | 200 | key absent | false | 25 | PASS: `count:1`, no `blocked` |
| F4b | 15:23:50 | Fix `browser_fetch {url:"https://en.wikipedia.org/wiki/Hypertext_Transfer_Protocol"}` | en.wikipedia.org | 200 | key absent | false | 8239 | PASS |
| F5b | 15:24:10 | same as F4b with `browserFallback:true` | en.wikipedia.org | 200 | key absent | false | 8239 | PASS |
| B2b | 15:24:10 | Fix `browser_fetch_batch {urls:["https://www.g2.com/","https://stockx.com/"], browserFallback:true}` | www.g2.com, stockx.com | 403, 200 | g2: true / datadome; stockx: absent | true, true | 0, 281 | info: g2 still blocked after render (DataDome captcha-delivery iframe); stockx (an empty-body 200 shell on the fast path) was rendered and its content WAS read (281 words). Neither is an `error`. |
| N1a | 15:24:33 | Pub `browser_fetch {url:"https://ai.miraheze.org/wiki/Agnostic_AI"}` | ai.miraheze.org | 403 | key ABSENT | false | 0 | PASS as negative control: unfixed behaviour (interstitial title "Checking your connection...", no flag) |
| N1b | 15:24:33 | Pub `browser_fetch {url:"https://en.wikipedia.org/wiki/Hypertext_Transfer_Protocol"}` | en.wikipedia.org | 200 | absent | false | 8239 | same shape and word count as F4b: normal pages unchanged by the fix |
| E1a | 15:24:41 | Fix + env `FUSE_FETCH_ESCALATE_BLOCKED=1`: `browser_fetch {url:"https://www.glassdoor.com/"}` (no `browserFallback`) | www.glassdoor.com | 403 | true / cloudflare | true | 34 | PASS: escalated by env alone (9.5 s), still blocked |
| E1b | 15:24:54 | same env: `browser_fetch {url:"https://en.wikipedia.org/wiki/Hypertext_Transfer_Protocol"}` | en.wikipedia.org | 200 | absent | false | 8239 | PASS: normal page not escalated |
| S1 | 15:25:00 | Fix default session: `browser_open {}` -> `browser_navigate {url:"https://ai.miraheze.org/wiki/Agnostic_AI"}` -> `browser_extract {kind:"text",format:"text"}` and `{kind:"challenges"}` -> `browser_close` | ai.miraheze.org | n/a | n/a | n/a | n/a | info: title "Un instant...", text "Verification reussie. En attente de la reponse de ai.miraheze.org." + "Enable JavaScript and cookies to continue"; challenges `turnstile:true` (others false). Page never reached the wiki content. Closed (`{"closed":true}`). |
| S2 | 15:25:17 | Fix `browser_open {headless:false, engine:"playwright", channel:"chrome"}` -> `browser_navigate {url:"https://www.glassdoor.com/"}` -> `browser_extract` text + challenges -> `browser_close` | www.glassdoor.com | n/a | n/a | n/a | n/a | info: title "Un instant...", Cloudflare "Verification de securite en cours" page, then "Verification reussie. En attente de la reponse de www.glassdoor.com."; challenges `turnstile:true`. A visible window opened for ~35 s; nothing was clicked or typed. |
| H1 | 15:25:33 | same headed session: `browser_handoff {sessionId, reason:"e2e probe...", selector:"[data-test='employer-search-box'], #sc\\.keyword", timeoutMs:20000}` then `browser_close` | www.glassdoor.com | n/a | n/a | n/a | n/a | `{"status":"timeout","url":"https://www.glassdoor.com/"}` after 20.0 s. Nobody was asked to act. The selector was a best guess at a Glassdoor-only element and was not validated against the real page, so the timeout says nothing about the selector. |
| C2 | not run | `browser_crawl` blocked seed + `browserFallback:true` | www.glassdoor.com | | | | | NOT MEASURED (request budget): estimated cost 3 (robots.txt + seed + render) with glassdoor already at 4/5 |
| B2 (as planned) | not run | batch with `[stockx, example]` + fallback | | | | | | NOT MEASURED; replaced by B2b because stockx was not blocked |

### 3.1 StockX was not blocked today

Plain `browser_fetch_batch` on `https://stockx.com/` returned HTTP 200, a real `<head>` (title "StockX: Sneakers, Streetwear, ..."), an empty body (`wordCount:0`) and no `blocked` key. That is correct behaviour for the fix (not an interstitial), but the brief's "known blocked" candidate was not blocked for this request, so the originally planned B1/B2 pairs had no blocked member. Blocked members used instead: glassdoor (B1b) and g2 (B2b).

### 3.2 Full hint strings observed (4 distinct)

1. cloudflare, fast path, no render (F1, B1b):
   `Blocked by an anti-bot interstitial (cloudflare) — this is not the page content. Retry with browserFallback:true, or read it in a session: browser_open → browser_navigate → browser_extract (if the default session is also challenged, use browser_open {headless:false, engine:"playwright", channel:"chrome"}); if the live page shows a human step (CAPTCHA/turnstile), call browser_handoff.`
2. datadome, fast path (F3, C1):
   `Blocked by an anti-bot interstitial (datadome) — this is not the page content. Retry with browserFallback:true, or read it in a session: browser_open → browser_navigate → browser_extract (if the default session is also challenged, use browser_open {headless:false, engine:"playwright", channel:"chrome"}); if the live page shows a human step (CAPTCHA/turnstile), call browser_handoff.`
3. still blocked after render, cloudflare (F2, E1a):
   `Still blocked after a real-browser render (cloudflare). Read it in a session: browser_open {headless:false, engine:"playwright", channel:"chrome"} → browser_navigate → browser_extract; if the live page shows a human step (CAPTCHA/turnstile), call browser_handoff so a person completes it.`
4. still blocked after render, datadome (B2b):
   `Still blocked after a real-browser render (datadome). Read it in a session: browser_open {headless:false, engine:"playwright", channel:"chrome"} → browser_navigate → browser_extract; if the live page shows a human step (CAPTCHA/turnstile), call browser_handoff so a person completes it.`

Observations on the data (no code was changed or judged):
- `wordCount` is not a reliable block signal: blocked results carried 0, 8, 9, 34 and 73 words while the unfixed N1a also showed 0. The `blocked` flag is the signal.
- The batch call returned `url:"https://www.glassdoor.com/index.htm"` for glassdoor while the single `browser_fetch` (E1a) reported `https://www.glassdoor.com/`. Probably a redirect/normalisation difference between the two paths; not investigated.
- In both sessions (S1, S2) the page showed "Verification reussie. En attente de la reponse..." with `turnstile:true`, i.e. the challenge widget reported success but the site never delivered its content within the ~10 s navigate window.

## 4. Raw JSON of key cases (long `text` bodies trimmed; full files in section 7)

F1 (`F1-fixed.json`):
```json
{"status":403,"url":"https://ai.miraheze.org/wiki/Agnostic_AI","format":"markdown","escalated":false,
 "text":"---\ntitle: \"Checking your connection...\"\nurl: ...\nsite: \"Miraheze\"...[224 chars]","wordCount":0,"extraction":"primary",
 "blocked":true,"blockedBy":"cloudflare","hint":"<hint 1 above>"}
```

F2 (`F2-fixed.json`, 11244 ms):
```json
{"status":403,"url":"https://ai.miraheze.org/wiki/Agnostic_AI","format":"markdown","escalated":true,
 "text":"---\ntitle: \"Un instant…\"\n...lang: \"fr-fr\"\ndescription: \"Our systems have detected…[297 chars]","wordCount":9,"extraction":"primary",
 "blocked":true,"blockedBy":"cloudflare","hint":"<hint 3 above>"}
```

B1b (`B1b-fixed.json`, 630 ms):
```json
{"count":2,"results":[
 {"status":403,"url":"https://www.glassdoor.com/index.htm","format":"markdown","escalated":false,"text":"---\ntitle: \"Security | Glassdoor\"...[720 chars]","wordCount":73,"extraction":"primary","blocked":true,"blockedBy":"cloudflare","hint":"<hint 1 above>"},
 {"status":200,"url":"https://en.wikipedia.org/wiki/Hypertext_Transfer_Protocol","format":"markdown","escalated":false,"text":"---\ntitle: \"HTTP\"...[20187 chars]","wordCount":8239,"extraction":"primary"}]}
```

B2b (`B2b-fixed.json`, 5696 ms):
```json
{"count":2,"results":[
 {"status":403,"url":"https://www.g2.com/","format":"markdown","escalated":true,"text":"---\ntitle: \"g2.com\"...<iframe src=\"https://geo.captcha-delivery.…[726 chars]","wordCount":0,"extraction":"primary","blocked":true,"blockedBy":"datadome","hint":"<hint 4 above>"},
 {"status":200,"url":"https://stockx.com/","format":"markdown","escalated":true,"text":"---\ntitle: \"StockX: Sneakers, ...\"...[4149 chars]","wordCount":281,"extraction":"primary"}]}
```

C1 (`C1-fixed.json`, 324 ms):
```json
{"count":1,"pages":[{"status":403,"url":"https://www.g2.com/","format":"markdown","escalated":false,
 "text":"---\ntitle: \"g2.com\"...\n\nPlease enable JS and disable any ad blocker","wordCount":8,"extraction":"primary",
 "blocked":true,"blockedBy":"datadome","hint":"<hint 2 above>","depth":0}]}
```

E1a (`E1a-fixed-esc.json`, env `FUSE_FETCH_ESCALATE_BLOCKED=1`, 9465 ms):
```json
{"status":403,"url":"https://www.glassdoor.com/","format":"markdown","escalated":true,
 "text":"---\ntitle: \"Un instant…\"...Vérification de sécurité en cours...[408 chars]","wordCount":34,"extraction":"primary",
 "blocked":true,"blockedBy":"cloudflare","hint":"<hint 3 above>"}
```
E1b (`E1b-fixed-esc.json`): `{"status":200,"escalated":false,"wordCount":8239,...}` with keys `status,url,format,escalated,text,wordCount,extraction` only.

N1a, NEGATIVE CONTROL, published 0.1.64 (`N1a-pub.json`, 165 ms):
```json
{"status":403,"url":"https://ai.miraheze.org/wiki/Agnostic_AI","format":"markdown","escalated":false,
 "text":"---\ntitle: \"Checking your connection...\"\nurl: ...\nsite: \"Miraheze\"...[224 chars]","wordCount":0,"extraction":"primary"}
```

Keys of a normal result (F4a/F4b/F5a/F5b/C3 pages/E1b/B1b wiki): `status, url, format, escalated, text, wordCount, extraction`. Keys of a blocked result add `blocked, blockedBy, hint`.

## 5. N1 negative control

Same client script, same `browser_fetch` call as F1, against the installed PUBLISHED 0.1.64: HTTP 403, `wordCount:0`, interstitial title "Checking your connection...", NO `blocked`, `blockedBy`, `hint` keys. Same host in the same minute therefore returns `blocked:true` with the fix (F1, 15:22:03) and no flag without it (N1a, 15:24:33), and normal pages are byte-for-byte the same shape in both (N1b vs F4b). The harness distinguishes fixed from unfixed.

## 6. Per-host request count

Counted conservatively by the runner's ledger (`ledger.json`): one per fast-path fetch, plus the inherent internal requests of a call (crawl: robots.txt + seed = 2; fast fetch + browser render = 2), a browser navigation = 1. Exact on-the-wire counts were NOT MEASURED (no proxy); a browser render also loads sub-resources, and `gotoWithRetry` may re-request internally.

| Host | Count (cap 5) | Calls |
|---|---|---|
| ai.miraheze.org | 6 (5 in the original run, +1 owner-authorised) | F1 (1), F2 (2), N1a (1), S1 navigate (1); later, section 11: T2 navigate (1), the ONE extra navigation authorised by the owner on 2026-11-11 for the humanMode/wait-only check, beyond the cap of 5 |
| example.com | 5 | F4a (1), B1 (1), F5a (1), C3 (2) |
| stockx.com | 3 | B1 (1), B2b (2) |
| www.g2.com | 5 | C1 (2), F3 (1), B2b (2) |
| www.glassdoor.com | 4 | B1b (1), E1a (2), S2 navigate (1) |
| en.wikipedia.org | 5 | B1b (1), F4b (1), F5b (1), N1b (1), E1b (1) |

The runner enforced at least 20 s between the end of one call and the start of the next call to the same host (waits logged in `run.log`; for example `gap wait 19999ms for example.com`). Calls that contain two requests (fetch + render, robots + seed) are back-to-back by design. ai.miraheze.org had already received about 11 requests earlier today from this machine (per the earlier live check), on top of these 5.

## 7. Raw files, scripts and logs

Scratch root: `/private/tmp/claude-501/-Users-brunoazoulay-Labo-docker-lab-dev-local-Dev-ai-claude-code-fuse-browser--claude-worktrees-competitive-analysis-blocked-fetch-ec1ef9/d5fdf163-501c-4af8-bb09-2f55928de7c9/scratchpad/e2e/`

- `run.mjs` client; `run.log`; `ledger.json`; `code-state.txt`; `src-hash-prebuild.txt`; `install-fixed.log`, `install-approve.log`, `install-pub.log`
- `pack/fusengine-browser-mcp-0.1.64.tgz`, `pack/list.txt`
- `install-fixed/`, `install-pub/` (installed packages)
- `raw/<case>-fixed.json`, `raw/<case>-pub.json`, `raw/<case>-fixed-esc.json` (full request params, timestamps, full structured result), `raw/tools-list-{fixed,pub}.json`, `raw/tools-summary-*.json`, `raw/init-*.json`, `raw/stderr-*.json`

## 8. What this proves

- The packed, installed package (not the source tree) exposes the new fields in `tools/list` and returns them from a real stdio server process: `blocked:true`, `blockedBy` (`cloudflare` on two hosts, `datadome` on one) and a `hint` on `browser_fetch` and `browser_crawl` seed pages, and per URL in `browser_fetch_batch` without turning it into an `error`.
- Normal pages (example.com, a Wikipedia article) have no `blocked` key at all on every path tried (fetch with and without `browserFallback`, batch, crawl, env-escalation server) and are not escalated.
- Escalation is opt-in: without `browserFallback` and without the env, `escalated:false`; with either, the browser rung runs (`escalated:true`).
- The published 0.1.64 returns the same 403 interstitial with no flag (N1), so the harness separates fixed from unfixed.
- Build output is clean (src/dist 1:1) and the tarball contains only `dist/`, postinstall, README, LICENSE, `package.json`, `proxies.example.json`.
- No process was left behind (section 9) and no request budget was exceeded.

## 9. What this does NOT prove

- (Update, section 11/T2: about 4 h after the main run the miraheze page loaded with no challenge on a single headed navigation, so "stayed blocked" below describes the 15:22-15:26 UTC snapshot only.)
- It does not show any rung returning the content of a protected page in the main run. Every blocked page (miraheze, glassdoor, g2) stayed blocked on every rung tried: fast path, `browserFallback`, env escalation, default session, headed Chrome session. The only page content obtained through a rung was stockx, which was never an interstitial (empty-body 200 shell rendered to 281 words).
- Live anti-bot behaviour varies per request, per time and per IP; one attempt per case was made. stockx was unblocked today although earlier checks reported Cloudflare, and the two sessions reported a Turnstile that said "success" but did not release the page. These results are a snapshot of 15:22-15:26 UTC.
- No-link-follow on a blocked crawl seed was NOT demonstrated live: C1 used `maxPages:1`, which cannot show it (that behaviour rests on the unit tests). C2 (blocked seed + `browserFallback`) was not run (request budget).
- H1 timed out; the `selector` was unvalidated, so the handoff `resumed` path was not exercised and no human completed anything.
- Only one detector family per vendor was seen: no AWS WAF page was met, so `blockedBy:"aws-waf"` and `"unknown"` were not exercised live.
- Exact request counts on the wire, Windows/Linux behaviour, and Bun-as-runtime for the server were NOT MEASURED.
- `bun test` / `tsc` / biome were not re-run here (done earlier by the lead); this document only covers the installed-package run. The `docs/` files may have been edited by `fastpath-fix` after the hash in section 1 was taken; `src/` did not change (hash identical before and after).

## 10. Cleanup

Every browser session closed (`browser_close` returned `{"closed":true}` for S1 and S2); all 6 server processes of the run (4 fixed, 1 published, 1 env-escalation; the last three PIDs 69669, 70615, 73607 were checked with `ps -p`) had exited; `pgrep -fl "e2e/install|ms-playwright|patchright|run.mjs"` returned nothing; `dist/` is the only build artifact and is git-ignored.

Cleanup after section 11 (checked 19:47 UTC): 2 more server processes (T1 pid 84321, T2 pid 86832) started and exited; the 3 sessions opened there (T1 human, T1 control, T2 headed Chrome) were closed with `browser_close` (`{"closed":true}`, files `raw/T1-*-close.json`, `raw/T2-close.json`); the local 127.0.0.1 HTTP server was closed by the script; `pgrep -fl "e2e/install|ms-playwright|patchright|t.mjs|run.mjs"` returned nothing and no `install-fixed` process remains.

## 11. humanMode (Bezier) — owner-requested check

Owner amendment: « test le » for the Bezier human-mouse mode (`humanMode`, `src/actions/human-mouse.ts`, off by default at `src/agent/config.ts:76`). Same installed FIXED package, same stdio client (`e2e/t.mjs`, run as `node t.mjs T1` and `node t.mjs T2`). The system clock read 19:45-19:47 UTC for these runs (the main run was 15:22-15:26 UTC).

### 11.0 Where `humanMode` is consumed (code, read before the run)

`browser_open {humanMode}` -> `src/server/map-options.ts:33` -> `config.humanMode`, read only by the action paths: `src/server/tools/act.ts:57` (`performAction`, which `browser_click`/`browser_fill` use), `snapshot.ts:75` (`runAct`), `run.ts:41` (`runSteps`), `agent/actions-loop.ts:43`, plus consent in `probe-run.ts:56`. `smartClick` (`src/actions/smart-click.ts`) with `humanMode` does: `humanPause`, `scrollIntoViewIfNeeded`, `humanMoveTo` (cubic Bezier, 24-40 steps, eased, +-1 px jitter, `perStep` about (300+dist*0.6)/steps ms +-3), `locator.hover`, `humanPause`, then the normal `robustClick`. `browser_navigate`, `browser_extract`, `browser_wait_for` never read `config.humanMode` (grep: no hit), and none of them calls `mouse`/`keyboard`/`click`/`hover` (grep of `extraction/challenges.ts`, `actions/wait-for.ts`, `net/navigate.ts`: no hit). So `humanMode` cannot influence T2, which performs no action.

### 11.1 T1: the feature on a LOCAL page (no third party)

Setup: the script serves a page on `http://127.0.0.1:<random port>/` with `<input type=checkbox id=cb>` at (250,200) and `<button id=btn>` at (520,340), and a capture-phase document listener recording `[type, clientX, clientY, performance.now(), isTrusted, target]` for every `mousemove`/`mousedown`/`mouseup`/`click`, rendered live into a `<div id=log>` so it can be read back with `browser_extract {kind:"text", format:"text"}` (no tool reads a page variable). Identical sequence in both runs, through the installed package's tools:

```
browser_open {humanMode:true}  |  browser_open {}        (control)
browser_navigate {sessionId, url:"http://127.0.0.1:<port>/"}
browser_click {sessionId, target:"#cb"}      -> {"result":{"type":"click","ok":true,"strategy":"selector","rung":"direct"}}
browser_click {sessionId, target:"#btn"}     -> same
browser_extract {sessionId, kind:"text", format:"text"}   -> parse the EVLOG
browser_close {sessionId}
```
Both runs: `status` text on the page `checked=true btnFired=1` (the click landed: checkbox checked, button handler fired once). Every recorded event has `isTrusted:true` in both modes. Raw: `raw/T1-human.json`, `raw/T1-control.json` (full tool results and the event arrays), `raw/T1-analysis.json` (derived numbers), `raw/T1-*-close.json`. Run 19:45:25-19:45:34 UTC.

| Measure | humanMode:true click #cb | humanMode:true click #btn | control click #cb | control click #btn |
|---|---|---|---|---|
| `mousemove` events before the `mousedown` | 31 | 37 | 1 | 1 |
| path length (sum of segments) | 262.9 px | 682.4 px | 0 | 0 |
| straight line, first move -> mousedown | 249.4 px | 664.2 px | 0 | 0 |
| path / straight (curvature ratio) | 1.05 | 1.03 | n/a | n/a |
| max deviation from the straight chord | 21.7 px | 63.2 px | n/a | n/a |
| duration, first move -> mousedown | 1002.5 ms | 1034.8 ms | 2.0 ms | 0.3 ms |
| inter-move delay min / median / max | 14.7 / 19.0 / 352.4 ms | 17.0 / 21.1 / 217.7 ms | n/a (1 event) | n/a (1 event) |
| step size, start / middle / end | 2.2, 1.4, 1.4 / about 20 px / 2.2, 1.4, 0 px (max 23.4) | 2.0, 5.1, 5.7 / about 25 px / 1.4, 0, 0 px (max 38.3) | n/a | n/a |
| first move position | (71,64) | (23,16) | (268,217) = the click point | (590,362) = the click point |
| mousedown position | (268,217) | (590,362) | (268,217) | (590,362) |

Totals: humanMode 74 events (68 `mousemove`, 2 `mousedown`, 2 `mouseup`, 2 `click`); control 8 events (2 `mousemove`, 2 each of the others).

Reading of the numbers (measured, not judged beyond them):
- `humanMode` does produce a multi-step, timed, bell-shaped-speed path through the public `browser_click` tool: 31-37 moves, about 1 s per approach, slow-fast-slow step sizes, 15-22 ms typical spacing (with one longer first gap, about 350 / 220 ms, probably the pause before the first move). The control produces a single `mousemove` exactly at the click point, then down/up, in under 3 ms: a teleport.
- The curvature is mild: the path is only 3-5 % longer than the straight line and deviates at most 22 px (short reach) and 63 px (long reach) from the chord. It is a gently bent path, not a strongly curved one.
- Each approach starts from a RANDOM point in the 0-80 px square (code: `from = {randInt(0,80), randInt(0,80)}`), not from the previous cursor position. In the log the second approach starts at (23,16) right after the first click ended at (268,217): that first move of each approach is a jump of about 300 px. This is read from the data and the code only; whether it matters to any detector is NOT MEASURED.
- The path ends exactly on the element centre (268,217) / (590,362) and the last steps shrink to 0-1.4 px.

### 11.2 T2: one real navigation, wait and read only

Authorisation: the owner's request allows this ONE extra navigation on `ai.miraheze.org` (over the budget of 5) and no other third-party host. Run 19:46:50-19:47:01 UTC, raw `raw/T2-timeline.json`, `raw/T2-close.json`.

```
browser_open {headless:false, engine:"playwright", channel:"chrome", humanMode:true}
browser_navigate {sessionId, url:"https://ai.miraheze.org/wiki/Agnostic_AI"}      (19:46:56.4 -> 19:47:00.9, 4.5 s)
poll loop, planned every 10 s for up to 60 s, only: browser_extract {kind:"text",format:"text"}, browser_extract {kind:"challenges"}, browser_wait_for {selector:"#mw-content-text", timeoutMs:1000}
browser_close {sessionId}                                                          -> {"closed":true}
```

Timeline (one poll; the loop stops as soon as `#mw-content-text` is present):

| Poll | UTC | since navigate end | title | words in text | challenges flags | `#mw-content-text` |
|---|---|---|---|---|---|---|
| 0 | 19:47:00 | 4.5 s | "Agnostic AI - Learn AI" (from `browser_navigate`) | 8628 | captcha false, turnstile false, hcaptcha false, cloudflare false, login false, otp true, awsWaf false | present (`browser_wait_for` `ok:true`) |

Outcome: NO challenge was served on this navigation. The real wiki page ("Agnostic AI - Learn AI") loaded within the navigate call itself, so there was nothing to wait out and the question "does the challenge release the page by itself given more than 10 s" was NOT answered by this run (a challenge never appeared; the 60 s wait was never needed). Earlier today the same URL, same engine/channel (headed Chrome via playwright), challenged in S1/S2-like conditions (earlier live checks and S1 at 15:25 UTC with the default engine), so the behaviour varies per request/time; the cause (time of day, IP reputation, engine/channel, `humanMode`, cookies) is NOT MEASURED. `humanMode` cannot be credited: per 11.0 it is not read by any tool used here. Side notes: the `otp:true` flag is an extractor flag on a normal wiki page (probably a text match; not investigated); the extracted text of the wiki begins with raw `.mw-parser-output` CSS, i.e. the text extractor passed inline style content through (not investigated).

### 11.3 What was deliberately NOT done

On a page that shows (or may show) an anti-bot challenge, no input action of any kind was performed: no click, hover, mouse move, key press, scroll, fill, no `browser_click`/`browser_act`/`browser_fill`/`browser_press`/`browser_scroll`, nothing aimed at or near a challenge widget or iframe, no `captcha`/`solveCaptcha` option. T2 used only `browser_open`, `browser_navigate`, `browser_extract`, `browser_wait_for` (read-only conditions) and `browser_close`; `humanMode:true` was passed to `browser_open` as requested but no action tool was called in the session. All clicks of T1 were on a local 127.0.0.1 page the script itself served. No third-party host other than the one authorised navigation was contacted. `browser_handoff` was not called. No retry of T2 and no second navigation: `gotoWithRetry` could in principle re-request on a retryable status or error, but the call returned the page on its first attempt as far as the logs show (exact internal request count NOT MEASURED).

### 11.4 What section 11 proves and does not prove

- Proves: through the installed package's real tools, `humanMode:true` turns `browser_click` into a roughly 1 s, 31-37-step, eased, jittered approach with a mild curve ending on the element, while the default produces a single teleport-click; the clicks land and are `isTrusted` in both modes.
- Does not prove: any effect on an anti-bot system (nothing was tested against one, by rule), that the curve is "human enough", whether the random start point matters, or anything about challenge release time (T2 met no challenge).
