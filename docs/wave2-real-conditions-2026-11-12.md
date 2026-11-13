# Wave 2: real-conditions test (built, packed, installed, over stdio)

Date: 2026-11-12, run 12:44-12:47 UTC (13:44-13:47 CET). Runner: `e2e-runner`. Subject: the frozen tree after wave 2 (uncommitted, on top of `254644b`). Method as in `docs/wave1-real-conditions-2026-11-11.md`: BUILT from a clean `dist/`, PACKED, INSTALLED in a fresh directory, driven by a real MCP SDK client through a real stdio server process. No code, test or other doc was changed.

Status words used below: **measured** (output of this run, raw file named), **read** (read in code, file named), **supposed** (not checked).

Rules kept: no CAPTCHA, no solver option, no input on a challenged page, at most 3 requests per third-party host, at least 20 s between two requests to the same host (client ledger `ledger.json`), one attempt per case except the one repeat disclosed in 5.3, nothing committed or published.

## 1. Environment and code state

| Item | Value |
|---|---|
| OS / Node / Bun / npm | macOS 27.2.1 (arm64) / v26.13.0 / 1.4.4 / 12.2.2 |
| MCP SDK (client and installed server) | `@modelcontextprotocol/sdk` 1.32.2 |
| HEAD | `254644bb600f94e33595c77dabe02231753e4d27` (tree uncommitted) |
| Own markers | `git diff \| shasum` = `b27187bd532e`; `git status --short \| shasum` = `3bcff79b386c`; `git diff` sha256 `1ce080e3d2f83ad80719960fa67a3d509962ef5a0319adb49ab2b8a5f67cd845`; combined (diff + untracked) `ae17043cdba1c98f7baa0d73c52cbb65dfc69e68d1441bf4f2f73c68ebda5dca` |
| `src/` hash (sha256 of sorted per-file sha256) | `be0212358fa1a330864880209478e629b0a920ebce82ab818a0f9e8222dc1d44`; identical before the build and after the whole run |
| Lead's fingerprint `04e8db49` | NOT MAPPED: I do not know which hash the lead used, so it is not compared with mine. Measured instead: no file under `src/` or `tests/` has an mtime later than 13:33 CET on 2026-11-12 (`find -newermt`), and the `src/` hash did not move. |
| Build | old `dist/` moved to `~/.Trash/`, `bun run build` 0.67 s; 329 `.ts` in `src`, 329 `.js` in `dist`, name sets identical; `dist` 1316 files |
| Pack | `npm pack --dry-run`: 1321 files, 477.2 kB; real pack identical count; non-dist files = `LICENSE`, `package.json`, `proxies.example.json`, `README.md`, `scripts/postinstall.mjs`; no dist file other than js/d.ts/maps |
| Tarball | `fusengine-browser-mcp-0.1.64.tgz`, sha256 `4b720f8e85e8f1ce072f2e52df5baf2f807154f9bbffb5b23cd3f6c967266f77` |
| Install | fresh dir, `npm install <tarball>` 136 packages, 0 vulnerabilities; npm 12 blocked the `postinstall` (`allowScripts`), handled with `npm install-scripts approve` + `npm rebuild` (same finding as wave 1). Control: `npm install @fusengine/browser-mcp@0.1.64` in another fresh dir. |
| Server launch | `npx --no-install browser-mcp`, `cwd` = install dir, stdio; `FUSE_OUTPUT_DIR=<scratch>/out` for every server (so `outputMode:"file"` writes into the scratch dir); `FUSE_PRESET` for the preset servers |

Scratch: `/private/tmp/claude-501/-Users-brunoazoulay-Labo-docker-lab-dev-local-Dev-ai-claude-code-fuse-browser--claude-worktrees-competitive-analysis-blocked-fetch-ec1ef9/d5fdf163-501c-4af8-bb09-2f55928de7c9/scratchpad/e2e-wave2/` (`w1.mjs` = wave-1 client, `w2.mjs` = wave-2 client, `raw/`, `out/`, `ledger.json`, `run.log`, `code-state.txt`).

**Tree moved after this run (measured, written 13:52 CET).** At 13:51 CET, i.e. after the run (which ended 13:47 CET), files under `src/` and `tests/` were modified by someone else: `src/interfaces/map.ts`, `src/agent/map-site.ts`, `src/server/tools/map.ts`, `src/extraction/passages-split.ts`, `tests/unit/passages-fence.test.ts`, `tests/unit/map-robots-files.test.ts`, `tests/unit/session-block.test.ts`. The `src/` hash then became `3625c30a34891…` instead of `be021235…`. Every result in this document therefore applies to the build of the `be021235…` state (frozen 13:33 CET), NOT to the tree as it is now; the edited files cover `browser_map`, `focus` passages and the session block (sections 4, 5.1, 6). A rebuild + replay is needed for those parts if the new state is to be released.

## 2. (A) Regression: the 15 wave-1 checks (all local, 12:44-12:45 UTC)

Command: `node w1.mjs fixed A,F,G,J,K,K2,J2,D6,L,L2` and `node w1.mjs pub A,F,J,K,K2,J2,D6,L,L2` (raw: `raw/*-fixed.json`, `raw/*-pub.json`, `summary-*`). Status: **measured**.

| Case | Fix | Control Pub 0.1.64 | Verdict |
|---|---|---|---|
| a2 insertion before | `LOG: [Save]` | `[Delete account]` | PASS |
| a3 element removed | `ok:false, ref_stale` | `[Follow]` clicked | PASS |
| a4 label change | clicked, `refNote.nameChanged Follow->Following` | clicked, no note | PASS |
| j clone before original | `ok:true`, `LOG: [X]` (original clicked, clone never) | `[NEW]` (clone clicked) | PASS (same observable as gate 1) |
| k ref of another tab | `ref_stale` | clicked in the wrong tab | PASS |
| k2 tab-base reuse | D's ref `10000002` refused (`ref_stale`), C's own ref clicks `[C-Target]` | D's ref `2` clicks C's element | PASS |
| j2 `replaceWith` | old ref refused (`ref_stale`), `LOG:` empty | `[NEW:Archive]` clicked | PASS |
| d6 vocab | "Supprimer le filtre" clicked, "Effacer l'historique" `confirmation_required` | both clicked | PASS |
| l2 AWS SDK on a login page | `captcha:false, awsWaf:false` | same | PASS |
| l CAPTCHA 405 / Challenge 202 | `true/true` / `false/true` | `false/false` / `false/false` | PASS |
| l CAPTCHA fixture, h1 "Please solve this CAPTCHA" | `captcha:true, awsWaf:true` | `captcha:true, awsWaf:false` | PASS |
| l text-only captcha page | `captcha:false` | `captcha:true` | PASS |
| f1 prose citing Cloudflare/Turnstile/hCaptcha | all `false` | 4 flags `true` | PASS |
| g1 PDF bomb, `FUSE_PDF_MAX_MB=128` | `pdfError:"memory"`, next call `pageCount:2`, server alive | not run | PASS |

Result: 15 PASS, 0 FAIL. No regression against gate 1.

## 3. (B1) Tool surface (measured, `raw/LIST-fixed.json`, `LIST-pub.json`)

| Check | Fix | Control Pub | Verdict |
|---|---|---|---|
| `tools/list` count | 53; `browser_map` present, `browser_find` present; 0 tools without `annotations.readOnlyHint` | 51; neither tool; all 51 unannotated | PASS |
| `FUSE_PRESET=docs` | 5 tools: `browser_fetch`, `browser_fetch_batch`, `browser_crawl`, `browser_map`, `browser_serp_batch` | 51 (preset unknown to 0.1.64) | PASS |
| `FUSE_PRESET=qa` | 21 tools, includes `browser_find` | 51 | PASS |

## 4. (B2) `browser_map` on real sites (measured, `raw/N-map-*-fixed.json`)

Params `{url, limit:5}`. Request counts are booked at the ceiling of 3 per host; the engine's own `tried` list is only returned on failure, so the real count for code.claude.com and squidfunk is **not measured** (read in `src/agent/map-site.ts`: robots.txt, then listed sitemaps or `/sitemap.xml`, then sitemap files, then llms.txt).

| Case | Time UTC | Result | Verdict |
|---|---|---|---|
| `https://code.claude.com/docs/en/overview` | 12:45:55 | `source:"sitemap"`, `count:5`, `truncated:true`, keys `source,count,urls,truncated`; URLs `https://code.claude.com/docs/de/accessibility`, `/docs/de/admin-setup`, `/docs/de/advisor`, `/docs/de/agent-sdk/agent-loop`, `/docs/de/agent-sdk/claude-code-features` (each with `lastmod`) | PASS on the brief's expectation (5 sitemap URLs, limit respected). Observation: for the seed `/docs/en/overview` the first 5 URLs are German pages (`/docs/de/...`), i.e. not under `/docs/en/`. Whether the seed path is meant to scope the result is NOT verified. |
| `https://squidfunk.github.io/mkdocs-material/` | 12:45:56 | `source:"sitemap"`, `count:5`, `truncated:true`; all 5 URLs under `/mkdocs-material/` (`.../`, `alternatives/`, `browser-support/`, `conventions/`, `creating-your-site/`) | PASS |
| `https://example.com/` (no sitemap) | 12:45:57 | `count:0`, `urls:[]`, `warning:"no_sitemap_found"`, `tried:["https://example.com/robots.txt","https://example.com/sitemap.xml","https://example.com/llms.txt"]`; `source` is still `"sitemap"` | PASS (`warning` + `tried`). `source:"sitemap"` on an empty result is a label observation, not judged. |

Negative control: the published 0.1.64 has no `browser_map` (tools/list, 3).

## 5. (B3) `browser_fetch` additions

### 5.1 `focus` / `topK` (measured)

Real page `https://docs.python.org/3/library/json.html`, `focus:"how to pretty print json with indentation"`, `topK:3` (12:46:07, `raw/N-fetch-focus-fixed.json`): `status:200`, keys = normal keys + `passages`; 3 passages (scores 7.01, 5.17, 4.51); `text` identical to the no-focus text. Relevance: passage 1 (`json.dumps` example) contains the word "indent"; passages 2 and 3 (a `JSONEncoder` example and the "Command-line interface" section) do NOT contain "indent". So relevance is **partly** confirmed, not fully; headings of two passages are empty. Local page (40 sections, one "Installation of the widget" section), `focus:"how to install the widget", topK:3`: 1 passage, heading "Chapter 18 Installation of the widget" (BM25 matched only that section; `topK` is a ceiling). Verdict: PASS (passages returned, top hit relevant on the local page, mixed on the real page).

### 5.2 No focus: unchanged versus published 0.1.64 (measured)

Real page, same URL, no `focus`: fixed (12:46:28) vs published (12:46:49): `text` byte-identical (20373 chars), whole JSON identical, same keys `status,url,format,escalated,text,wordCount,extraction`. Local page: keys identical, JSON length identical (20366), and the 0.1.64 control with `focus` returns no `passages` key. Verdict: PASS.

### 5.3 `maxTokens` / `offset` (measured, local page only)

Local 20,094-char page, `maxTokens:400`, resumed with `offset=nextOffset` until absent: 15 pages; page 1 `textLen 1435`, `nextOffset 1435`, `approxTokens 407`; page 2 starts at 1435, `nextOffset 2747`; last page `offset 18575`, no `nextOffset`, `approxTokens 421`. Largest page 1519 bytes (budget 1600). Concatenation of all pages equals the unbudgeted text exactly (true). No page carries a `truncated` key (the budget adds `nextOffset` and `approxTokens` only). Control Pub: one page of 20,094 chars, no `nextOffset`, params ignored. Verdict: PASS. Not done on a real page (request budget kept for other cases).

### 5.4 `outputMode:"file"` (measured, local page)

`{url, outputMode:"file"}` with `FUSE_OUTPUT_DIR=<scratch>/out`: keys add `outputMode,path,bytes,preview`; `path` = `<scratch>/out/offload/browser_fetch-0e2b475ab6c0.txt` (under the output dir, server-chosen name), `bytes:20094`, `preview` 400 chars, inline `text` replaced by the 400-char preview; the file on disk equals the full text and its byte size equals `bytes`. Control Pub: no `path`, full text inline. Verdict: PASS.

## 6. (B4) Session: blocked detection in `browser_navigate`, `browser_snapshot {within}`, `browser_find`, stale ref

All measured; raw `raw/N-sess-*`, `raw/LOCAL-session-*`.

| Check | Result | Verdict |
|---|---|---|
| `browser_navigate` on a normal page, `https://example.org/` (12:47:32) | `{url, title:"Example Domain"}`, no `blocked` key | PASS |
| `browser_navigate` on `https://www.glassdoor.com/` (blocked in gate 1; default session, 12:46:54-12:47:04) | `title:"Un instant…"`, `blocked:true`, `blockedBy:"cloudflare"`, `hint` = "Blocked by an anti-bot interstitial (cloudflare) — this is not the page content. Wait a few seconds and call browser_extract again (some challenges clear on their own); if it persists, retry from a headed session: browser_open {headless:false, engine:\"playwright\", channel:\"chrome\"} → browser_navigate. The page shows a human step (CAPTCHA/Turnstile): call browser_handoff so a person completes it." | PASS |
| `browser_snapshot {within:"body"}` on example.org | `count:1`, element `0:Learn more` | PASS |
| `browser_find {query:"learn more"}` on example.org | `total:1`, ref `0`, text "Learn more", href `https://iana.org/help/example-domains` | PASS |
| `browser_act {kind:click, ref:"0"}` on that ref | `ok:true, strategy:"ref"`, page moved to `https://www.iana.org/help/example-domains` | PASS |
| same ref again after the navigation | `ok:false, error:"ref_stale", reason:"not_in_snapshot"`, hint "call browser_snapshot again" | PASS |
| local page: `browser_snapshot {within:"#a"}` vs full | `count 2` (Save changes, More details) vs `3` for the whole page | PASS |
| local page: `browser_find {query:"save"}` then `browser_act` on the found ref | `total:1`, ref `0` "Save changes", click `ok:true`, `LOG: [Save changes]` | PASS |
| local page: ref reused after `browser_navigate` to another page | `ok:false, ref_stale, reason:"element_gone"` | PASS |
| local page: `browser_navigate` keys | `url, title` only | PASS |

Control Pub on the local page: `browser_find` is an error (tool absent), `within` ignored (count 3 instead of 2), the stale ref after navigation is not asserted by the control.

Disclosed repeat: the first example.org session attempt (12:46:52) searched the query "information", found 0 matches because the link text is "Learn more", so nothing could be clicked; the flow was re-run once with the query "learn more" (12:47:32). Both raw files are kept (`N-sess-normal-attempt1-query-information-fixed.json`). The repeat is a script error of mine, not a retry of an unstable result.

## 7. Per-host request counts

Booked at the ceiling of what each call can issue; real counts on the wire are not measured.

| Host | Booked | Calls |
|---|---|---|
| code.claude.com | 3 | map (3) |
| squidfunk.github.io | 3 | map (3) |
| example.com | 3 | map (3, equals the 3 URLs in `tried`) |
| docs.python.org | 3 | fetch focus (1), fetch no focus (1), published control no focus (1), 21 s apart |
| example.org | 2 | navigate (1) twice (the disclosed repeat) |
| www.iana.org | 2 | one request each time the click navigated (the first time the click did not run: booked anyway) |
| www.glassdoor.com | 1 | navigate |

All at or under 3. Gaps of at least 20 s enforced per host by the client.

## 8. Not verified

- Real code.claude.com / squidfunk request counts (only the ceiling is known).
- `maxTokens`, `outputMode:"file"` and `offset` on a real page and on the other budgeted tools (`browser_extract`, `browser_snapshot`, `browser_fetch_batch`, `browser_crawl`): only `browser_fetch` on a local page was driven.
- Whether `browser_map` should scope its URLs to the seed path (see 4).
- Passage relevance beyond one real page and one local page; `focus` on a non-English or non-docs page.
- Live anti-bot behaviour varies per request; glassdoor was blocked at 12:46 UTC, no claim about other times. No protected page was read; nothing was solved.
- Bun as server runtime, Linux/Windows, `browser_probe` proxy report.

## 9. Cleanup

Every session was closed by the script (`browser_close`), every client closed in `finally`; `pgrep -fl e2e-wave2` returns 0 and `ps` shows no process from the `e2e-wave2` install dirs. No third-party request came from the local cases. `git status --short` shows this doc as the only file added by this run (`dist/` is git-ignored).

## 10. Replay after the 3 fixes

Run on 2026-11-12, 13:23-13:25 UTC (14:23-14:25 CET), after the tree was re-frozen (13:55 CET; no `src`/`tests` file newer than that, none newer than the new `dist`). Everything in sections 2-6 above applies to the earlier build (`src` hash `be021235…`); this section is the targeted replay of the three challenger fixes (session verdict on invisible reCAPTCHA, CommonMark fence info-string, robots on map's own sitemap/llms fetches). Status: **measured**, raw files in `raw/` (previous run kept in `raw-run1/`).

Code state: HEAD `254644b…`; `git diff | shasum` = `fe3085e0135e`, `git status --short | shasum` = `9e5a100e890c` (the lead's `833ef007` is a different hash and was not compared); `git diff` sha256 `9d18ed7a7cc71334a67f7a8454a7058a416a46f9b89d2fe115d1129ae4f20a02`; combined `adff324d890c985af2cf7328b334a66fe1e0a185968bc7b15a54c81db094c037`; `src/` hash `1542628523896823c20783e5aecd666a400750519bda5550f168c7a37d98718b`, identical before the build and after the run. Old `dist/` moved to `~/.Trash/`, `bun run build` 0.68 s, 329 `.ts` / 329 `.js` parity, 1316 dist files, pack 1321 files (only the 5 expected non-dist files), tarball sha256 `32bd4599766aeace237b717c2833db2535b3eb279ac340d34a9d9f7348ada801`, fresh install (136 packages, npm 12 `allowScripts` handled by approve + rebuild). New request ledger (fresh cap of 3 per host).

| Case | Fix | Control Pub 0.1.64 | Verdict |
|---|---|---|---|
| `tools/list` | 53 tools, `browser_map` + `browser_find` present, 0 unannotated; `docs` preset 5 tools (with `browser_map`), `qa` 21 (with `browser_find`) | 51 tools (section 3) | PASS |
| session, local `/confirm-invisible` (`<button class="g-recaptcha" data-callback>Confirm</button>`) | `browser_navigate` → `{url,title}`, no `blocked` key | no `blocked` | PASS |
| session, local `/thanks-v3-badge` (badge iframe `src=about:blank?recaptcha/api2/anchor`) | no `blocked` key | no `blocked` | PASS |
| session, local `/thanks-hidden-iframe` (0x0 iframe `recaptcha/api2/bframe`) | no `blocked` key | no `blocked` | PASS |
| session, local rendered Turnstile (`cf-turnstile` container with a 300x65 iframe; `challenges.cloudflare.com` aborted with `browser_route`) | `blocked:true, blockedBy:"unknown"`, hint with the handoff advice; `browser_extract` challenges `turnstile:true` | no `blocked` key | PASS |
| session, real `https://example.org/` | `{url,title:"Example Domain"}`, no `blocked` key | n/a | PASS |
| session, real `https://www.glassdoor.com/` (13:24:25 UTC) | `title:"Un instant…"`, `blocked:true`, `blockedBy:"cloudflare"`, hint "Blocked by an anti-bot interstitial (cloudflare) — this is not the page content. Wait a few seconds and call browser_extract again (some challenges clear on their own); if it persists, retry from a headed session: browser_open {headless:false, engine:\"playwright\", channel:\"chrome\"} → browser_navigate. The page shows a human step (CAPTCHA/Turnstile): call browser_handoff so a person completes it." | n/a | PASS |
| `browser_map` `https://code.claude.com/docs/en/overview` limit 5 | `source:"sitemap"`, 5 URLs, `truncated:true`; same 5 `/docs/de/…` URLs as before (the seed-scope observation of section 4 stands) | tool absent | PASS |
| `browser_map` `https://squidfunk.github.io/mkdocs-material/` limit 5 | 5 URLs, all under `/mkdocs-material/` | tool absent | PASS |
| `browser_map` `https://example.com/` | `count:0`, `warning:"no_sitemap_found"`, `tried:[robots.txt, sitemap.xml, llms.txt]` | tool absent | PASS |
| `browser_map`, local, robots `Disallow: /`, no `Sitemap:` line, seed `/docs/` | `count:0`, `skippedByRobots:4`, `warning:"blocked_by_robots"`, `tried:["/robots.txt"]`; only `/robots.txt` requested by the server | tool absent | PASS |
| `browser_map`, local, robots `Disallow: /` + `Sitemap: <origin>/adv.xml` | advertised `/adv.xml` IS fetched (server saw `/robots.txt`, `/adv.xml`, nothing else), `tried:["/robots.txt","/adv.xml"]`; result `count:0`, `warning:"all_filtered"`, NO `skippedByRobots` (the one URL it lists, `/pub/x`, is disallowed by `Disallow: /`) | tool absent | PASS (expectation corrected by `main`): the brief's literal "`skippedByRobots` + `blocked_by_robots`" was wrong for this case. `main`'s decision: with an advertised `Sitemap:` the sitemap is fetched, nothing map-chosen is skipped (so no `skippedByRobots`), and the only listed URL is removed by robots, so `warning:"all_filtered"` is the honest value. Read in `src/agent/map-site.ts:193`: `found ? "all_filtered" : skippedByRobots > 0 ? "blocked_by_robots" : "no_sitemap_found"`. Both raw outputs in `raw/MR-map-robots-fixed.json` (keys `disallow-all-no-advert` and `disallow-all-with-advert`). |
| `browser_map`, local control, robots `Disallow:` (allow all) | `count:1`, URL `/a`, server saw `/robots.txt`, `/sitemap.xml` | tool absent | PASS |
| `browser_fetch {focus}` real `https://docs.python.org/3/library/json.html` | `passages` 3 (7.01 / 5.17 / 4.51), identical to the earlier run, `text` unchanged | no `passages` | PASS (relevance caveat of 5.1 stands) |
| `browser_fetch {focus}` local 40-section page | 1 passage, heading "Chapter 18 Installation of the widget" | `passages:[]` | PASS |
| `browser_fetch {focus:"install the tool"}` local page whose first paragraph is "```js``` is inline code", before `## Install` / `## Usage` | text keeps both headings; passage `{heading:"Install", score:3.46, text:"To install the tool run npm install tool-pro and import it."}` (heading kept, not swallowed by a fence) | `passages` empty | PASS |

Result: 16 rows, 16 PASS, 0 FAIL (one expectation of the brief, the with-advert `Disallow: /` map case, was corrected by `main`, see its row).

Request counts (booked at the ceiling of what a call can issue; wire counts not measured; cap 3 per host, >= 20 s apart): code.claude.com 3 (map), squidfunk.github.io 3 (map), example.com 3 (map; equals its `tried`), docs.python.org 2 (focus + no-focus), example.org 1, www.glassdoor.com 1. Local cases: zero third-party requests (the Turnstile iframe host was aborted).

Not verified in this replay: the unit-level behaviour of the three fixes beyond these cases; `extract {kind:"challenges"}` still reports `captcha:true` on the three reCAPTCHA pages (only `browser_navigate`'s `blocked` verdict was asserted); real-site request counts of `browser_map`; behaviour of glassdoor at other times.

Cleanup: every session closed by the script, every client closed in `finally`, `pgrep -fl e2e-wave2` = 0; only this doc was added by this run.

## 11. Replay 2 (widget container)

Run on 2026-11-12, 13:41 UTC (14:41 CET), after the tree was re-frozen at 14:28 CET for one more fix in `src/extraction/challenge-evidence.ts` (an empty widget container counts again before its iframe renders). LOCAL ONLY: no third-party request (the request ledger was not touched; the `hcaptcha.com` and `challenges.cloudflare.com` hosts the fixtures reference were aborted with `browser_route`). Status: **measured**; raw files `raw/SB-session-fixed.json`, `raw/SB-session-pub.json`, `raw/LIST-fixed.json`; the previous replay is in `raw-replay1/`.

Code state: HEAD `254644b…`; `git diff | shasum` = `fe3085e0135e` (unchanged from section 10: the tracked diff did not move), `git status --short | shasum` = `7919078ac02f`; `git diff` sha256 `9d18ed7a7cc71334a67f7a8454a7058a416a46f9b89d2fe115d1129ae4f20a02`; combined `69798bd9296a69b4516152d397b74ebf7472a38998c9785b925e7591cb0755e5`; `src/` hash `1ad1440ac87798c48a7becb8a76bf9fa3cc0e5a9661913757f19adc3c42f2970` (before the build and after the run); the lead's `aede873e` was not compared. No `src` file is newer than 14:28 CET; `tests/unit/session-block-widgets.test.ts` has an mtime after 14:28 (a test file, not part of the package). Old `dist/` moved to `~/.Trash/`, `bun run build` clean, 329 `.ts` / 329 `.js` parity, 1316 dist files, pack 1321 files (5 expected non-dist files only), tarball sha256 `7d6fb81f3855ee3b9d7b0ab448fd305d9909b7d29316dd9809d7c3e62cf75b51`, fresh install (npm 12 `allowScripts`: approve + rebuild).

| Case | Fix | Control Pub 0.1.64 | Verdict |
|---|---|---|---|
| (a) short page, EMPTY `div.h-captcha`, 303x78 iframe injected 1.5 s after load (fixture of `session-block-widgets.test.ts`), `browser_navigate` | `blocked:true, blockedBy:"unknown"` AT navigate (before the iframe exists), with the hint ("Blocked by an anti-bot interstitial (unidentified vendor) — this is not the page content. Wait a few seconds and call browser_extract again… call browser_handoff so a person completes it."); `browser_extract` challenges `hcaptcha:true, captcha:true`; a second `browser_navigate` on the same page gave `blocked:true` too (the page reloads, so that is a second navigate, not a post-render check) | no `blocked` on both navigates | PASS |
| (b1) `/confirm-invisible` (`<button class="g-recaptcha" data-callback>`) | no `blocked` key | no `blocked` | PASS |
| (b2) `/thanks-v3-badge` | no `blocked` key | no `blocked` | PASS |
| (b3) `/thanks-hidden-iframe` | no `blocked` key | no `blocked` | PASS |
| (c) rendered Turnstile (`cf-turnstile` container with a 300x65 iframe) | `blocked:true, blockedBy:"unknown"`; `browser_extract` `turnstile:true` | no `blocked` | PASS |
| (d) normal local page (`/fence`, an ordinary docs page) | no `blocked` key; all challenge flags `false` | no `blocked` | PASS |
| `tools/list` | 53 tools, `browser_map` + `browser_find` present, 0 unannotated; `docs` preset 5, `qa` 21 | 51 (section 3) | PASS |

Result: 7 rows, 7 PASS, 0 FAIL. Not verified here: the post-render state of (a) through a separate read (the iframe is injected 1.5 s after load; the `browser_extract` call in this script ran right after navigate), real-site behaviour of widgets, the reCAPTCHA pages' `captcha:true` flag in `browser_extract` (still true on b1-b3, as in section 10; only the `blocked` verdict of `browser_navigate` was asserted). Cleanup: sessions closed, `pgrep -fl e2e-wave2` = 0, no third-party request, only this doc added by this run.

## 12. Gate 3

One real-conditions run on the frozen tree, 2026-11-12. Status words as before (**measured** unless said). The machine clock jumped between runs (readings of `date -u` in the scratch logs are not consistent with each other); times below are not used as evidence, raw files carry their own timestamps.

Code state: HEAD `254644b…`; `git diff | shasum` = `6d481614bfd8`, `git status --short | shasum` = `f489c9b22e38`; `git diff` sha256 `b230f5fc864fb51500ccec9002c1e1c1ebde84182d6d03832a2e31891c588689`; combined `369728219714cc44f02a6ca8e4c4c1b53ed25fc87f2ec08799ee67d501fec6f7`; `src/` hash `0b39124de6161b7598e6217b4add050aa11b8fda423c55756513932403930588`, identical before the build and after the whole run. Newest `src` mtime 15:14:38 CET (before the 15:16 freeze); no `src` file newer than the final `dist`. A first build at 15:12 CET was made before the freeze and was discarded: `src/agent/verify-checks.ts` changed afterwards (its results are kept in `raw-gate3-stale-build/`, not used). Final build: old `dist/` moved to `~/.Trash/`, `bun run build` clean, 335 `.ts` / 335 `.js` parity, 1340 dist files, pack 1345 files (5 expected non-dist files, nothing else), tarball sha256 `3f65b64ba7f89fd988a7d03201d356a2ae4f729509164ca082ba1ea2120f83e3`, fresh install (npm 12 `allowScripts`: approve + rebuild). Real MCP server over stdio, `FUSE_OUTPUT_DIR=<scratch>/out`. New request ledger.

### A. Regression, local only

| Group | Fix | Control Pub 0.1.64 | Verdict |
|---|---|---|---|
| 15 wave-1 checks (a2, a3, a4, j, k, k2, j2, d6, l2, l x4, f1, g1) | all as in section 2: `LOG: [Save]`, `ref_stale`, `refNote nameChanged`, `[X]` (never the clone), `ref_stale` x3 (k, k2 with ref `10000002`, j2), "Supprimer le filtre" clicked / "Effacer l'historique" `confirmation_required`, AWS `true/true`, `false/true`, text-only `captcha:false`, SDK login page `false/false`, prose all `false`, bomb `memory` with next call `pageCount:2` | old behaviour on each (`[Delete account]`, `[Follow]`, `[NEW]`, `[A-Target]`, `[C-Target]`, `[NEW:Archive]`, prose 4 flags true, AWS undetected) | PASS 15/15 |
| `browser_map` local robots | `Disallow: /` no advert: `skippedByRobots:4`, `blocked_by_robots`, only `/robots.txt` requested; `Disallow: /` + advert: `/adv.xml` fetched, `all_filtered`; allow-all: `/a`, `robots.txt` + `sitemap.xml` | tool absent | PASS |
| `focus` local + fence page | doc page: 1 passage "Chapter 18 Installation of the widget"; fence page (`` ```js``` is inline code `` before headings): passage heading "Install" kept | no `passages` | PASS |
| `maxTokens` / `offset` | 15 pages, concatenation equals the full text, no `truncated` key | one block, ignored | PASS |
| `outputMode:"file"` | path under `<out>/offload/`, 20094 bytes, preview 400 chars, file equals text | inline | PASS |
| session blocked local fixtures | delayed empty `h-captcha` (iframe at +1.5 s): `blocked:true` at navigate; rendered Turnstile: `blocked:true`; 3 invisible reCAPTCHA pages and a normal page: no `blocked` | no `blocked` anywhere | PASS |
| `snapshot {within}` + `find` + `act` + stale | `within` count 2 vs 3, `find` ref clicked (`LOG: [Save changes]`), ref after navigation `ref_stale` | `find` absent | PASS |

### B. Tool surface

`tools/list` = **54** (control 51); `browser_verify` present; `FUSE_PRESET=qa` = 22 tools including `browser_verify` and `browser_find`; `docs` preset 5; 0 tools without `annotations.readOnlyHint`. PASS. (`raw/LIST-fixed.json`)

### C. `browser_verify` local (`raw/V-verify-fixed.json`, `V-verify-pwchrome-fixed.json`)

Control Pub: tool absent (`isError:true`). Each case uses `url` (temporary session).

| Case | Result | Verdict |
|---|---|---|
| pass page: `{text:"Welcome pass"}`, `{visible:"#ok"}`, `{noFailedRequests:true}` | `pass:true`, `failed:[]` | PASS |
| missing text | `pass:false`, `reason:"text_not_found"` | PASS |
| hidden selector (`display:none`) | `pass:false`, `reason:"not_visible"` | PASS |
| 404 subresource (`<img src=/missing.png>`) | `pass:false`, `reason:"failed_requests"`, `detail:[{url:".../missing.png",status:404}]` | PASS |
| blocked fixture (captured Cloudflare "Just a moment", status 403) | `pass:false`, extra failure `reason:"blocked:cloudflare"`, top-level `blockedBy:"cloudflare"` | PASS |
| `noConsoleErrors` on the default patchright engine | `pass:false`, `reason:"console_unavailable_on_patchright"`, `consoleAvailable:false` | PASS |
| `noConsoleErrors`, `engine:"playwright"`, headless default | `isError`: "Chromium is not installed… Executable doesn't exist at …/chromium_headless_shell-1254/…" (Playwright's own browser revision is not installed on this machine; environment, not a verify defect) | NOT MEASURED with the bundled shell |
| same with `engine:"playwright", channel:"chrome"` (system Chrome) | clean page: `pass:true`, `consoleAvailable:true`; page that does `console.error("boom from page")`: `pass:false`, `reason:"console_errors"`, `detail:["boom from page"]` | PASS |
| evidence files | for every case `after.png`, `console.json`, `network.json`, `receipt.md` exist; all paths are under `<scratch>/out/verify/…` (the output dir); receipt starts `# browser_verify receipt - result: PASS - url … - engine: patchright` | PASS |

Disclosed repeat: the first run of this group had a fixture bug of mine (my local server answered 200 for `/missing.png`, so the 404 case passed); I fixed the server and re-ran the group once; the first raw file is kept as `V-verify-attempt1-fixture404-bug-fixed.json`.

### D. Live (one request each, no retry)

| Case | Result | Verdict |
|---|---|---|
| `https://example.org/` `browser_verify {expect:[{text:"documentation"},{visible:"a"},{noFailedRequests:true}]}` | `pass:true`, `failed:[]`, title "Example Domain", all four evidence files exist | PASS |
| `https://www.glassdoor.com/` `browser_navigate` (default session) | NOT blocked this time: redirected to `https://fr.glassdoor.ch/index.htm?countryRedirect=true`, title "Recherche d'emploi Glassdoor \| Découvrez l’entreprise qui vous mérite", keys `url,title` only, no `blocked` | **expectation not met (live)**: the site served its real page instead of a challenge on this request; the blocked-detection of `browser_navigate` is therefore NOT exercised live in this run (it was on glassdoor in sections 6 and 10, and on local fixtures above). Not a verdict on the code; no retry made (cap of 1). |

Requests: example.org 1, glassdoor 1 (the navigate may issue redirects and sub-resources; wire counts not measured). No third-party request in A, B, C.

Not verified: `browser_verify` with `sessionId`, `baseline`, `evidenceDir`, `fullPage`; the live blocked path today; Playwright's bundled headless shell; Bun as runtime. Cleanup: every session closed, `pgrep -fl e2e-wave2` = 0; this doc and the wave-1 doc are the only untracked files of mine.
