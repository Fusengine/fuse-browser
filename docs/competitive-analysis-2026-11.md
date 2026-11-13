# fuse-browser vs FSB: code-level competitive analysis (2026-11-11)

Scope: fuse-browser v0.1.64 against one competitor, FSB (`fullselfbrowsing/FSB`). Nothing in this document is implemented; the owner decides from section 5. Ideas only, own implementation: no FSB code is to be pasted, and any reuse of an FSB data file would need a recorded license note (FSB is MIT, `LICENSE:1-3`).

## 1. Summary

- **FSB**: a Manifest V3 Chrome extension plus a local Node MCP bridge (WebSocket on 127.0.0.1:7225) that acts inside the user's own logged-in Chrome (`mcp/src/bridge.ts:157-158,355`, `extension/manifest.json:8-26`). It also embeds its own LLM agent loop (`run_task`, `mcp/src/tools/autopilot.ts:33`). Static derivation: 72 MCP tools.
- **fuse-browser**: a Node stdio MCP server (plus CLI and library) that owns its browser process (patchright by default) and adds a no-browser HTTP fast path (Chrome TLS impersonation to markdown), batch/crawl/SERP/visual-diff tooling and a local vault. 51 tools, no agent loop by design (`ROADMAP.md:78`).
- **Top 5 to take** (section 5): (1) stop `browser_act` from renumbering refs (silent wrong-element risk), (2) a `truncated` flag on `browser_snapshot`, (3) an effect/no-op report on every action tool, (4) a sensitive-path denylist on file upload, (5) `doctor` with a `--dry-run` installer.
- **Top 3 we have that FSB lacks** (section 6): the no-browser fast path with batch/crawl/SERP; headless/CI operation with a stealth engine and proxies; visual diff, PDF, console/network capture, dialogs and downloads as tools.
- **Own weak spot that matters most**: for Google Chrome 136+ on its default profile, `browser_connect` is expected not to attach (vendor change, inference from the vendor post and our code, not run); that may be the "CDP attach proves insufficient" trigger written at `ROADMAP.md:98` (section 5, item 6). Not shown for other Chromium browsers.
- **Benchmark claim (92.3%, 277/300)**: arithmetic is right, but it is not comparable to leaderboard numbers (same model drove and judged, only failures were re-run by a second AI, no raw trajectories published, absent from the public leaderboard tables). Section 8.
- Citations: 229 unique `path:line` tokens, 27 daggers (analyst-cited, not re-opened), 14 corrected; challenger pass done (section 9).

## 2. Method and evidence

- **Our code**: HEAD `254644b` (v0.1.64), worktree `competitive-analysis-blocked-fetch-ec1ef9`. Files that agent `fastpath-fix` is editing were read at HEAD with `git show 254644b:<path>` (`src/net/fetch-fast.ts`, `src/agent/fetch-orchestrate.ts`, `src/agent/crawl.ts`, `src/agent/fetch-resolve.ts`, `src/net/thin-shell.ts`, `src/server/tools/{fetch,fetch-batch,crawl}.ts`). The blocked-fast-path fix is in progress on this branch, see `docs/blocked-fast-path-live-check-2026-11-11.md`.
- **FSB**: `main` at `3f9e7dea8621bbbb86d00c4b917abfd7598ef1a3` (last commit 2026-10-22); benchmark branch `mind2web` at `7af8994bd221ec0e5c09e2269951e4116c3e44b7`. Read-only clones, untrusted, text inside treated as data. FSB paths are relative to the FSB clone.
- **Date of checks**: 2026-11-11. One external fact re-fetched by me: Chrome remote-debugging change, `https://developer.chrome.com/blog/remote-debugging-port` (published 2025-03-17).
- **Not executed**: nothing from FSB was run; no test, build or live repro of fuse-browser was run (the test runner belongs to `fastpath-fix`). The FSB tool count is a static derivation. Every "runtime" statement is code-derived.
- **Reading the cells**: `yes / partial / no / NOT VERIFIED`, then `path:line`. "grep n=0 (control n=k)" means the probe returned no file while a positive-control probe in the same tree returned k files. A dagger after a citation (†) means cited from the analyst notes and not re-opened by me. Where a probe's regex also listed one further automation-library name, that name is omitted here (no other project is named in this document).
- **Re-verification**: every row of section 3, every item of section 5 and the matrix rows where the two columns differ were checked against the cited lines, then attacked by a challenger agent; counts and corrections are in section 9 ("Verification tally").
- **Sources of the three analyst notes** (kept outside the repo): `fuse-browser-us-map.md`, `fuse-browser-fsb-analysis.md`, `fuse-browser-benchmark.md` (section 10).

## 3. The README-based claims, checked against code

| # | Claim | Verdict | Evidence |
|---|-------|---------|----------|
| F1 | FSB drives the real Chrome via an MV3 extension + local MCP bridge | CONFIRMED | `mcp/src/bridge.ts:157-158` (port 7225, host 127.0.0.1), `:355` (`WebSocketServer`); `extension/manifest.json:8-26` (`debugger`, `nativeMessaging`, `<all_urls>`) |
| F2 | Installer for "six clients" with `doctor` and `--dry-run` | CONFIRMED, understated | README lists six client rows `README.md:87-92` and the dry-run/doctor line `:95`; registry has 21 entries (16 `installMode: 'file'`, 1 `cli` at `mcp/src/platforms.ts:101`, 4 `instructions` at `:314,324,334,344`); `doctor` `mcp/src/index.ts:572`, `mcp/src/diagnostics.ts:956-1002`; dry-run `mcp/src/install.ts:889-923`. Whether dry-run covers native-host registration: NOT VERIFIED |
| F3 | Trigger watchers | CONFIRMED | `mcp/ai/tool-definitions.cjs:1258`; blocking/heartbeat constants `mcp/src/tools/triggers.ts:34-36`, progress mapper `:97`; watches end on a full Chrome quit `extension/utils/trigger-store.js:15-20`; 10 `tests/trigger-*.test.js` files exist (`ls`), not run |
| F4a | Post-action verification | CONFIRMED | `extension/content/actions.js:273,352,457` (state capture, expected effects, verifier), no-effect click returns `success:false` `:2556-2579` (error text `:2578`); change report wrapper `extension/ws/mcp-tool-dispatcher.js:3952`, hint `:4047`, default on `:11-17`; size cap `extension/utils/action-verification.js:16`; 7 `tests/change-report-*.test.js` |
| F4b | Stuck-action detection | CONFIRMED for the internal loop only, absent for MCP clients | `extension/ai/agent-loop.js:302` (`detectStuck`), threshold 3 `extension/ai/engine-config.js:40`, force-stop `agent-loop.js:462-474`; `detectStuck` is referenced in 5 files, all under `extension/ai/` (none in `mcp/src`, `extension/ws`) |
| F5 | 128-app catalog with signed, audited recipes | PARTIAL | README claim `README.md:117,144,160`. "128" as a service count: `extension/catalog/recipe-index.generated.js` †. "Signed": REFUTED for the shipped catalog: trust list is empty `extension/utils/capability-signature.js:190`; `bundled`/`local` provenance return `{ok:true}` without verification `:257`, and every shipped recipe is bundled (analyst †); non-bundled recipes fail closed (`no-trusted-key`, `:263-275`), so the check is not inert, it is just never exercised in production; the only other references to the trust list are in `tests/` (grep over `extension mcp catalog scripts` returns only the module itself). "Audited" = local append-only log `extension/utils/audit-log.js` † |
| F6 | Long-term memory of sites/selectors/outcomes | CONFIRMED with caveat | bounded store `extension/lib/memory/memory-schemas.js:23-24` (500 entries, 8 MB); for MCP-driven sessions memory is created only after the client calls a terminal task tool `extension/utils/mcp-session-recorder.js:22-26` |
| F7 | `upload_file` via CDP | CONFIRMED | `mcp/ai/tool-definitions.cjs:1426`; `extension/background.js:20028` (`DOM.setFileInputFiles`); path denylist `extension/utils/upload-path-denylist.js:1-14`; 3 upload tests exist |
| F8 | DOM live preview (PhantomStream) | CONFIRMED as a hosted-relay mirror | `package.json:96` (`@full-self-browsing/phantom-stream`), `extension/content/phantom-stream-capture.js:30` (`ext:dom-snapshot`); relay host `fsb-server.fly.dev` †  |
| F9 | Online-Mind2Web 92.3% | Arithmetic CONFIRMED; comparability REFUTED | `README.md:15,37,60`; 228 + 49 = 277 of 300 counted in `mind2web/results/final-review-20261022/per-task-final.csv` (228 / 49 / 6 / 17 by `grep -c` on the credit column); details in section 8 |
| U1 | "We have no benchmark" | CONFIRMED, with nuance | `README.md` contains no benchmark text (grep `benchmark|success rate` n=0; control: the same file matches `51 MCP tools` at `README.md:13`); CI runs typecheck, lint, unit, build, integration only `.github/workflows/ci.yml:34-46`; the only measurement is a weekly, non-gating stealth leak check `.github/workflows/stealth-bench.yml:10,17,38` (it checks detection-page signatures, not task success) |
| U2 | "`browser_connect` is secondary" | PARTIAL | First-class tool `src/server/tools/connect.ts:27-70`, documented `docs/sessions.md:121-145`, `docs/installation.md:65`. But absent from `README.md` (grep n=0 for `browser_connect`; control: the same README grep finds `browser_fetch_batch` at `README.md:60`) and not tested end to end: unit tests cover only the spawn-failure path and URL helpers (`tests/unit/cdp-launch-spawn.test.ts`, `tests/unit/cdp.test.ts`), `tests/live/live-checks.ts:18` only lists the tool name, `tests/integration/mcp.test.ts:30` †; the docs claim an end-to-end verification against a named Chromium-based browser `docs/installation.md:67` has no matching test (NOT VERIFIED) |
| U3 | "We have no loop detection" | CONFIRMED | grep `stuck|loop.?detect|no.?progress|same.?action` over `src/` returns nothing relevant (control: `maxAttempts` found at `src/net/retry-config.ts:15`); planned at `ROADMAP.md:81` |
| U4 | "`siteMemoryDir` scope unknown" | RESOLVED | `src/agent/config.ts:60-61` (`<outputDir>/site-memory`); `outputDir` is `<cwd>/<agent-config-dir>/fuse-browser` when cwd holds one of the host-agent config directories listed in `AGENT_DIRS`, else `~/.fuse-browser` `src/lib/output-dir.ts:13-40`; one JSON file per host `src/state/site-memory.ts:24-38`; stores only the name of the winning locating strategy for `click:`/`fill:` keys `:47-51,72-77`; `lastOkAt` is written (`:74`) and never read (grep: only `:12,:74`); no expiry |

## 4. Capability matrix

FSB paths are relative to the FSB clone; our paths to the repo root.

| # | Capability | fuse-browser | FSB |
|---|-----------|--------------|-----|
| 1 | Architecture, where the browser runs | yes: Node stdio server owns the browser process `src/session/manager.ts:28-40`, `src/engine/cdp-engine.ts:37-53` | yes: MV3 extension in the user's Chrome + local WS bridge `mcp/src/bridge.ts:157-158,355` |
| 2 | Drives the user's real Chrome/profile | partial: CDP attach `src/server/tools/connect.ts:27-70`; Chrome 136+ ignores the debug port on the default data dir (vendor doc), untested here | yes: by design `extension/manifest.json:8-26` |
| 3 | Headless / CI use | yes: `headless` default true `src/agent/config.ts:77`; integration tests run in CI `.github/workflows/ci.yml:46` | no: needs a user Chrome and a paired extension, doctor layers `mcp/src/diagnostics.ts:956-1002` |
| 4 | Engines / stealth posture | yes: patchright default `src/agent/config.ts:64`, stealth init re-applied on CDP `src/engine/cdp-engine.ts:49` | no evasion code found; grep list not read line by line: NOT VERIFIED |
| 5 | MCP tool count and surface | yes: 51 = 41 `registerTool` (grep) + 10 `actTool` `src/server/tools/act.ts:73-82` | NOT VERIFIED exact: 72 by static derivation (†); 57 registry definitions re-counted `mcp/ai/tool-definitions.cjs`; 19 direct registrations not re-counted |
| 6 | No-browser HTTP fast path to markdown | yes: `src/net/fetch-fast.ts:50-55`, `src/agent/fetch-orchestrate.ts:37-54` | no: grep n=0 (control n=4) |
| 7 | Batch fetch | yes: `src/server/tools/fetch-batch.ts:23` | no: grep n=0 (control n=4) |
| 8 | Crawl | yes: `src/server/tools/crawl.ts:20`, bounds `src/agent/crawl.ts:46-52` | partial: UI-started site explorer `extension/utils/site-explorer.js:16-17,30`; not exposed to MCP (grep n=0 in `mcp/`) |
| 9 | SERP | yes: real-browser Google SERP `src/server/tools/serp-batch.ts:29` | no: grep n=0 (control n=4) |
| 10 | Snapshot format and refs | yes: indexed JSON elements, `data-fuse-ref`, frame-scoped refs `src/extraction/snapshot-walk.ts:14-17`, `src/extraction/snapshot.ts:75` | yes: region markdown, `eN` refs, 12000-char default budget `extension/content/dom-analysis.js:2537-2540,2677`, `extension/content/dom-state.js:626-650` |
| 11 | Ref stability / identity after DOM change | no: `browser_act` re-stamps before resolving `src/server/tools/snapshot.ts:73`, `src/extraction/snapshot-walk.ts:62` (code-derived, not run) | partial: generation bump + stale error, but CSS fallback has no identity check `extension/content/selectors.js:576-587`, `extension/content/messaging.js:1054-1062` |
| 12 | Iframes and shadow DOM | yes: every frame + open shadow roots `src/extraction/snapshot.ts:58-80`, `snapshot-walk.ts:65-67`; closed roots opaque `:6` | partial: main frame only `extension/ws/mcp-tool-dispatcher.js:2908`; markdown walker has no shadow handling † |
| 13 | Incremental / diff snapshot | partial: diff only inside `browser_act`, interactive elements only `src/server/tools/snapshot.ts:77-79`, `src/extraction/snapshot-diff.ts:31-33`; snapshot mode planned `ROADMAP.md:82` | NOT VERIFIED: post-action change report exists `mcp-tool-dispatcher.js:3952`; no probe for a since-last-snapshot mode |
| 14 | Self-healing targets | partial: text targets only `src/actions/smart-click.ts:34-68`, `src/actions/heal-locator.ts:67-84`; ref path never heals `src/actions/act-by-ref.ts:51-55` | partial: stored-selector fallback only `extension/content/selectors.js:576-585`; other healing NOT VERIFIED |
| 15 | Post-action verification returned to an MCP client | partial: `browser_act` diff `src/server/tools/snapshot.ts:73-79`; other act tools return `{result,url}` `src/server/tools/act.ts:64`; `domChanged` only via `browser_probe{actions}` `src/server/schemas.ts:73`, `src/agent/compact.ts:13` | yes: `extension/content/actions.js:2556-2579`, `mcp-tool-dispatcher.js:3952` |
| 16 | Stuck/loop detection for an MCP client | no: grep n=0 (control: `maxAttempts` found `src/net/retry-config.ts:15`) | no: internal loop only `extension/ai/agent-loop.js:302`; all 5 users under `extension/ai/` |
| 17 | Natural-language act / built-in agent loop | no: rejected by decision `ROADMAP.md:78` | yes: `mcp/src/tools/autopilot.ts:33` (`run_task`) |
| 18 | Structured extraction by schema | yes: `src/server/tools/extract-schema.ts:38` | no: grep n=0 (control n=4) |
| 19 | Screenshots, multi-viewport | yes: `viewports` + `colorScheme` `src/server/tools/screenshot.ts:37-44` | partial: one emulated viewport per call, no array `mcp/ai/tool-definitions.cjs:920-941` |
| 20 | Visual diff | yes: `src/server/tools/visual-diff.ts:34` | no: grep n=0 (control n=4) |
| 21 | PDF | yes: `src/server/tools/pdf.ts:44` | no: grep n=0 (control n=4) |
| 22 | Network and console capture | partial: tools exist, console empty on the default engine `src/server/tools/logs.ts:16-21,31,66` | no tool: console grep n=0; `Network.enable` only in internal `extension/utils/network-capture.js` |
| 23 | File upload | partial: `<input type=file>` only, any local path `src/actions/upload.ts:36`, `src/actions/act-by-ref.ts:60` | yes: CDP `DOM.setFileInputFiles` `extension/background.js:20028`, denylist `extension/utils/upload-path-denylist.js:1-14` |
| 24 | Downloads | yes: `src/server/tools/dialogs.ts:64` | no: grep n=0 (control n=4) |
| 25 | Dialogs | yes: `src/server/tools/dialogs.ts:36` | no: grep n=0 (control n=4) |
| 26 | Triggers / watchers | no: grep `MutationObserver|watcher` over `src/` n=0 (control: `wait_for` found); nearest is one-shot `browser_wait_for` `src/server/tools/wait.ts:18`, `src/actions/wait-for.ts:11-17` | yes: `mcp/ai/tool-definitions.cjs:1258`, `mcp/src/tools/triggers.ts:34-36`; ends on full browser quit `extension/utils/trigger-store.js:15-20` |
| 27 | Long-term site memory | partial: per-host strategy names for click/fill, no expiry `src/state/site-memory.ts:9-15,47-51,72-77` | yes: bounded store `extension/lib/memory/memory-schemas.js:23-24`, created after a terminal task tool `extension/utils/mcp-session-recorder.js:22-26` |
| 28 | App / recipe catalog | no: none in `src/` (directory listing); rejected as hand-curated guides `ROADMAP.md:78`; one hard-coded site helper `src/consent/booking-currency.ts:11-32` | partial: 128 services †, signature check never exercised in the shipped build (empty trust list) `extension/utils/capability-signature.js:190,257,263-275` |
| 29 | Credential vault | yes: local AES-GCM `src/vault/crypto.ts:46`, origin-bound `src/vault/resolve.ts:20-29`, list-only tool `src/server/tools/vault.ts:25` | yes: `mcp/src/tools/vault.ts:34-84`, plus payment methods `:100-110` |
| 30 | Human handoff | yes: blocks until url/selector, no notification `src/server/tools/handoff.ts:25-56` | NOT VERIFIED: no wait-for-human tool found by name; `partial_task` reports manual blockers `mcp/ai/tool-definitions.cjs:1202` |
| 31 | Live view / preview | yes: local token-gated SSE, read-only `src/live/sse-server.ts:21`, `src/server/tools/live-view.ts:24` | yes: hosted-relay DOM mirror `package.json:96`, `extension/content/phantom-stream-capture.js:30` |
| 32 | Installer for MCP clients | no: grep n=0 (control: `postinstall` found `package.json:52`); manual `docs/installation.md:46` | yes: 21 registry entries `mcp/src/platforms.ts:77-345` |
| 33 | Doctor | no: grep `doctor` over `src docs README.md scripts` n=0 (control as row 32: `postinstall` found) | yes: `mcp/src/index.ts:572`, `mcp/src/diagnostics.ts:956-1002` |
| 34 | Dry-run | no: only the word in `src/server/tools/probe.ts:52` | yes: `mcp/src/install.ts:889-923` |
| 35 | CLI | yes: browsing one-shots `src/bin/cli-usage.ts:10-27` | partial: management CLI only (install, doctor, status, pair) `mcp/src/index.ts:561-600` |
| 36 | Library API | yes: `exports` map in `package.json:38-41` (HEAD), `src/index.ts` | no documented API: `mcp/package.json` `main` is the CLI entry (`:27-31`) |
| 37 | SSRF guard | partial: opt-in, fast path only `src/net/private-net-guard.ts:1-29`, `src/net/fetch-fast.ts:50-55` | n/a: no server-side page fetcher; grep n=0 (control n=4) |
| 38 | robots.txt | partial: off for browser tools `src/agent/config.ts:84`, on for crawl `src/agent/crawl.ts:43,51` | no: grep n=0 (control n=4) |
| 39 | Path confinement | partial: opt-in, screenshot/pdf `path` only `src/lib/write-guard.ts:1-24` | partial: upload denylist only `extension/utils/upload-path-denylist.js:1-14` |
| 40 | Prompt-injection defences | no: grep n=0 (control: `humanApproved` found); nearest is vault origin binding `src/vault/resolve.ts:1-6` | partial: autopilot only `extension/ai/ai-integration.js:490,3593` |
| 41 | Confirmation for destructive actions | partial: `preflight` on `browser_run`/probe only `src/server/tools/run.ts:38`, `src/agent/browser-agent.ts:40` | partial: payment prompt only `mcp/src/tools/vault.ts:100-110`; plain click none † |
| 42 | Captcha handling | partial: detection always; solving opt-in and probe path only `src/captcha/solve.ts:50-58` | partial: opt-in solver in content script, not in tool definitions (grep n=0 in `mcp/src`, tool-definition files) |
| 43 | Telemetry (default) | none: local counters only `src/net/metrics.ts:1-4` | ON by default, opt-out `extension/utils/install-identity.js:126-129`, `extension/utils/telemetry-collector.js:60` |
| 44 | Tests and CI | partial: typecheck + lint + unit + build + integration gate `.github/workflows/ci.yml:34-46`; live scripts and stealth bench do not gate | partial: 409 entries in `tests/`, 403 of them `*.test.*` files (`ls`), node-level; a real Chrome in CI NOT VERIFIED |
| 45 | Published benchmark | no: grep n=0 in `README.md` (control: `README.md:13` matches) | claim exists, not leaderboard-comparable `README.md:15,37,60` (section 8) |
| 46 | License | MIT `LICENSE:1-3` | MIT `LICENSE:1-3` |
| 47 | Proxies / per-country identity | yes: `src/agent/config.ts:57` | no: grep n=0 (control n=4) |
| 48 | HAR record/replay, request mocking | yes: `src/server/tools/route.ts:65`, `src/agent/config.ts:73-75` | no: grep n=0 (control n=4) |
| 49 | Arbitrary JS evaluation tool | no tool: grep `browser_(evaluate|eval|execute)` n=0 (control: `browser_inspect` found) | yes: `mcp/ai/tool-definitions.cjs:102` |
| 50 | Coordinate input | no: planned `ROADMAP.md:84` | yes: `mcp/ai/tool-definitions.cjs:754,798,893` |
| 51 | Multi-client isolation | partial: up to 8 sessions by id `src/session/manager.ts:29-30`; mutation lock planned `ROADMAP.md:85` | yes: per-agent tab ownership, default cap 8 (stated in tool descriptions, e.g. `mcp/ai/tool-definitions.cjs:1202`) |

## 5. What we can take, ranked by benefit / cost for our use

Our real use: agents reading docs, scraping, UI verification, SERP, visual diff. All items are "idea only, own implementation".

### 1. Stop `browser_act` from renumbering refs; add a stale-ref error (verdict: adapt)
- **(a) FSB**: refs are minted per snapshot (`extension/content/dom-state.js:626-650`) with a generation counter bumped on reset (`:634-638`); a dead ref falls back to the stored CSS selector with no identity check (`extension/content/selectors.js:576-587`) and only returns `refStale` when nothing resolves (`extension/content/messaging.js:1054-1062`). Tool-level wiring of `selector:"e5"` to `params.ref` was NOT LOCATED by the analyst, and I found no stale-ref test by file name: so end-to-end wiring on the MCP path is NOT VERIFIED.
- **(b) Ours**: `browser_act` calls `captureSnapshot` before acting (`src/server/tools/snapshot.ts:73`), which re-stamps `data-fuse-ref` by DOM order (`src/extraction/snapshot-walk.ts:59-63`); it then resolves the ref the agent sent (`src/actions/ref-locator.ts:25-30`, `src/actions/act-by-ref.ts:51-55`) and re-stamps again after the action (`snapshot.ts:77`). Main-frame refs are attributes on elements, so while an element stays connected they would stay bound to it if nothing re-stamped them. Other callers re-stamp too: `browser_inspect` re-stamps before resolving its ref (`src/server/tools/inspect.ts:46-47`, same bug); `browser_screenshot` with `annotate` re-stamps on purpose (`src/server/tools/screenshot.ts:72-74`, badges = refs, and the `browser_act` annotate path depends on the stamp at `snapshot.ts:77`, described as "re-marked, anti-drift" at `:56`); the heal fallback of text-target click/fill re-stamps (`src/actions/smart-click.ts:54`, `src/actions/smart-fill.ts:67`). `browser_screenshot` by ref does not (`screenshot.ts:60-66`). Two further drift sources exist with or without re-stamping: sub-frame refs resolve through the frame ordinal `page.frames()[f]` (`ref-locator.ts:27`), which shifts when frames come or go; and `removeAttribute` is never called in `src/` (grep n=0; control: `setAttribute` at `snapshot-walk.ts:62`), so an element that drops out of the walk (past the 200 cap, or no longer interactive) keeps its old value and `.first()` (`ref-locator.ts:29`) can pick it over the element that now carries the same number. The only miss signal is `ref_not_found`. Code-derived; no live repro (a fixture that inserts an element before the target between two acts would prove it).
- **(c) Benefit**: removes a silent wrong-element click in chained actions (fill ref 3, fill ref 4 where the first fill reveals a field), the typical form and UI-verification flow.
- **(d) Cost/risk**: medium. Modules: `src/extraction/snapshot*.ts` (stamp flag, per-session generation, clearing stale stamps), `src/server/tools/snapshot.ts` (non-stamping captures for the diff, the diff key is already structural `snapshot-diff.ts:31-33`), `src/server/tools/inspect.ts`, `src/server/tools/screenshot.ts` and the heal path (`smart-click.ts`/`smart-fill.ts`), `src/actions/ref-locator.ts`/`act-by-ref.ts` (generation check returning `ref_stale`, frame-identity check), session data. Constraint: the annotate paths need an explicit new generation, not "never re-stamp". Risk: ref format if the generation is embedded.
- **(e) Breaks/duplicates**: not on the roadmap. The planned differential snapshot (`ROADMAP.md:82`) needs the same generation model, so do both together.
- **(f) Verdict: adapt.** Keep FSB's idea (generation + explicit stale error); do not copy its CSS fallback without an identity check.

### 2. `truncated` flag and counts on `browser_snapshot` (verdict: take)
- **(a) FSB**: character budget with an explicit continuation marker (`extension/content/dom-analysis.js:2708-2718`), element caps in the dispatcher †. Reported by tests? NOT VERIFIED.
- **(b) Ours**: silent caps, 200 per frame (`src/extraction/snapshot-walk.ts:58-60`) and 400 total (`src/extraction/snapshot.ts:18,62,72`); no `truncated` field (grep n=0 in `snapshot.ts` and `src/server/tools/snapshot-output.ts`; control: `MAX_ELEMENTS` found).
- **(c) Benefit**: removes "the button does not exist" conclusions on long pages (listings, large UIs), a silent failure today.
- **(d) Cost**: tiny: the walk reports how many it dropped; output shape gets `truncated` and a count.
- **(e)** Not on the roadmap; compatible with `ROADMAP.md:82`.
- **(f) Verdict: take.** A correctness gap, not a feature.

### 3. Effect/no-op report on every action tool (verdict: take)
- **(a) FSB**: content-script click captures state before/after and, if no effect signal is seen, returns `success:false`, `hadEffect:false` (`extension/content/actions.js:2556-2579`); a compact `change_report` (cap 2400 bytes, `action-verification.js:16`) is attached by the dispatcher wrapper (`mcp-tool-dispatcher.js:3952`), on by default (`:11-17`), advertised through the tool description (`mcp/src/tools/manual.ts:255-260`). Wired end to end for external MCP clients; 7 change-report tests exist (not run). The signal list (`actions.js:273-455`) is analyst-described †.
- **(b) Ours**: only `browser_act` returns a diff (`src/server/tools/snapshot.ts:73-79`); `browser_click`/`fill`/... return `{result, url}` (`src/server/tools/act.ts:64`); `browser_run` returns per-step results. A `domChanged` signal exists on the probe path (`src/agent/actions-loop.ts:41-54`, `src/state/dom-signature.ts`) and does reach MCP clients through `browser_probe{actions}` (`src/server/schemas.ts:73`, `src/agent/compact.ts:13`, `src/server/tools/probe-output-schema.ts:27`), but not through the session act tools; reuse it rather than rebuilding it.
- **(c) Benefit**: removes the "click returned ok, nothing happened" case that the host agent discovers late.
- **(d) Cost/risk**: medium. Extract the before/after wrapper from `snapshot.ts` into a shared helper used by `actTool` (`act.ts:47-66`) and `browser_run`; the cheap signal (URL + DOM signature) by default, full element diff opt-in; extra evaluates add latency, measure before choosing the default. Risk: do not flip the meaning of `ok` (breaking); add an `effect` field instead.
- **(e)** On the roadmap: `ROADMAP.md:81` (post-action verification, planned). That line promises `{domChanged, urlChanged}` plus an `expect` postcondition; this item is its evidence-backed first step.
- **(f) Verdict: take.**

### 4. Sensitive-path denylist on file upload (verdict: take)
- **(a) FSB**: pure string policy at the chokepoint shared by MCP and autopilot (`extension/utils/upload-path-denylist.js:1-14`), described by FSB itself as a backstop, not a sandbox (`:11-12`). 3 tests exist (`upload-path-denylist`, `upload-file-route`, `upload-file-chokepoint`), not run.
- **(b) Ours**: any local path reaches `setInputFiles` (`src/actions/upload.ts:36`), through one chokepoint: `perform.ts:47-48` and `run-act.ts:54` to `uploadFiles`, `act-by-ref.ts:60` to `setFiles`. `FUSE_CONFINE_WRITES` covers write paths only (`src/lib/write-guard.ts:1-3`).
- **(c) Benefit**: a prompt-injected page asking the agent to attach `~/.ssh` or env files to a form is refused; relevant to form-filling and UI-verification flows.
- **(d) Cost**: small: one policy function and tests in `src/actions/upload.ts`. We can do better than a pure string match by canonicalizing first with the existing symlink-safe `src/lib/canonicalize-path.ts` (a string-only policy is symlink-bypassable).
- **(e)** Not on the roadmap. Own list; if anyone proposes importing FSB's list verbatim, it needs a recorded MIT license note.
- **(f) Verdict: take.**

### 5. `doctor` and a dry-run-first installer (verdict: adapt)
- **(a) FSB**: client registry `mcp/src/platforms.ts:77-345` (OS paths, format, merge strategy), writer with `.bak` backup `mcp/src/config-writer.ts:187-188`, `--dry-run` `mcp/src/install.ts:889-923`, `doctor` returning one prioritised layer with a next action and exit code `mcp/src/diagnostics.ts:956-1002`, `mcp/src/index.ts:531`. Tests `mcp-install-platforms`, `mcp-diagnostics-status` exist, not run. Gap: its doctor does not validate the MCP client's config file (analyst †).
- **(b) Ours**: nothing (grep n=0). Registration is manual (`docs/installation.md:46-57`); the post-install browser download never fails the install and only warns (`scripts/postinstall.mjs:16-24`), so a server can start with no browser binary; `docs/installation.md:9` says Node >= 20 while `package.json` `engines.node` is `>=22` (HEAD `:32`).
- **(c) Benefit**: removes first-run "tools listed, browser launch fails" support loops and version mismatches; the dry-run removes fear of editing other tools' config files.
- **(d) Cost/risk**: medium. New CLI subcommands in `src/bin/` (routing `cli.ts`, text `cli-usage.ts`), an install module with a client table and a backup-first writer; doctor checks drawn from our own failure modes (Node version, engine binary present, vault key file mode, conflicting env). Risks: writing other tools' config (default to dry-run, backup, owner picks the client list), TOML/YAML clients need new parsers.
- **(e)** Not on the roadmap; shrinks `docs/installation.md`. Ship `doctor` first, installer second.
- **(f) Verdict: adapt.** Doctor now; installer for the few clients actually used.

### 6. `browser_connect`: diagnose Chrome 136+, revisit the extension decision with evidence (verdict: take the diagnostic; skip the extension)
- **(a) FSB**: avoids the debug port by running as an extension (cost: `debugger` + `<all_urls>` permissions `extension/manifest.json:8-26`, pairing and a native host, one profile attached at a time `README.md:269`).
- **(b) Ours**: `browser_connect` spawns the browser with `--remote-debugging-port` and an optional `--user-data-dir` (`src/engine/cdp-launch.ts:34-36`), then polls `/json/version` (25 tries x 300 ms, `:55-69`). Per the Chrome vendor post (2025-03-17, Google Chrome only), from Chrome 136 the switch "will no longer be respected" on the default data directory. Nothing in code or docs handles this (`docs/sessions.md:121-145` read; grep n=0 for "136"). Expected effect (inference, not run): default `browser_connect {browser:"chrome"}` on Google Chrome 136+ with no `userDataDir` times out in `waitForCdp`; with a custom dir it is not the user's real profile. Not shown for other Chromium browsers (the docs claim one verified, no test: NOT VERIFIED). Two further cases the diagnostic should cover, both inference: another debug browser already serving the same port makes `waitForCdp` succeed at once and attaches to the wrong browser (`src/server/tools/connect.ts:62-68`); and a Chrome already running on the default profile may hand the new launch off to the existing process, which times out on any version, so a timeout alone does not point to the 136 change (compare the `/json/version` Browser field with the launched binary). `docs/installation.md:65` still promises "the user's real session".
- **(c) Benefit**: a clear error and accurate docs instead of a timeout; the realistic route to logged-in sessions stays named profiles, the vault and `browser_handoff`.
- **(d) Cost**: diagnostic + docs: small. An MV3 bridge: large (new codebase, store review, broad permissions, trust cost).
- **(e)** `ROADMAP.md:98` reads "not needed for now ... revisit only if CDP attach proves insufficient". This finding may be that trigger, for Google Chrome on its default profile only; it is surfaced for the owner, not overridden.
- **(f) Verdict: take the diagnostic and doc fix; skip the extension for now** (owner decision on `ROADMAP.md:98`).

### 7. Repeat/stuck hint in action results (verdict: adapt, after item 3)
- **(a) FSB**: `detectStuck` fingerprints non-read-only tool+target, strict repeat counter, goal-progress window, hint injected into the model prompt (`extension/ai/agent-loop.js:302` onward; threshold `:304`, force-stop `:462-474`); test `tests/stuck-action-repetition.test.js` exists, not run. Internal loop only: an external MCP client never receives it (grep over `mcp/src`, `extension/ws` n=0; control: `buildChangeReport` found in `mcp-tool-dispatcher.js`).
- **(b) Ours**: none (U3).
- **(c) Benefit**: a repeated identical failing action gets flagged in the tool result instead of looping in the host.
- **(d) Cost**: small once item 3 exists: a per-session ring of (tool, target, effect) in session data and a hint field. No thresholds proposed here; pick from observed data.
- **(e)** On the roadmap (`ROADMAP.md:81`). FSB gives no prior art for the MCP-facing part, so the design is ours.
- **(f) Verdict: adapt.**

### 8. Publish one reproducible measurement (verdict: adapt)
See section 8 (Proposal A: offline main-content extraction of the fast path). FSB's harness hygiene is worth copying (pinned dataset revision, vendored judge at a pinned commit, per-task verdict tables: `mind2web/judge/README.md:3`, `mind2web/README.md:27` †); its headline practice (same model drives and judges, failures re-run) is not.
- **(b) Ours**: none (U1). **(c)** credibility, and regression detection on our most differentiated feature. **(d)** medium: a script, a pinned snapshot, offline CI; dataset availability and licence are not yet verified. **(e)** not on the roadmap. **(f) adapt.**

### 9. Coordinate click fallback (verdict: adapt, low priority)
- **(a) FSB**: `click_at`, `drag`, `double_click_at` (`mcp/ai/tool-definitions.cjs:754,798,893`); CDP input is used in the service worker (`extension/ws/ws-client.js:1037`).
- **(b) Ours**: none; human-mouse paths exist (`src/actions/smart-click.ts:38-44`).
- **(c) Benefit**: canvas/map/WebGL pages; rare in our listed uses. **(d)** small: schema plus `page.mouse`, reuse the Bezier path. **(e)** `ROADMAP.md:84`. **(f) adapt**, after items 1 to 5.

### 10. Region-bucketed markdown snapshot with a char budget (verdict: skip for now)
- **(a)** `extension/content/dom-analysis.js:2537-2730` †. **(b)** ours is a JSON element list with many fields per element (`snapshot-walk.ts:35-56`). **(c)** token savings are plausible but unmeasured; no number is claimed here. **(d)** medium. **(e)** would collide with the planned differential snapshot (`ROADMAP.md:82`). **(f) skip** until our snapshot token cost is measured; item 2 covers the correctness part.

### 11. Trigger watchers (verdict: skip)
- **(a)** FSB: end-to-end, 10 test files, one selector + condition kinds, blocking or detached results (`mcp/src/tools/triggers.ts:34-36,97`); survives service-worker eviction, not a browser quit (`trigger-store.js:15-20`). **(b)** Ours: one-shot `browser_wait_for` (`src/actions/wait-for.ts:11-17`); sessions idle out at 300 s (`src/session/manager.ts:29`). **(c)** Little value for docs/scrape/SERP/UI verification. **(d)** large (a long-lived watcher registry). **(e)** not on the roadmap. **(f) skip.** If wanted later, a cheaper variant is two extra condition kinds (`changed`, `threshold`) on `browser_wait_for`.

### 12. Capability/app catalog (verdict: skip)
- **(a)** FSB: 128 services, mostly unproven (the shipped trust list is empty so the signature check is never exercised, `capability-signature.js:190,257,263-275`), imported third-party metadata whose vendored tree contradicts its own "metadata only" note (`vendor/` PIN note †). **(b)** Ours: none. **(c)** Our uses do not need per-app APIs. **(d)** very large and a permanent maintenance load. **(e)** Adjacent to the recorded rejection of hand-curated site guides (`ROADMAP.md:78`): flagged, not contradicted. Importing any of it would need a license note (FSB MIT plus its upstream). **(f) skip.**

### 13. Real-Chrome MV3 extension bridge (verdict: skip)
Covered by item 6; `ROADMAP.md:98` already defers it. Cost is a second codebase plus permissions and store review.

### 14. Telemetry (verdict: skip)
FSB: on by default, opt-out (`extension/utils/install-identity.js:126-129`, endpoint `telemetry-collector.js:60`). Ours: local counters only (`src/net/metrics.ts:1-4`). Rejected at `ROADMAP.md:78`. Skip.

### 15. FSB-style memory store (verdict: skip)
FSB: bounded semantic/procedural/task memories, written after a terminal task tool (`memory-schemas.js:23-24`, `mcp-session-recorder.js:22-26`). It is prompt context for FSB's own loop; for us the host owns that. Procedural memory is already planned (`ROADMAP.md:83`). Note our own gap in section 7 (no invalidation). Skip.

### 16. Regex scrub of page text for prompt injection (verdict: skip)
FSB: 10-phrase scrub, autopilot only (`extension/ai/ai-integration.js:3593`, system line `:490`); nothing sanitises what MCP clients receive. A phrase list is brittle; our real defence is origin-bound vault fills (`src/vault/resolve.ts:1-6`). Skip.

### 17. Per-agent tab ownership (verdict: skip)
Different architecture (many clients, one browser). The per-session mutation lock is already planned (`ROADMAP.md:85`). Skip.

### 18. Hosted DOM mirror (verdict: skip)
FSB mirrors the DOM to a hosted dashboard (`package.json:96`); a hosted relay is a privacy decision. We have a local, token-gated live view (`src/live/sse-server.ts:21`). Skip.

## 6. What we have that FSB lacks

FSB probe set for every row: `mcp/src extension/background.js extension/ws extension/ai extension/content extension/utils mcp/ai`, case-insensitive. Positive controls on the same set: `chrome.debugger.sendCommand` n=4 files, `captcha` n=12 files.

| Capability | Ours (path:line) | FSB probe (n = files) |
|-----------|------------------|-----------------------|
| No-browser HTTP fast path to markdown, JSON passthrough | `src/net/fetch-fast.ts:50-55`, `src/agent/fetch-orchestrate.ts:37-54` | `turndown|htmlToMarkdown|html-to-markdown` n=0 |
| Batch fetch | `src/server/tools/fetch-batch.ts:23` | `fetch_batch|fetchBatch` n=0 |
| Crawl as an MCP tool | `src/server/tools/crawl.ts:20` | `SiteExplorer|CrawlerManager|site-explorer` in `mcp/src`, `mcp/ai` n=0 (exists only as extension UI feature, `background.js` n=1) |
| SERP scraping | `src/server/tools/serp-batch.ts:29` | `\bserp\b` n=0 |
| Schema extraction by container | `src/server/tools/extract-schema.ts:38` | `extract_schema|extractSchema|containerSelector` n=0 |
| Visual diff | `src/server/tools/visual-diff.ts:34` | `pixelmatch|visual.?diff|pixel.?diff` n=0 |
| PDF export | `src/server/tools/pdf.ts:44` | `printToPDF` n=0 |
| Multi-viewport screenshots in one call | `src/server/tools/screenshot.ts:37-44` | one emulated viewport per call `mcp/ai/tool-definitions.cjs:920-941` (read) |
| Console/network capture tools | `src/server/tools/logs.ts:31,66` | console `Runtime.consoleAPICalled|Log.enable|get_console` n=0; `Network.enable` n=1 (internal capture file only) |
| Dialog and download handling | `src/server/tools/dialogs.ts:36,64` | `Page.javascriptDialogOpening|handleJavaScriptDialog` n=0; `Page.downloadWillBegin|Browser.setDownloadBehavior|chrome.downloads` n=0 |
| Request mocking / HAR | `src/server/tools/route.ts:65`, `src/agent/config.ts:73-75` | `Fetch.fulfillRequest|Fetch.enable|harPath|recordHar` n=0 |
| Proxies and per-country identity | `src/agent/config.ts:57` | `proxyUrl|chrome.proxy` n=0 |
| Headless / CI operation | `src/agent/config.ts:77`, `.github/workflows/ci.yml:46` | needs a user Chrome and a paired extension (`mcp/src/diagnostics.ts:956-1002`) |
| Stealth engine | `src/agent/config.ts:64`, `src/engine/cdp-engine.ts:49` | no evasion code identified (not fully read: NOT VERIFIED) |
| SSRF guard, robots honoring (opt-in/partial, see section 7) | `src/net/private-net-guard.ts:1-29`, `src/agent/crawl.ts:43,51` | `ssrf|isPrivateIp|169\.254` n=0; `robots\.txt|robots-txt` n=0 |
| Library API and browsing CLI | `package.json:38-41` (HEAD), `src/bin/cli-usage.ts:10-27` | `mcp/package.json:27-31` main = CLI entry; CLI is management-only `mcp/src/index.ts:561-600` |

## 7. Weak spots found in fuse-browser while mapping (no fix proposed here)

1. **Ref drift**: `browser_act` renumbers refs before resolving them and after acting (`src/server/tools/snapshot.ts:73,77`, `src/extraction/snapshot-walk.ts:62`); `browser_inspect` does the same before resolving its ref (`src/server/tools/inspect.ts:46-47`); stale stamps are never removed (grep n=0 for `removeAttribute`) and sub-frame refs depend on the frame ordinal (`src/actions/ref-locator.ts:27,29`). Code-derived, not reproduced.
2. **Silent snapshot truncation**: 200 per frame and 400 total with no flag (`snapshot-walk.ts:58-60`, `snapshot.ts:18,62,72`).
3. **`browser_connect`**: no end-to-end test (name-only listings `tests/live/live-checks.ts:18`, `tests/integration/mcp.test.ts:30` †); Chrome 136+ default-profile restriction unhandled (vendor post, section 5 item 6); no handling of "browser already running without a debug port" (`src/server/tools/connect.ts:56-61`); the debug port is an unauthenticated local surface (warning at `src/engine/cdp-launch.ts:6-11`).
4. **Guards off by default and partial**: SSRF guard is opt-in and only used by the fast path (`src/net/private-net-guard.ts:4-6`; `assertNetworkAllowed` appears only in `src/net/fetch-fast.ts:53,55` besides its own module, grep), so `browser_navigate`/probe can reach private nets; write confinement is opt-in and covers screenshot/pdf paths only (`src/lib/write-guard.ts:1-24`); `respectRobots` defaults to false for browser tools (`src/agent/config.ts:84`); `preflight` covers `browser_run`/probe only, not `browser_click`/`browser_act` (`src/server/tools/run.ts:38`, `src/agent/browser-agent.ts:40`; `act.ts` and `snapshot.ts` do not import it).
5. **Upload has no path restriction** (`src/actions/upload.ts:36`); no file-chooser handler (grep `filechooser` n=0 over `src/`; control: `setInputFiles` found at `src/actions/upload.ts:36`).
6. **No prompt-injection defence** beyond vault origin binding (grep n=0).
7. **Doc/code mismatches**: `ROADMAP.md:8` says 49 tools (code: 41 + 10 = 51); `ROADMAP.md:80` lists the vault as planned although it is implemented (`src/server/tools/vault.ts:25`, `src/bin/cli-usage.ts:29-33`); `docs/installation.md:9` says Node >= 20, `package.json` engines `>=22`; `ROADMAP.md:81` expects `{domChanged, urlChanged}` on act/run but the code gives `diff.urlChanged` on `browser_act` only (`src/extraction/snapshot-diff.ts:17-23`) and `domChanged` only on the probe path, i.e. `browser_probe{actions}`, not on the session act tools or `browser_run` (`src/agent/actions-loop.ts:54`, `src/agent/compact.ts:13`); `docs/installation.md:65-67` promises the user's real session and an end-to-end verification against a named browser without a test.
8. **Console capture empty on the default engine** (documented in the tool description, `src/server/tools/logs.ts:16-21`).
9. **Self-healing only on text targets**; the ref path never heals (`src/actions/act-by-ref.ts:51-55`).
10. **Site memory never invalidates**: written on success, `lastOkAt` never read (`src/state/site-memory.ts:12,74`); a stale strategy only reorders attempts.
11. **Handoff cannot notify a human**; headless only adds a warning (`src/server/tools/handoff.ts:43`).
12. **Hard-coded absolute developer path** in the live harness (`tests/live/live-checks.ts:10-11`).
13. **CI gate gaps**: live scripts do not run in CI; the stealth bench is weekly and `continue-on-error` (`.github/workflows/stealth-bench.yml:10,15-17`). No dedicated test file by name for fetch-batch, serp-batch, shots-batch (content-level coverage not checked: NOT VERIFIED).
14. **Open issues**: 8 open GitHub issues (#2, #42 to #47, #78) were listed by `us-map` via `gh` †; #42, #43, #45 concern the live view, #47 metrics.

## 8. Benchmark

### (a) FSB's claim audited (FSB branch `mind2web` at `7af8994b`; all of this is read, nothing was run)
- **What 277/300 is**: 228 tasks that passed a majority of both an "official" and a "strict" variant of an AI judge, plus 49 "manual_supported" tasks; 6 "qualified" and 17 "not met" get zero. Counted by me on `mind2web/results/final-review-20261022/per-task-final.csv` (228 / 49 / 6 / 17; sums to 300). 277/300 = 92.33%.
- **Who drove, who judged**: the unmodified public FSB release driven by Claude Code on Claude Opus 5.5, "with Claude Opus 5.5 also judging" (`mind2web/README.md:5`; `mind2web/PUBLIC-RELEASE.md:3`). The judge is a local fork of OSU's evaluator with a changed parser (`mind2web/judge/README.md:3-5`); FSB calls the scores "uncalibrated and not OSU-verified" (`mind2web/FINAL-REVIEWED-REPORT.md:42`).
- **Selective retries**: the 49 come from re-running the 72 tasks that failed an automated variant (`mind2web/FINAL-REPORT.md:57` †), by a second AI assistant that also graded them ("non-blind", `mind2web/FINAL-REVIEWED-REPORT.md:11`), with a human clearing a bot challenge on one task (`mind2web/FINAL-REVIEWED-REPORT.md:11` †). FSB's own words: a "recovery diagnostic" (`mind2web/FINAL-REPORT.md:65`), a "mixed-actor, reviewed-completion composite" (`mind2web/FINAL-REPORT.md:55`), and "not a fresh, uniform 300-task execution by one model" (`mind2web/results/benchmark-publication-20261022/METHODOLOGY.md:21`). The harness rule "agent failures are never selectively retried" (`mind2web/README.md:93`) applies to the automated queue only.
- **Pre-recovery automated scores** (denominator 300, missing = 0): 79.00% official mean, 72.67% strict mean (`mind2web/FINAL-REPORT.md:9-12` †).
- **Leaderboard status**: "this is not an official leaderboard placement" (`mind2web/BENCHMARK-REPORT.md:19`). The chart's other bars match OSU's human-evaluation table while FSB's bar is AI-reviewed (`METHODOLOGY.md:37`, bench-analyst comparison †). FSB is absent from both public leaderboard tables fetched on 2026-11-11 (†, by `bench-analyst`; the Space was last modified 2026-08-05, so absence is not a rejection).
- **Trajectories**: raw trajectories and screenshots are not in git (`.gitignore` keeps `results/*` ignored except three result directories; the only trajectory images in the tree are OSU's example schema, `git ls-tree` on the branch); run files are "private until reviewed" (`mind2web/README.md:139`).
- **Verdict**: the arithmetic is right; the number is not comparable to leaderboard figures (grader = the actor model, selection of failures only, mixed actors, no public evidence, nothing verified by OSU).

### (b) Can fuse-browser be run on Online-Mind2Web or another public benchmark?
- Online-Mind2Web measures `(driver model + prompt + tool server)`; we have no agent loop, so a run needs one on top of our MCP tools (a headless CLI host or an SDK loop). A fair label is "model X driving fuse-browser", never "fuse-browser scores N%". Flags used by FSB's driver were read from FSB code only and not checked against current host documentation: NOT VERIFIED.
- What it needs (per `bench-analyst`, fetched 2026-11-11, not re-fetched by me †): the gated dataset (CC-BY-4.0; pin the revision `eacad896a84dc5b65e29b0b06e4699ab0544d701`), start each task at the given site, a per-step screenshot trajectory in OSU's v2 format (needs a recording layer in front of our server), a WebJudge run on the action history without the final answer, optional human review (OSU quotes a price per trajectory). Live sites drift (task replacements in the repo history), so any result is dated.
- **Cost, formula only**: `cost_run = sum over tasks (in_tokens_t * price_in + out_tokens_t * price_out + image_tokens_t * price_in)` for the driver, plus `sum over judge calls (key-point call + one call per key screenshot + outcome call)` for WebJudge, plus the human-review price if used. Tokens per task are unknown until measured; prices must be taken from the provider on the day of the run. No estimate is given.
- Other public benchmarks, named as benchmarks only (access terms per `bench-analyst` †): WebVoyager (live, 15 sites), WebArena and VisualWebArena (self-hosted sandbox, programmatic checks, best reproducibility for a tool test), AssistantBench (live, answer matching), REAL Bench (web replicas), WebBench (live, adversarial, poor reproducibility), offline Mind2Web (element prediction, not a tool test), static main-content-extraction benchmarks (offline, deterministic, directly scores the fast path). Fit for a tool server, best to worst: extraction benchmarks, sandboxed WebArena family, replicas, live task benchmarks.

### (c) Smallest honest measurement we could publish
**Proposal A (recommended): offline main-content extraction quality of the fast path.**
- Measures precision, recall and F1 of the text `browser_fetch` returns against gold main-content annotations, per page type and overall, with N stated. Input: one pinned snapshot of a public extraction benchmark, served from a local static server so bytes are identical. Driver: none. Judge: the benchmark's own metric. Baselines only if run in the same script by the owner's choice.
- Step 0 (not yet done): confirm the dataset is downloadable and its licence allows publishing results. The proposal is conditional on that.
- Does NOT prove: anything about live sites, JavaScript-rendered pages, anti-bot behaviour, interaction, or agent task success.
- Honest README wording: "Main-content extraction quality of `browser_fetch` on <dataset> (<N> pages, snapshot <sha>): F1 = <measured>, precision = <measured>, recall = <measured>, fuse-browser <version>. Static HTML only; this says nothing about agent task success or live-site behaviour. Script and per-page outputs: <path>." (Numbers only from a real run.)

**Runner-up B: a labelled Online-Mind2Web pilot.** A seeded, stratified sample from the pinned revision (size chosen up front, IDs published), one fixed model and budget, one attempt per task, no retries, official WebJudge on the action history without the final answer, infrastructure failures counted as failures. Wording: "Pilot: <model id> driving fuse-browser <version> on <n> of 300 tasks (revision <sha>), judged by WebJudge (<backbone>), not verified by OSU: <k>/<n> passed. Not a leaderboard result." Does NOT prove leaderboard rank, tool quality independent of the model, or stability over time.

## 9. Not verified

Consolidated from the three notes and this pass.

- Runtime behaviour of everything: nothing was executed (ref drift, Chrome 136+ failure of `browser_connect`, snapshot truncation effects are code-derived).
- Whether a second launch of an already-running default-profile browser attaches or hands off to the existing process; whether other Chromium forks keep the debug port on the default dir.
- `docs/installation.md:67` end-to-end verification claim against a named Chromium-based browser: no test in the repo.
- FSB: exact tool count (72 is a static derivation; 19 direct registrations not re-counted); no `tools/list` was run; the stuck reason code `stuck_dom_hash` emission; how `selector:"e5"` becomes `params.ref` on the MCP path; whether dry-run covers native-host registration; whether any stealth/evasion code exists (grep list not read line by line); that the Google API key shapes in `extension/utils/capability-fetch.js` and the vendored tree are public web-client keys; whether FSB's CI ever drives a real Chrome; residual unprobed areas (`showcase/`, `skills/`, `server-py/`, `plugins/`).
- FSB catalog numbers (recipe-index counts, ready/blocked counts) and the "metadata only" contradiction in its vendored tree: analyst-cited, not re-opened (†).
- Benchmark: the OSU leaderboard and dataset facts (†, fetched by `bench-analyst`), the dataset gate terms, host-CLI flags for a headless run, licences of the extraction datasets and of one gym-style benchmark, FSB's difficulty split (from FSB's CSV), whether FSB submitted privately to OSU, model prices and tokens per task (deliberately not estimated).
- Our tests: content-level coverage of fetch-batch, serp-batch, shots-batch, handoff (name-only hits), `smartClick`, `wait_for`, `domSignature`; whether `tests/live/*` currently pass; exact case counts.
- Our `release.yml` content; `docs/configuration.md` coverage of `FUSE_VAULT_ALLOW_ANY_ORIGIN`.
- FSB matrix cells marked NOT VERIFIED in section 4 (rows 4, 5, 13, 14, 30, 44).

**Verification tally** (2026-11-11): the document carries 229 unique `path:line` tokens (264 counting comma-separated line lists). 27 daggers mark statements cited from the analyst notes and not re-opened; every other citation was opened or confirmed by a Read, `sed`/`awk` window or `grep -n` output showing the line. 14 citations were corrected: 9 against the analyst notes, listed here, and 5 after the challenger pass (handoff warning `handoff.ts:43`, vault cipher `src/vault/crypto.ts:46` with origin binding `resolve.ts:20-29`, denylist posture `upload-path-denylist.js:11-12`, trigger test count 10, force-stop span `agent-loop.js:462-474`). Claims were also corrected in substance: item 1 widened (other tools re-stamp refs), item 6 narrowed to Google Chrome and two more failure cases added, `domChanged` reachability through `browser_probe{actions}`, and "signature check inert" reworded to "never exercised in production". Challenger verdict (agent `analysis-challenger`): mechanism of item 1 CONFIRMED with scope understated (now fixed); item 6 inference holds only in the narrow case (now narrowed); items 2, 4, 5 unchanged; F1, F2, F4a, F4b, F6 to F9, U1, U3, U4 and the matrix rows it sampled were found correct; one of its objections (trigger name at `tool-definitions.cjs:1257`) was refuted by my grep (`:1258`). Corrections made against the analyst notes: (1) `detectStuck` starts at `agent-loop.js:302`, not 291; (2) manifest path is `extension/manifest.json`; (3) click dispatch is `actions.js:2512-2513`; (4) `fetchAndRender` at HEAD is `fetch-orchestrate.ts:37-54`; (5) the quote "not a leaderboard result" for `FINAL-REPORT.md:55` was not found and was replaced by the verified wording; (6) `METHODOLOGY.md` lives under `mind2web/results/benchmark-publication-20261022/`; (7) the budget truncation is `dom-analysis.js:2708-2718`; (8) the trigger progress mapper is `triggers.ts:97`; (9) the backup copy is `config-writer.ts:187-188`.

## 10. Scratch artefacts (for the owner to trash later; use `mv`, not `rm`)

- FSB main clone: `/private/tmp/claude-501/-Users-brunoazoulay-Labo-docker-lab-dev-local-Dev-ai-claude-code-fuse-browser--claude-worktrees-competitive-analysis-blocked-fetch-ec1ef9/d5fdf163-501c-4af8-bb09-2f55928de7c9/scratchpad/fsb`
- FSB benchmark-branch clone: `/private/tmp/claude-501/-Users-brunoazoulay-Labo-docker-lab-dev-local-Dev-ai-claude-code-fuse-browser--claude-worktrees-competitive-analysis-blocked-fetch-ec1ef9/d5fdf163-501c-4af8-bb09-2f55928de7c9/scratchpad/fsb-mind2web`
- Analyst notes: `/Users/brunoazoulay/Library/Application Support/Claude/side-session-notes/local_7c0bea2f-3e30-4b6b-9f8b-c7e0668fa2a9/` (`fuse-browser-us-map.md`, `fuse-browser-fsb-analysis.md`, `fuse-browser-benchmark.md`)
