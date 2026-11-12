# Wave 1: real-conditions test (built, packed, installed, over stdio)

Date: 2026-11-11. Runner: `e2e-runner`. Subject: the frozen tree after wave 1 (uncommitted, on top of `254644b`). The package was BUILT from a clean `dist/`, PACKED, INSTALLED in a fresh directory and driven by a real MCP SDK client through a real stdio server process. No code, test or other doc was changed by this run.

Hard rules kept: no CAPTCHA solving, no `captcha`/`solveCaptcha` option, no input of any kind on a challenged page (the AWS WAF fixtures are LOCAL synthetic pages and the third-party script they reference was blocked with `browser_route abort`), at most 3 requests per third-party host, at least 20 s between two requests to the same host, one attempt per case, nothing committed or published.

## 1. Environment and code state (final run)

| Item | Value |
|---|---|
| OS / Node / Bun / npm | macOS 27.2.1 (arm64) / v26.13.0 / 1.4.4 / 12.2.2 |
| MCP SDK (client and installed server) | `@modelcontextprotocol/sdk` 1.32.2 |
| HEAD | `254644bb600f94e33595c77dabe02231753e4d27` (tree uncommitted) |
| Freeze markers (match the lead's) | `git diff \| shasum` = `5032e5e3e0bc`, `git status --short \| shasum` = `c401df4e9cf0` |
| `git diff` sha256 | `a9fe8453d3047a1dc077f56e7e42c2b555b560d50314e725c0237ebbdf2bb313` |
| `src/` hash (sha256 of per-file sha256, sorted) | `e841ecb8789329e836d7fdb2a24d1cae25554b375bb5e4300319cf658d0f3ffa`; identical before the build and after the whole run (the tree did not move) |
| tracked diff + untracked files combined | `64c2f275dac0bd9685be94d02e04ec8b4f586b7bb9f746fc533b14531f23993e` (per-file hashes: `code-state-final.txt`) |
| Build | old `dist/` moved to `~/.Trash/` (never `rm`), `bun run build` (= `tsc -p tsconfig.json`) 0.56 s from an absent `dist/` |
| src/dist parity | 315 `.ts` in `src`, 315 `.js` in `dist`, identical name sets; `dist` has 1260 files (js, d.ts, d.ts.map, js.map) |
| `npm pack --dry-run` | 1265 files, 442.5 kB packed, 1.6 MB unpacked |
| Tarball | `fusengine-browser-mcp-0.1.64.tgz`, sha256 `372f819afc90ce6604b87705538d15fb47946693c73e3fb7f9b122793795114e` |
| Tarball content | 1260 under `dist/` (js, d.ts, maps only) + `LICENSE`, `package.json`, `proxies.example.json`, `README.md`, `scripts/postinstall.mjs`. No stray file (no tests, fixtures, docs, `.env`). |
| Install | fresh dir, `npm init -y && npm install <tarball>`: 136 packages, 3 s, 0 vulnerabilities. Control: `npm install @fusengine/browser-mcp@0.1.64` in another dir (published, without the fix). |
| npm 12 `allowScripts` | `scripts/postinstall.mjs` (Chromium download) is BLOCKED by default ("1 package had install scripts blocked"). Handled with `npm install-scripts approve @fusengine/browser-mcp` + `npm rebuild @fusengine/browser-mcp` (1.2 s: Chromium already in the shared cache). Without the approval no Chromium is fetched; same finding as in the first gate, candidate for `docs/installation.md`. |
| Server launch | `npx --no-install browser-mcp` with `cwd` = the install dir (stdio). `FUSE_PDF_MAX_MB=128` only for the PDF-bomb server. Presets via `FUSE_PRESET`. |

Scratch (everything else): `/private/tmp/claude-501/-Users-brunoazoulay-Labo-docker-lab-dev-local-Dev-ai-claude-code-fuse-browser--claude-worktrees-competitive-analysis-blocked-fetch-ec1ef9/d5fdf163-501c-4af8-bb09-2f55928de7c9/scratchpad/e2e-wave1/` (`w.mjs` client, `raw/` final run, `raw-run1/` state-22:42 run, `ledger.json`, `run.log`, `code-state-final.txt`, `pack/`, `install-fixed/`, `install-pub/`).

## 2. Results (final run, frozen tree; local cases 22:25:08-22:25:46 UTC, published controls about 22:25:50-22:26:36 UTC, arXiv 22:26:38 UTC)

"Fix" = installed tarball; "Pub" = published 0.1.64 control. Local cases serve pages from `http://127.0.0.1:<port>` created by the client script (no third party).

| Case | Tool and params | Expected (fix) | Measured (fix) | Control (Pub) | Verdict |
|---|---|---|---|---|---|
| T1 tools/list | `tools/list` | 51 tools, every one with `annotations` | 51 tools, 51 with `annotations.readOnlyHint` (16 true, 35 false) | 51 tools, 0 with annotations | PASS |
| T2 presets | `FUSE_PRESET=docs` / `=qa`, `tools/list` | docs and qa subsets | docs = 4 (`browser_fetch`, `_fetch_batch`, `_crawl`, `_serp_batch`); qa = 20 | n/a | PASS |
| T3 tokens | `fuse-browser tools --tokens --preset docs` | size table for the preset | 4 tools, 13985 bytes, ~3497 tokens (serp_batch 5252 B/1313 t, fetch 4081/1021, crawl 2363/591, fetch_batch 2289/573); advertised objects incl. title/annotations 14435 B, ~3609 t | n/a | PASS |
| a1 control | drift page `?mode=none`: `browser_snapshot`, wait 3 s, `browser_act {kind:click, ref:<Save>}` | Save clicked | `LOG: [Save]` | `LOG: [Save]` | PASS |
| a2 insertion before | `?mode=before` (a "Promo" button inserted before the bar 1.5 s after load; no re-snapshot) | Save clicked | `LOG: [Save]`, `ok:true` | `LOG: [Delete account]` (wrong, destructive button clicked) | PASS (negative control shows the old bug) |
| a3 element removed | `?mode=removed` (Save removed) | `ref_stale`, nothing clicked | `ok:false, error:"ref_stale", reason:"element_gone"`, hint "call browser_snapshot again", `LOG:` empty | `LOG: [Follow]` (clicked a different button, `ok:true`) | PASS |
| a4 label change | `?mode=label` (Follow -> Following) | clicked with `refNote` | `ok:true`, `refNote:{nameChanged:{from:"Follow",to:"Following"}}`, `LOG: [Following]` | clicked, no `refNote` | PASS |
| b effect | `browser_click #noop` then `#inc` (`#inc` rewrites a div) | no-op: `domChanged:false`; effective: `domChanged:true` | no-op `{urlChanged:false,domChanged:false,settleMs:150}`; effective `{urlChanged:false,domChanged:true,settleMs:0}` | no `effect` key | PASS |
| c snapshot cap | `browser_snapshot` on 230 buttons; control 20 buttons | `truncated:true`, `dropped` | 230: `count:200, truncated:true, dropped:30` + hint; 20: `truncated:false, dropped:0` | no `truncated`/`dropped` keys (200 elements) | PASS |
| d1 sensitive flag | `browser_click {target:"#del", confirmSensitive:true}` on "Delete account" | `confirmation_required`, not clicked | `ok:false, error:"confirmation_required", category:"destructive"`, `LOG:` empty | clicked (`LOG: [Delete account]`) | PASS |
| d2 confirmed | same + `confirmed:true` | clicked | `LOG: [Delete account]` | clicked | PASS |
| d3 default off | `browser_click #del` without flag | clicked | `LOG: [Delete account]` | clicked | PASS |
| d4 harmless | `#save` with `confirmSensitive:true` | clicked | `LOG: [Save]` | n/a | PASS |
| d5 act variant | `browser_act {kind:click, target:"Delete account", confirmSensitive:true}` | refused | `confirmation_required`, `LOG:` empty | n/a | PASS |
| f1 prose | `browser_extract {kind:challenges}` on a page whose prose says "Cloudflare shipped Turnstile, an alternative to hCaptcha" | `cloudflare:false` | all false (`captcha`, `turnstile`, `hcaptcha`, `cloudflare`, `awsWaf`) | `captcha`, `turnstile`, `hcaptcha`, `cloudflare` all TRUE (false positives) | PASS |
| f2 Turnstile markup | page with `<div class="cf-turnstile" data-sitekey=x>` + hidden `cf-turnstile-response` input | `turnstile:true` | `turnstile:true`, others false | `turnstile:true` | PASS |
| g1 PDF bomb | local 458,359-byte Flate bomb (inflates ~150 MB, built with `tests/unit/helpers/pdf-bomb.ts`), server with `FUSE_PDF_MAX_MB=128`, `browser_fetch` | `pdfError:"memory"`, server still answers | `pdfError:"memory"`, text empty, 160 ms; next call (`two-page.pdf`) returned `pageCount:2`; `browser_status` ok; server PID alive | not run | PASS |
| g2 arXiv PDF | `browser_fetch {url:"https://arxiv.org/pdf/1706.03762"}` (1 request, 22:26:38) | text + `pageCount` | `status:200, pageCount:15`, text starts `<!-- page 1 -->` | not run | PASS |
| h1 local preferMarkdown | `browser_fetch` on a local HTML page without markdown, `preferMarkdown:false` vs `true` | text byte-identical | `text` identical; `true` adds `source:"html"`; the server saw `/plain`, `/plain`, `/plain.md` (the twin request) | n/a (field unknown, JSON identical) | PASS (text identical; JSON differs only by `source:"html"`) |
| j clone steals ref | list row + `Other` button; `Other` inserts `cloneNode(true)` of the row BEFORE it; snapshot -> `browser_act` on `Other` -> `browser_act` on the original row's ref | refused, clone never clicked | `ok:false, error:"ref_stale", reason:"element_gone"`; `LOG:` empty (clone not clicked) | `ok:true`, `LOG: [NEW]` (the CLONE was clicked) | PASS |
| k other-tab ref | tab A snapshot; `browser_tabs new` tab B + snapshot; `select` tab A; `browser_act` with B's ref | refused | `ok:false, error:"ref_stale", reason:"not_in_snapshot"` (ref `100002`), A's log untouched; own ref after a fresh snapshot clicked (`LOG: [A-Target]`) | `ok:true`, clicked `A-Target` in the wrong tab (B's ref "2" resolved to A's element) | PASS |
| l1 AWS CAPTCHA (HTTP 405) | local `aws-waf-captcha-synthetic.html`, `browser_route abort **/*awswaf.com/**` first, `browser_extract {kind:challenges}` | `captcha:true`, `awsWaf:true` | `captcha:true, awsWaf:true` | `captcha:false, awsWaf:false` | PASS |
| l2 AWS Challenge (HTTP 202) | local `aws-waf-challenge-synthetic.html` | `captcha:false`, `awsWaf:true` | `captcha:false, awsWaf:true` | `false/false` | PASS |
| l3 text only | local prose page: "Please solve the captcha to continue." (no widget) | `captcha:false` | `captcha:false, awsWaf:false` | `captcha:true` | PASS |
| l4 AWS fixture, h1 text changed | CAPTCHA fixture with `<h1>` replaced by "Please solve this CAPTCHA" (widget script kept) | `captcha:true` (widget) | `captcha:true, awsWaf:true` | `captcha:true, awsWaf:false` | PASS |
| i1/i2 regression | `browser_fetch` on example.com and on the miraheze URL | example: no `blocked` key; miraheze: `blocked:true` | state-22:42 only, see annex (code paths unchanged, section 5) | n/a | carried over |

Summary: 26 rows (25 measured on the frozen build + 1 carried over), 0 FAIL. Every negative control (published 0.1.64 on the same client script) showed the old behaviour: wrong button clicked on insertion (a2) and on removal (a3), clone clicked (j), cross-tab click (k), no `effect`/`truncated`/annotations/confirmation, prose false positives (f1), AWS pages undetected (l1/l2).

### 2.1 Raw files (final run)

`raw/LIST-fixed.json`, `LIST-pub.json`, `PRESETS.json`, `CLI-tokens-docs.json`, `A-drift-{fixed,pub}.json`, `B-effect-*.json`, `C-snapshot-*.json`, `D-sensitive-*.json`, `F-challenges-*.json`, `H-local-*.json`, `J-clone-*.json`, `K-tab-*.json`, `L-aws-*.json`, `G-pdf-bomb-fixed.json`, `G2-arxiv-fixed.json`, `summary-*.json`, under the scratch dir above.

## 3. AWS WAF before/after table (from `serp-fix`) reconciled with the measured (l)

Source: `side-session-notes/.../fuse-browser-gate1-aws-waf-before-after.md` ("Proxy reported" = `src/agent/probe-run.ts:67`, HEAD `cloudflare || captcha`, now `reportBlockedProxy` = `cloudflare || captcha || awsWaf`).

| Fixture | HEAD 254644b captcha / awsWaf / proxy (note) | Now (note) | Measured here, Pub (= HEAD behaviour) | Measured here, Fix |
|---|---|---|---|---|
| AWS WAF CAPTCHA page (405) | false / false / no | true / true / yes | captcha false, awsWaf false | captcha true, awsWaf true |
| AWS WAF Challenge page (202) | false / false / no | false / true / yes (via awsWaf) | false / false | false / true |
| Text only "Please solve this CAPTCHA" | true / false / yes (read in code, not executed) | "see note" | captcha TRUE, awsWaf false (executed on the published package) | captcha FALSE, awsWaf false |

Reconciliation of row 3: the note left the "now" value open ("existing guardrail test asserts text-only -> `captcha:false`"). Measured on the installed final package: a text-only page gives `captcha:false` (l3), and the published 0.1.64 gives `captcha:true`, which confirms the note's HEAD value by execution instead of code reading. So the proxy decision for a pure text mention moves from "reported" (HEAD) to "not reported" (now). The AWS CAPTCHA fixture with the h1 replaced by that sentence (widget script kept, l4) stays `captcha:true / awsWaf:true`, matching the unit test "keeps captcha:true (HEAD behaviour)"; on HEAD that variant gives `captcha:true / awsWaf:false`. The proxy report itself (`probe-run.ts`, `reportBlockedProxy`) was NOT exercised: this run did not call `browser_probe`, so "proxy" columns are taken from the note, NOT MEASURED here.

Fixtures are synthetic (built from AWS docs, host `awswaf.com` and the global `awsWafCookieDomainList` are assumed, as the fixtures state). They were served locally; the `<script src=https://0000.edge.sdk.awswaf.com/...>` they carry was aborted by `browser_route` so no third-party request left the machine.

## 4. Request counts per third-party host (this gate)

Cap 3 per host, >= 20 s apart (enforced by the client ledger `ledger.json`, waits in `run.log`).

| Host | Requests | Calls |
|---|---|---|
| arxiv.org | 1 in the final run (2 over the whole gate: 1 in the state-22:42 run) | final: `browser_fetch` PDF at 22:26:38 UTC |
| www.google.com | 3 (state-22:42 run only) | `browser_serp_batch` (1), follow of one wrapper URL (1), published control `browser_serp_batch` (1), 22 s apart |
| code.claude.com | 2 (state-22:42 run only; counted at the ceiling, real count may be 1) | `browser_fetch {preferMarkdown:true}` |
| modelcontextprotocol.io | 1 or 2 (state-22:42 run only; target of the Google wrapper redirect, "at most one extra same-origin request") | follow of the wrapper |
| example.com | 1 (state-22:42 run only) | `browser_fetch` |
| ai.miraheze.org | 1 (state-22:42 run only) | `browser_fetch` |

The browser SERP call also loads Google sub-resources; exact on-the-wire counts are NOT MEASURED. The AWS and local cases made zero third-party requests.

## 5. Why the network results carry over (module diff on the frozen tree)

The network cases (SERP, wrapper follow, code.claude.com markdown, example.com, miraheze) ran on the 22:42 CET build, before the post-challenger fixes. The lead decided to replay only arXiv. Justification measured here: the installed 22:42 `dist` was compared file by file (`diff -rq -x '*.map'`) with the final `dist`. Modules that differ (js and/or d.ts):

`actions/sensitive-guard`, `actions/sensitive-vocab`, `agent/probe-run`, `extraction/challenge-evidence`, `extraction/challenges`, `extraction/snapshot-walk`, `extraction/snapshot`, `net/pdf-extract`, `server/tool-annotations`, `server/tools/act`, `server/tools/snapshot-output`, `server/tools/snapshot`, `state/effect`.

Byte-identical between the two builds (`cmp`): `agent/serp-batch`, `agent/serp-paged`, `extraction/serp`, `extraction/serp-rank`, `extraction/serp-state`, `net/doc-markdown`, `net/fetch-fast`, `net/read-body`, `net/thin-shell`, `net/block-detect`, `net/block-signals`, `agent/fetch-orchestrate`, `agent/fetch-resolve`, `agent/fetch-render`, `agent/fetch-batch`, `agent/crawl`, `server/tools/fetch`, `server/tools/fetch-batch`, `server/tools/crawl`, `server/tools/serp-batch`.

Dependency check (source): `browser_serp_batch` imports no module of the differing set (its imports: engine registry/teardown, `serp-rank`, `breaker-guard`, `navigate`, `serp-paged`); `serp-paged`, `serp-state`, `serp.ts` do not import `challenges`/`detect`. `extraction/challenges` is imported only by `server/tools/extract.ts`, `agent/run-steps.ts`, `agent/detect.ts`; `probe-run` only by `agent/browser-agent.ts`. The fetch path reaches `pdf-extract` (`fetch-fast`, `fetch-resolve`): that is why arXiv was replayed. Conclusion: the SERP, wrapper-follow, docs-markdown, example.com and miraheze results of the annex carry over to the frozen tree for code reasons; this is an inference from identical modules, not a re-measurement. Live site behaviour (Google, miraheze) can differ between times regardless.

## 6. NOT MEASURED

- Network cases (a SERP with results > 0 and `redirect` flag, wrapper follow, `preferMarkdown` on code.claude.com, example.com, miraheze blocked flag) on the FROZEN build: carried over from the 22:42 build by the module diff above, not replayed (lead's decision, request budget).
- `browser_probe` and the proxy-report decision (`reportBlockedProxy`): the proxy columns of the AWS table come from the note.
- Exact on-the-wire request counts; AWS WAF on a real site; real PDF-memory behaviour on Linux/other engines; Bun as the server runtime; `FUSE_PDF_MAX_MB` default 256 with the same bomb (only 128 used).
- The harmless-but-unexplained ref `100002` in (k): refs of a second tab appear to be namespaced by a large offset; only the refusal was checked.

## 7. What this proves and does not prove

Proves: on the installed package, driven over a real stdio MCP server, the frozen tree gives 51 annotated tools; presets 4/20; the stale-ref guard refuses removed elements, clones and other-tab refs and notes a renamed label, where 0.1.64 acts on the wrong element (including a destructive one); `effect`, snapshot truncation, `confirmSensitive`, prose-safe challenge flags, AWS WAF detection (CAPTCHA, Challenge) and the PDF memory cap with the server surviving all behave as documented, each against a negative control; arXiv's PDF is read (15 pages).

Does not prove: anything about live anti-bot sites (no protected page was read), robustness over time, the proxy-report decision, performance, or behaviour of the network paths on the frozen build beyond the code-identity argument of section 5.

## Annex A: results of the state-22:42 run (build of 22:42 CET, before the post-challenger fixes)

Raw files: `raw-run1/`. Same client, same rules. Build: src hash differs (tree still moving); tarball not kept.

| Case | Result at 22:42 state |
|---|---|
| tools/list, presets, tokens | 51 tools, 51 annotated (22 read-only, 29 not), docs 4, qa 20, docs preset 13985 B / ~3497 t |
| a1-a4 | Save clicked / Save clicked (insertion) / `ref_stale` (removed) / `refNote nameChanged` Follow->Following; Pub: `[Save]`, `[Delete account]`, `[Follow]`, `[Following]` |
| b, c, d | no-op `domChanged:false`, effective `true`; 230 buttons `truncated:true dropped:30`; `confirmation_required` then confirmed click, default off clicked; Pub: no `effect`, no `truncated`, clicked |
| f1 prose | `cloudflare:false turnstile:false hcaptcha:false` but `captcha:true` (the generic word match remained); Pub: all four true. Reported to the owner of challenges, fixed in the final tree (`captcha:false`). |
| f2 Turnstile markup | `turnstile:true` |
| g1 bomb | `pdfError:"memory"`, next call `pageCount:2` |
| h1 local preferMarkdown | text identical, `source:"html"` added when true |
| e SERP (Google, 22:46:50 UTC) | 1 row, 9 results, all `redirect:true` wrapper URLs `https://www.google.com/goto?url=...`; Pub: `results:[]` (same query, 22:47:35) |
| e follow (Google wrapper, `browser_fetch`) | `status:200`, final URL `https://modelcontextprotocol.io/specification/2025-06-18`, `source:"site-markdown"` |
| g2 arXiv | `status:200, pageCount:15`, `<!-- page 1 -->` markers |
| h2 `https://code.claude.com/docs/en/sub-agents`, `preferMarkdown:true` | `status:200, source:"site-markdown"` (text starts with the "Documentation Index" blockquote) |
| i1 example.com | `status:200`, keys `status,url,format,escalated,text,wordCount,extraction` (no `blocked`), 25 words |
| i2 miraheze | `status:403, blocked:true, blockedBy:"cloudflare", escalated:false`, title "Checking your connection..." |

The post-challenger cases (j, k, l) did not exist in that run.

## Annex B: cleanup

All sessions were closed by the script (`browser_close`) and every client was closed in `finally`, which ends the server processes it spawned; `pgrep -fl e2e-wave1` returned nothing at the end of the run. Chromium processes of `chromium-1248` still visible in `ps` afterwards have parent PID 75814 (a long-lived `browser-mcp` of another session), not a process of this run. `git status --short` shows this doc as the only file added by this run; `dist/` is git-ignored.

## Gate 1 — replay after second-pass fixes

Run on 2026-11-12 between 10:08 and 10:09 UTC (the tree had been frozen on 2026-11-11 at 23:46 CET after the challenger's second pass; the newest `src`/`tests` file mtime is 2026-11-11 23:37:19 CET, nothing newer than the build). Local only: NO third-party request in this section (all pages served from `http://127.0.0.1`, `awswaf.com` aborted with `browser_route`). Same client (`w.mjs`), same installed-package method as above.

Code state: HEAD `254644bb600f94e33595c77dabe02231753e4d27`; `git diff | shasum` = `a478cdc1b530`, `git status --short | shasum` = `b053988ed226`; `git diff` sha256 `5783158ee978b78709cd83620b2cea69b1350810001ab92d0534ba442295133e`; `src/` hash `0cf3d6ea637c6f072818c8ea3bcff5573a65b22009abf06a68c0e948b074f989` (same before the build and after the run); combined `c557ce8029b28b5c209ae0a4ea9fdea9819586043a87b3e006f1f7eb2e71b8fc`. Old `dist/` moved to `~/.Trash/`, `bun run build` 0.57 s, src/dist parity 315/315 (1260 files), pack 1265 files with the 5 expected non-dist files only, tarball sha256 `1727ead31144f4eb0f80181da0bf80e3c231f9ac6c892c0bfd36883f4850debd`, fresh install (136 packages, npm 12 `allowScripts` handled by approve + rebuild as before). Raw files: `raw/*-fixed.json`, `raw/*-pub.json` (scratch dir above); the previous gate run is in `raw-gate1-first/`.

| Case | Fix (frozen, second pass) | Control Pub 0.1.64 | Verdict |
|---|---|---|---|
| a2 insertion before | Save clicked (`LOG: [Save]`) | `[Delete account]` (wrong button) | PASS |
| a3 element removed | `ok:false, ref_stale`, `LOG:` empty | `[Follow]` clicked | PASS |
| a4 label change | clicked, `refNote.nameChanged Follow->Following` | clicked, no note | PASS |
| j clone inserted before the original | `ok:true` and `LOG: [X]`: the ORIGINAL row was clicked, the clone (`NEW`) never | `[NEW]`: the clone was clicked | PASS (behaviour changed since the first gate run, see note) |
| k ref of another tab | `ref_stale` (`not_in_snapshot`), `LOG:` empty | clicked `A-Target` of the wrong tab | PASS |
| k2 tab-base reuse: tabs A, B, C; snapshot C; close B; open D + snapshot D; select C; act with D's ref | D's ref is `10000002` (C's is `2`); `ok:false, error:"ref_stale", reason:"not_in_snapshot"`, C's log empty; C's own ref after that clicks `[C-Target]` | D's ref is `2` (same as C's) and the click lands on C's element: `[C-Target]` (wrong tab) | PASS |
| j2 clone REPLACES the original (`replaceWith`, new `li` with text "Archive") | old ref refused: `ok:false, ref_stale, reason:"element_gone"`, `LOG:` empty | clicked the replacement: `[NEW:Archive]` | PASS |
| d6 vocab with `confirmSensitive:true` | "Supprimer le filtre": clicked (not paused), `LOG: [Supprimer le filtre]`; "Effacer l'historique": `confirmation_required`, `LOG:` empty | both clicked | PASS |
| l2 AWS WAF false positive: normal login page embedding the AWS integration SDK script and calling `AwsWafIntegration.getToken()` | `awsWaf:false`, `captcha:false` (`login:true` only) | `awsWaf:false`, `captcha:false` | PASS |
| l CAPTCHA fixture (405) | `captcha:true, awsWaf:true` | `false/false` | PASS |
| l Challenge fixture (202) | `captcha:false, awsWaf:true` | `false/false` | PASS |
| l CAPTCHA fixture, h1 = "Please solve this CAPTCHA" | `captcha:true, awsWaf:true` | `captcha:true, awsWaf:false` | PASS |
| l text-only captcha page | `captcha:false, awsWaf:false` | `captcha:true` | PASS |
| f1 prose citing Cloudflare/Turnstile/hCaptcha | all flags `false` | cloudflare, turnstile, hcaptcha, captcha `true` | PASS |
| g1 PDF bomb (`FUSE_PDF_MAX_MB=128`) | `pdfError:"memory"`, next call `pageCount:2`, server alive | not run | PASS |

Result: 15 rows, 0 FAIL.

Notes:
- (j) In the first gate run the same case ended in `ref_stale` / `element_gone` with nothing clicked; on this frozen build the guard re-binds the ref to the ORIGINAL row (`LOG: [X]`) and still never clicks the clone. This matches the accepted outcome of the integration test (`ref_stale` or original clicked, never the clone) but it is a different observable than the "must refuse" wording of the brief. Recorded as measured; not judged a FAIL because the property that matters (the clone is never clicked) holds.
- (k, k2) The ref of a tab opened after a close carries a large namespace prefix (`10000002`); only the refusal was checked, not the numbering scheme.
- (l2) The AWS integration script is a third-party URL the page references; it was aborted by `browser_route`, the AWS API call therefore throws silently inside the page. What is measured is the detector on that markup, not a live AWS integration.
- NOT MEASURED here: network paths (not replayed by instruction), proxy report of `browser_probe`.

Cleanup: all sessions closed by the script; `pgrep -fl e2e-wave1` returned 0 at the end; no third-party request was made.
