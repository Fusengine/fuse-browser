# Changelog

## [0.1.65] - 2026-11-13

### Added

- **R1 safe actions** — element refs now carry stale and sensitive-action guards (a ref from an outdated snapshot or pointing at a sensitive control is refused instead of clicking the wrong element); new `browser_find` tool; `browser_snapshot` accepts `within` to scope the tree to a subtree.
- **R2 docs-native reading** — new `browser_map` tool (site map from sitemap/llms files, cross-origin `<loc>` dropped as `offOrigin`, robots-disallowed files not fetched unless advertised by `Sitemap:`); `browser_fetch` `focus`/`topK` return the most relevant BM25-ranked passages; site-served markdown is preferred when available.
- **R3 token diet** — output budget via `maxTokens`/`offset` with `nextOffset` for continuation, `outputMode: "file"` to offload large results to disk, MCP tool annotations on every tool, and presets.
- **R4 proof of UI change** — new `browser_verify` tool: expect assertions, evidence capture and a receipt.
- **Blocked-page verdict** — `browser_navigate` and extraction tools report a session `blocked` verdict instead of returning a challenge page as content.
- Tool count: 51 → 54 (`browser_find`, `browser_map`, `browser_verify`).

### Changed (default behaviour)

- `browser_snapshot` output now adds `generation`, `truncated` and `dropped`.
- `browser_fetch` prefers site-served markdown (`Accept: text/markdown`, `Link rel=alternate`) and reports which one it used in `source`.

## [0.1.64] - 2026-07-20

### Fixed

- **`browser_connect` killing the whole MCP server on a bad binary** — `spawnBrowser` (`src/engine/cdp-launch.ts`) spawned the browser child with no `child.on("error", ...)` handler; on `ENOENT` the `error` event fired on `process.nextTick`, past the caller's try/catch, so Node/Bun raised an unhandled `'error'` event and the process exited — killing the stdio MCP server and every tool for the session. `spawnBrowser` now returns a `Promise<SpawnResult>`, attaches the error handler BEFORE `unref()`, and resolves `{ok:false, error}` on a bad binary instead of crashing; `browser_connect` (`src/server/tools/connect.ts`) now awaits it and returns a structured `browser_spawn_failed` error instead of silently sitting through the full `waitForCdp` timeout.
- **`browser_connect` hardcoded macOS browser paths on every OS** — `KNOWN_BROWSERS` was 100% macOS `.app` paths with no `process.platform` branch, so `chrome` (the default) resolved to a macOS-only path on Linux/Windows. New `src/engine/browser-paths.ts#resolveBrowserBinary` resolves platform-aware candidates (darwin: `.app` paths; linux: common binary names via `PATH`; win32: standard install roots) and verifies the executable exists on disk before it is ever passed to `spawn`; when none resolves, `browser_connect` returns `browser_not_found` listing every candidate tried.
- **`browser_back`/`browser_forward` three failure modes** — `navigateHistory` (now `src/actions/navigate-history.ts`) had no try/catch (unlike its `pressKey`/`selectOption` siblings) and computed `ok` from Playwright's `goBack`/`goForward` return value. Same-document SPA history (`history.pushState` → back) resolves that value to `null` even though the navigation DID happen, previously reporting a false `ok:false`; a slow page that already changed URL before the internal timeout previously threw into `isError` instead of reporting a benign success. `ok` is now computed from the URL before vs. after the call: SPA history now reports `ok:true`; a load timeout with a changed URL reports `ok:true, warning:"load_timeout"`; genuinely no history reports `ok:false, reason:"no_history"`. A third case — `history.pushState` to the SAME url, then back — also resolved to `null` with an unchanged URL, misreported as `no_history` even though a real same-document navigation happened; a `framenavigated` listener (fires on History-API commits too, filtered to the main frame) now distinguishes "nothing happened" from "same-document navigation that landed on the same URL". Uses `waitUntil:"commit"` plus a short best-effort `waitForLoadState` instead of blocking the full 20s on `domcontentloaded`.
- **`browser_console` misleading `count:0` on the default engine** — Patchright (the default engine) deliberately disables Chromium's whole Console API upstream (an anti-detection patch), so `browser_console` always returned a bare `count:0` on that engine, indistinguishable from "no console messages". It now returns `{count:0, entries:[], unavailable:"console_disabled_on_patchright", hint:"reopen the session with engine:\"playwright\" to capture console output"}` when the buffer is empty AND the session's engine is `patchright`. The tool description now states this limitation explicitly.
- **`browser_pdf` `path` accepted any extension** — unlike `browser_screenshot`'s mime/extension gate, `browser_pdf` wrote to any caller-supplied `path` verbatim. It now rejects a non-`.pdf` extension with `path_extension_mismatch` (`src/server/tools/pdf-write.ts`), matching `browser_screenshot`'s contract.
- **`FUSE_CONFINE_WRITES` symlink-then-`..` escape (live-reproduced: bytes landed OUTSIDE the confined root)** — `canonicalizePath` (`src/lib/canonicalize-path.ts`) called `node:path#resolve(path)` first, which collapses `..` **lexically**, before the `lstatSync` component walk; `root/livedir/../outside2/x.png` (where `livedir` is a symlink OUT of the root, planted inside it) collapsed lexically to a path still inside the root while the kernel actually resolved `livedir/..` relative to the symlink's real target, landing outside. Canonicalization walks every path component left to right, resolving `..` against the already symlink-resolved prefix instead of collapsing it lexically first, and follows live or dangling symlinks at each step (capped at 40 hops, rejected as a cycle beyond that); a confined write additionally rejects any path containing a literal `..` segment outright, as a second, independent layer.
- **`FUSE_BLOCK_PRIVATE_NETS` trailing-dot hostname bypass** — `isPrivateHostname` compared the hostname verbatim, so `http://localhost./` (a valid FQDN root-label form) never matched the `"localhost"` literal check and fell through to the `dns.lookup` pre-flight; a failing/unresolvable lookup then allowed it through instead of blocking it. The hostname is now lowercased with a trailing dot stripped before comparison.

### Added (opt-in / opt-out, default behavior unchanged)

- **`FUSE_CONFINE_WRITES=<root>`** — opt-in confinement for caller-supplied write paths on `browser_screenshot`/`browser_pdf` `path`. Unset (default): unchanged, a `path` writes wherever the caller asks (the documented `/tmp/page.pdf` usage is preserved byte-identically). Set: every `path` must canonicalize under that root, else `path_outside_confinement` — rejects an absolute path outside the root, a `..` escape, and a symlinked parent (**existing or dangling**) that escapes the root. Canonicalization walks every path component left to right, resolving `..` against the already symlink-resolved prefix instead of collapsing it lexically first, and follows live or dangling symlinks at each step (capped at 40 hops, rejected as a cycle beyond that); a confined write additionally rejects any path containing a literal `..` segment outright, as a second, independent layer. The final path component is additionally opened with `O_NOFOLLOW` at write time (Linux/macOS; falls back to a plain write where unsupported, e.g. Windows), refusing outright if it is itself a symlink (dangling or live) — this closes the check-then-write TOCTOU window. `FUSE_CONFINE_WRITES=/` is now treated as "no effective confinement" instead of rejecting every write. New `src/lib/canonicalize-path.ts` + `src/lib/write-guard.ts`; deliberately NOT wired into `writeFileBytes` (`src/lib/fs.ts`), which also serves auto-generated artifacts under `outputDir`.
- **`FUSE_BLOCK_PRIVATE_NETS=1`** — opt-out SSRF guard for the HTTP fast-path (`browser_fetch`/`browser_fetch_batch`/`browser_crawl`, all funneled through `fetchFast`). Unset/any other value (default): unchanged, `http://127.0.0.1:3000` keeps working. `=1`: blocks loopback/link-local/RFC1918/`0.0.0.0/8`/`100.64.0.0/10` (CGNAT)/`192.0.0.0/24`/IPv6 `::1`/`fe80::/10`/`fc00::/7`/`::` (`blocked_private_network`). Every IP-literal form — bracketed IPv6 (`new URL().hostname` keeps the brackets, e.g. `"[::1]"`, previously unrecognized by `isIP` and silently allowed through), IPv4-mapped IPv6 (`::ffff:127.0.0.1`/`::ffff:7f00:1`), decimal/octal/hex-encoded IPv4, userinfo/case/short-form — is decided purely from the parsed address and never reaches DNS, so a DNS throw can never be misread as "allow" for a literal (the root cause of the previous bypass). A hostname literal is matched with a trailing dot stripped first, so `localhost.` cannot fall through to DNS and be allowed on a lookup failure. **Honest residual gaps**: (1) a real, non-literal hostname is checked via one `dns.lookup` pre-flight per call — a resolution separate from `impit`'s own internal connect, so DNS rebinding between the two is not caught; (2) `impit` exposes no per-redirect-hop hook or connected-IP accessor, only the initial URL and final `response.url` are checked, so a redirect chain transiting a blocked host mid-chain but landing on a public one is not caught; (3) IPv6 `fec0::/10`, `ff02::/16`, and NAT64 `64:ff9b::/96` are not blocked; (4) `O_NOFOLLOW` (write-confinement guard, not this one) is unavailable on Windows — see `src/net/private-net-guard.ts` and [configuration.md](./docs/configuration.md).

## [0.1.63] - 19-07-2026

### Fixed

- **`browser_fetch`/`browser_fetch_batch` `browserFallback` never escalating chrome-heavy SPAs** — `isThinShell` gated escalation on raw-HTML visible-text length (`< 600` chars); client-rendered pages with a lot of nav/footer chrome (e.g. `digitec.ch`, `fr.skoda.ch/apps/stock`) cleared that threshold while their real content still only existed after JS hydration, so the fast-path extraction silently returned `wordCount: 0` with `escalated: false`. `browserFallback` now also escalates on the extraction RESULT: when it comes back empty/near-empty (`wordCount < 15`, and not already fixed by hollow-extraction recovery) on HTML carrying JS-rendering markers (SPA mount point or heavy `<script>` count — `looksJsRendered`, `src/net/thin-shell.ts`), the fetch retries through a real browser render and re-extracts. Escalates at most once per fetch (loop guard). A further last-resort fallback (`recoverFromRawText`) covers the rare case where Defuddle's own content-scoring still finds nothing even on the real browser-rendered HTML (a known Defuddle limitation on dense, non-article layouts like an e-commerce grid homepage — no upstream config fixes it): the browser's own raw visible text is shipped instead of near-empty markdown, with a real word count and `extraction: "recovered"`, at no extra network/browser cost. New shared orchestrator (`src/agent/fetch-orchestrate.ts`) is now the single fetch-and-render path for both `browser_fetch` and `browser_fetch_batch`; server-rendered pages whose fast-path extraction already succeeds are unaffected (byte-identical, no new browser launch).
- **`browser_fetch` silent hollow extraction** — on some pages (e.g. SMF forum threads) Defuddle's own boilerplate-removal deleted the element wrapping every post body, silently returning near-empty markdown (`status:200`, no error, no signal). The markdown path now detects a "hollow" extraction (nonzero-but-low word count and a low prose-capture ratio against the page's real **non-link** prose) and recovers the raw page text instead — gated on an absolute floor of recoverable non-link prose (`MIN_PROSE_CHARS`, tuned against real pages incl. `github.com/login`'s 505-char chrome footprint, not just the saved SMF fixtures), so a genuinely sparse or link-heavy page (listing/index, login, 404) is never dumped as raw link/nav soup, regardless of its link density. A **zero**-word-count Defuddle result (no content container found at all — typical of a heavy client-rendered SPA whose real content never reaches the raw HTML) is never treated as "hollow": that failure mode belongs to `browserFallback`, not raw-text recovery.
- **`browser_fetch`/price extraction raw-CSS leak** — `htmlToText` (the raw-text fallback feeding both hollow-extraction recovery and price extraction) read `document.body.textContent`, which includes `<script>`/`<style>` tag source verbatim; a live CSS-in-JS SSR page injecting critical CSS into `<body>` leaked raw stylesheet source into the "recovered" text. `<script>`/`<style>` elements are now removed from the DOM before reading `textContent`.
- **`browser_act`/`browser_fill` "Malformed value" on `<input type="range">`** — Playwright's `locator.fill()` sets `.value` then round-trip-asserts the raw string against the post-clamp DOM value; a native range input snaps to `min`/`max`/`step`, so the assertion always threw. `smartFill`/`actByRef` now detect a range input (`isRangeInput`) and set it via the native value setter after clamping+snapping (`fillRange`, `src/actions/fill-range.ts`), dispatching `input`/`change` so framework listeners observe it. Plain text/label/placeholder fills are unaffected.
- **`browser_act`/`browser_fill` no-op on ARIA comboboxes** — a click-to-open combobox/listbox only renders its options after a click, so filling it directly silently no-oped. `smartFill`, `actByRef`, and `browser_act`'s `pick` kind now detect a combobox/listbox trigger (`isComboboxTrigger`, checked on the element or up to 2 ancestors) and open the trigger + click the matching option (`openComboboxAndPick`, `src/actions/combobox.ts`) instead.
- **`pick` throwing on human-readable targets** — `browser_act`'s `pick` kind and the `perform`/`pick` action resolved their target via a raw `page.locator(target)`, which throws `Unexpected token "?"` on text like `"Où allez-vous ?"`. `pick` now resolves through the same ordered selector→role→text→label strategies as `browser_click` (`resolveClickTarget`, extracted from `smart-click.ts` into `src/actions/resolve-click-target.ts`), falling back to the raw selector only when nothing else matches.
- **`detectChallenges` missed AWS WAF Bot Control** — `Challenges` now reports `awsWaf` (`chal_t=` query param or `window.awsWafCookieDomainList`), additive and optional in `challengesSchema`.
- **`browser_click`/`browser_act` failing on obscured or sticky elements** — a target that hit-tests as covered (booking.com's `obscured:true` destination field, skoda.ch's sticky combobox panel) or is otherwise unclickable now escalates through a bounded click ladder (`robustClick`, `src/actions/robust-click.ts`): plain click → scroll-into-view → dismiss a covering consent/cookie overlay → force-click → raw mouse click at coordinates, each rung attempted only after the previous one throws or times out. A normally-clickable element still resolves on rung 1, byte-identical to the previous plain `locator.click()`. Point-based hit-testing (`isTopElement`, `src/actions/hit-test.ts`) confirms the true top element before trusting a bypass-actionability click; a probe failure (no DOM access, detached element) always defaults to "clear" so it never blocks a real click.
- **Keyboard-stepped range/slider fills reporting false success** — `<input type=range>` and ARIA `role=slider` widgets that only re-render on a real trusted key event (not a synthetic setter+dispatch) now step via actual keyboard presses in bounded batches with a read-back after each batch (`stepSliderByKeyboard`, `src/actions/slider-keyboard.ts`), so a stalled widget reports an honest undershoot instead of a silent `ok:true` on an unset value. Also fixes a floating-point false negative where a clamped value (e.g. `0.30000000000000004`) read back as the equivalent parsed number (`0.3`) was reported as a mismatch.

### Added

- **`browser_fetch` `wordCount`/`extraction` signal** — every markdown result now reports the extractor's word count and which path produced the text (`"primary"` | `"recovered"`), both optional (unset on the `text`/non-HTML path).
- **`browser_fetch` `contentSelector`** — optional CSS selector to pin the main content container yourself, bypassing auto-detection, for pages where recovery still isn't the right call.
- **`browser_type`** (51st tool) — types text into whatever element currently has focus, no `ref`/`target` needed (drives `page.keyboard.type`, not a locator) — for elements a locator can't reach (e.g. a closed shadow-DOM input): `browser_click` the field first, then `browser_type`.

## [0.1.62] - 17-07-2026

### Fixed

- **`browser_snapshot` `prune:true` on modals** — an element is now kept if it is itself visible+focusable (`checkVisibility()`), even under an `aria-hidden` ancestor. Fixes SPA modals rendered under a global `aria-hidden` wrapper returning `count:0`. Only genuinely CSS-hidden or non-focusable decorative nodes under `aria-hidden` are still elided. Default (`prune` off) behavior is unchanged.

### Added

- **`browser_screenshot` `path` option** — optional param that writes the PNG/JPEG to disk and returns `path` in `structuredContent` instead of inline base64. Refuses multi-viewport captures (`path_multi_viewport_unsupported`) and mismatched extension/mime (`path_extension_mismatch`). Omitting `path` keeps the existing inline-base64 behavior.

## [0.1.61] - 17-07-2026

### Added

- **Structured tool output** — every one of the 50 MCP tools now declares a zod `outputSchema`, and `structuredContent` is emitted on all return paths, including `browser_screenshot`'s 4 branches (new `screenshot-result.ts` helper). Downstream clients can now consume typed results instead of parsing text.
- **`browser_snapshot` `prune` option** — opt-in (default `false`, behavior unchanged) param that elides hidden elements (`aria-hidden`, `display:none`, `visibility:hidden`) from the accessibility tree, shrinking snapshots on dense pages.

### Changed

- MCP text `content` is now compact (non-indented) JSON — `structuredContent` unchanged — cutting tokens on every tool response with no semantic difference.
- Dependencies bumped to latest: `typescript` 6 → 7, `patchright`/`playwright` 1.60 → 1.61.1, `defuddle` 0.18 → 0.19, `@biomejs/biome` 2.4 → 2.5.4, plus patch bumps for `impit`/`libphonenumber-js`/`linkedom`/`tsx`. `@types/node` → `^22` and `engines.node` → `">=22"` (Node 20 is EOL 2026-04-30).

### Verified

- New unit coverage: batched `outputSchema` parsing across tools, `prune`, and all 4 `browser_screenshot` branches. New integration coverage: `browser_snapshot`/`browser_act` `outputSchema` + `prune` on real Chromium.

## [0.1.60] - 01-07-2026

### Added

- **Encrypted credential vault + TOTP** (`browser_vault`, 49 → **50** tools) — store credentials locally (AES-256-GCM, key at `~/.fuse-browser/vault.key` `0600` or `FUSE_VAULT_KEY`) and fill them by reference: `browser_login { credentialRef }` and `browser_fill { credentialRef, field }` resolve username / password / TOTP **server-side**, so the secret never enters the MCP arguments, the tool result, or the model context. RFC 6238 TOTP is generated on the fly (zero dependencies, `node:crypto`).
- **Origin binding (anti-phishing)** — every credential is bound to one or more `scheme://host` origins; a fill is refused on any other origin (`FUSE_VAULT_ALLOW_ANY_ORIGIN=1` opts out). A prompt-injected login on a look-alike domain is rejected.
- **Snapshot redaction** — Tier 1 nulls `input[type=password]` values browser-side (with a `hasValue` flag); Tier 2 scrubs any vault-filled secret (password/TOTP) from `browser_snapshot` / `browser_act` output before it reaches the LLM.
- **CLI `vault set|list|rm|test`** — the only write path; secrets are read from stdin **without echo**, never from argv. `list` returns metadata only; `test` prints the current TOTP code.
- Verified: 22 new unit tests (crypto round-trip/tamper, RFC 6238 vectors, origin binding, fill wiring, list-only tool, redaction) + a real-Chromium integration test for Tier-1 masking.

## [0.1.59] - 13-06-2026

### Added

- **Two new interaction gestures** — `hover` (open menus/tooltips on mouse-over) and `drag` (drag&drop, `target`→`to`) as `browser_act` kinds and `run` step types. Closes the most common "the agent sees the link but the click fails because the hover menu never opened" gap.
- **Five new MCP tools** (44 → **49**): `browser_pdf` (page → PDF, headless Chromium), `browser_cookies` (get/set/clear — inject or export an auth token without a UI login), `browser_route` (mock/abort/unroute a network response — stub an API without a live backend), `browser_permissions` (grant/clear geolocation, clipboard, notifications…), `browser_clipboard` (read/write).
- **`browser_downloads` now reads file content** — pass `read` (index or filename) + `encoding` (utf8/base64) to get the downloaded bytes, not just the path (5 MB cap).
- All verified live: hover reveal, drag, cookies round-trip, network mock (`fulfill`), PDF bytes, clipboard write/read.

## [0.1.58] - 11-06-2026

### Added

- **Complete auth persistence** — named `profile` / `storageStatePath` now persist **cookies + localStorage + IndexedDB** (`storageState({ indexedDB: true })`), so sessions that store their auth token in IndexedDB (modern SPAs, Firebase Auth, …) reopen already logged in. The state is saved **at login time** (right after `browser_login` succeeds) and on session close — auth is no longer lost if a session crashes before a clean teardown. Works identically headless and headed on Chromium. `userDataDir` (full persistent Chromium profile) is unchanged and already covers everything natively. Verified live (IndexedDB token written, then replayed after reopen).

## [0.1.57] - 11-06-2026

### Added

- **File upload** — new `upload` action (Playwright `setInputFiles`) for `browser_act` (`kind:"upload"`) and `run` step plans (`{"type":"upload","target":"input[type=file]","files":"/path/cv.pdf"}`). `files` accepts one path, a comma-separated string, or an array. Targets by `ref` or selector. Enables forms that need an attachment (job applications, avatars, CSV imports). Verified live (the-internet upload form). No new MCP tool — tool count stays 44.

## [0.1.56] - 11-06-2026

### Docs

- Republish so npm carries the up-to-date README/docs (the 0.1.55 publish captured the pre-sync README that still said "37 MCP tools"). Surface is now correctly documented as **44 MCP tools** and **15 CLI commands**. No code change.

## [0.1.55] - 11-06-2026

### Added

- **Layout-agnostic price extraction** — captures a currency whether it sits before or after the amount (`CHF 6.90`, `6.90 CHF`, `10 €`, `350 kr`), even when the symbol and number land on separate DOM lines (`CHF\n6.90`, the digitec case that previously yielded zero prices). Handles non-breaking/narrow spaces and CH (`1'234.56`) / EU (`1.234,56`) decimal formats. Each price now carries a short `context` label of its surrounding line.
- **Structured per-card extraction** — `browser_products` MCP tool + `fuse-browser products <url>` CLI return `{title, price, currency, url}` grouped by repeated product card, plus an `extract_schema` container mode that iterates card-by-card.
- **New MCP tools** — `browser_tabs` (OAuth popups/multi-tab), `browser_dialog` + `browser_downloads`, `browser_console` + `browser_network`, `browser_autoscroll` (infinite-scroll until idle). Screenshots exposed as MCP resources (`screenshot://{sessionId}/last`).
- **CLI parity** — six one-shot page commands: `run` (multi-step plans via `--steps`/`--steps-file`/stdin), `products`, `extract`, `snapshot`, `screenshot`, `inspect`. `--help` now lists all 15 commands.
- **Config** — `FUSE_CAPS` tool-group filtering, named auth `profile`, `blockResources`, MCP progress notifications on batch tools, configurable network-log buffer (`FUSE_NETLOG_MAX`) that pins the main document.
- **Stealth** — self-healing selectors (role/text/re-snapshot fallback) and a weekly anti-bot benchmark workflow.

### Fixed

- **Booking currency** — `prepareBookingCurrency` no longer does an intermediate homepage navigation that landed on the consent wall and blanked the target page; cookies + the in-page picker apply the currency without it.
- **Probe robustness** — resilient load-state settle + a single re-extraction when the first text/title come back empty, fixing blank reports on heavy/consent-gated pages.
- **Tabs network capture** — a tab opened with a URL now wires its network log before navigating, so its document and subresources are captured.
- **mainText** — strips nav/aside/search/filter sub-trees so filter sidebars (e.g. Booking's budget slider) no longer leak into extracted prices, while product grids still yield every card.

### Tooling

- Biome linter wired into CI; full suite green (292 unit, 20 integration on real Chromium).

## [0.1.54] - 08-06-2026

### Fixed

- fix(engine): **default to the managed Chromium build, not system Chrome** — the 0.1.50 channel cascade preferred `channel:chrome` (the installed Google Chrome). On some Linux servers that system binary **launches fine but has no network route** → every navigation fails with `ERR_INTERNET_DISCONNECTED`, and the cascade can't recover (it only falls through on a *missing-binary* launch error, not a runtime nav failure — so it served a network-dead browser). Reproduced on a real host: `channel:chrome` fails on every request while the managed **Chrome-for-Testing** (`channel:chromium`) and the bundled shell both return 200. **Default cascade is now `[chromium, undefined]`**: the Playwright-managed full Chromium (new headless, **no `HeadlessChrome` in sec-ch-ua, real WebGL** — same high-signal stealth, the brand just reads `Chromium` instead of `Google Chrome`) then the bundled shell. System `chrome`/`msedge*` are **opt-in** via an explicit `channel`. `channel:"chromium"` is now selectable (type + MCP schema) and the `channel` param documents the tradeoff so agents pick correctly (omit = safe default).

## [0.1.53] - 08-06-2026

### Added

- feat(actions): **human Bézier cursor motion before clicks** (`humanMode`) — behavioral anti-bots (ML on mouse velocity / curvature / timing) flag the instant teleport-to-element that `locator.click` produces. In `humanMode`, `smartClick` now moves the cursor to the target along a **cubic Bézier** path (ease-in-out, random control points, per-step jitter, variable timing) before hovering/clicking — a human reach, not a straight teleport. New `human-mouse` module: pure `cubicBezier` + `easeInOutCubic` (unit-tested) + `humanMoveTo` (steps `page.mouse.move` with sleeps; no-op when the element has no box). Only active when `humanMode=true`; the default click path is unchanged.

## [0.1.52] - 08-06-2026

### Added

- feat(shots): **wheel-driven filmstrip for scroll-jacked sites** — `fullPage` can only capture the hero of a scroll-jacked page (the document is one viewport tall and the scroll is faked in JS/canvas). When `scrollJacked` is detected, `browser_screenshot` / `browser_shots_batch` / `browser_site_shots` now drive the site's **own** scroll with real `wheel` events and save **N viewport frames** (`frame0..N`, default 6) instead of one misleading hero: real sections on smooth-scroll sites (Locomotive/Lenis/GSAP), animation states on pure-WebGL ones — no fragile stitching/montage. `Shot` gains an optional `frame` index. Verified live: design.studio yields 6 frames (`scrollJacked=true`), instrument.com stays a single full-page shot (`scrollJacked=false`).

## [0.1.51] - 08-06-2026

### Fixed

- fix(shots): **robust full-page settle + scroll-jack detection** — full-page screenshots could truncate or leave blank gaps on tall sites (lazy / scroll-reveal content not yet loaded) and silently captured **only the hero** on scroll-jacked sites (where the document is one viewport tall and the scroll is faked in JS/canvas). `settleForCapture` now auto-scrolls against `max(body, documentElement).scrollHeight` with **re-measure** (handles growing/lazy pages and the case where `body` under-reports height), waits for a **second `networkidle` plus `document.fonts.ready` and pending images** after the scroll, then returns to the top. New `detectScrollJack`: when the page is ~one viewport tall (so `fullPage` can only capture the hero), shots are flagged **`scrollJacked: true`** instead of returning a misleading partial as if complete. Verified live: instrument.com captures full-page (`scrollJacked=false`); design.studio is correctly flagged (`scrollJacked=true`). Affects `browser_screenshot`, `browser_shots_batch`, `browser_site_shots`, and visual-diff capture.

## [0.1.50] - 08-06-2026

### Changed

- feat(engine): **coherent stealth fingerprint** — the realistic profile no longer injects a static user-agent (`Windows / Chrome 125`), which desynced from the real browser's `sec-ch-ua`, `navigator.userAgentData` and WebGL (a detectable lie that 2026 anti-bots key on). Three coordinated changes: **(1)** a **channel cascade** `chrome → chromium → bundled` (with safe missing-binary fallback) launches a full Chrome/Chromium **new-headless** build instead of the `chromium-headless-shell` — so `sec-ch-ua` reports real **Google Chrome** (no `HeadlessChrome` brand) and **WebGL is real** (the shell exposed none); **(2)** the static UA override is replaced by a **coherent UA** derived from the real browser with only the `HeadlessChrome` token stripped — real platform & version preserved (no spoof), cached per browser; **(3)** the context **viewport rotates** over realistic desktop resolutions instead of a fixed `1365×900` fleet fingerprint. Verified live: `navigator.userAgent` and the `User-Agent` header become `Chrome/148` (no `HeadlessChrome`), `sec-ch-ua` = `Google Chrome 148`, real WebGL, coherent UA ↔ Client Hints. Scope: ephemeral + pooled Chromium paths; persistent (`userDataDir`) and CDP attach are unchanged. Refactor: extracted `newConfiguredContext` into `engine/configured-context`.

## [0.1.49] - 08-06-2026

### Fixed

- fix(engine): **force-kill the pooled browser on a stalled close** — no more zombie Chromium. `BrowserPool` now launches its warm browser via `launchServer()` + `connect()` and holds the `BrowserServer`, so `close()` can SIGKILL the whole process group when a graceful close stalls. On a loaded host a stalled `close()` previously left orphaned Chromium processes that piled up over long uptimes and slowed new launches (the "cercle vicieux" of a long-running box). New `closeServerHardened` races the graceful close against an 8 s timeout, then `server.kill()`s (idempotent, no unhandled rejection). Stealth verified **identical** — Patchright patches client-side, so a connected browser is byte-identical to a launched one (`navigator.webdriver=false`, sannysoft rows unchanged). Scope is limited to the batch pool (`browser_collect_batch` / `browser_shots_batch` / `browser_site_shots`); single-shot, sessions, CDP and persistent paths are unchanged. Proven live: 4-URL batch leaves **0** net Chromium, and the forced-kill branch reaps the process group. +4 unit tests lock the contract.

## [0.1.48] - 08-06-2026

### Changed

- perf(engine): **warm browser pool** for batch tools. `browser_shots_batch`, `browser_collect_batch` and `browser_site_shots` no longer cold-launch a browser per URL — a new `BrowserPool` launches **one** browser and hands each task a fresh isolated context (Patchright stealth is browser-level, so every context inherits it). On a 20-URL batch that's ~19 browser cold-starts saved. Falls back to a full per-task open for non-poolable configs (persistent `userDataDir`, CDP attach), so behaviour is unchanged there. Refactor: extracted `newConfiguredContext` (engine/launch) and page-level `shotsOnPage` / `collectOnPage` so the pool can drive the work; the single-URL `captureShots` / `runCollect` one-shots are unchanged.

## [0.1.47] - 08-06-2026

### Added

- feat(site): **`browser_site_shots`** (MCP) / **`site-shots <url>`** (CLI) — full-site snapshot in one flow: crawl a site (HTTP fast-path, same-origin, robots-honored) then screenshot each discovered page. Returns **both** the page content (markdown — the crawl's extraction is surfaced, not discarded) **and** responsive full-page PNGs per page. For visual QA/audit of a whole site, design review, or a regression baseline. Heavy (one browser per page) so `maxPages` stays modest (25) and shots run at low concurrency (2). Composes the existing `crawl` + `captureShotsBatch`; 37th tool.

## [0.1.46] - 08-06-2026

### Added

- feat(collect): **`browser_collect_batch`** (MCP) / **`collect-batch <url...>`** (CLI) — the collect side of **crawl + collect**. Exhausts the infinite-scroll / paginated list of many listing URLs in parallel: one real browser per URL, drains each page (scroll + dedup by row key), returns all items. Low concurrency (default 2), jittered per-host throttle, per-URL error isolation. Pair with `browser_crawl` to discover category/search pages, then drain each here → ratisser a whole classifieds/listing site. New one-shot `runCollect(config, url, opts)` (browser counterpart of a single fetch) reused by the batch. 36th tool.

## [0.1.45] - 08-06-2026

### Added

- feat(crawl): **per-host throttle with jitter** — `browser_crawl` spaces requests to the same host by `throttleMs` (MCP) / `--throttle-ms` (CLI), default **250 ms** (`0` disables). The delay is **jittered per request** (uniform in `[base/2, base*1.5]`, via new `jitterMs`) — a fixed gap is a bot fingerprint, so the pacing oscillates to look human. Keeps big crawls (50-100 URLs) polite and avoids "unusual traffic"/rate-limit blocks.

### Changed

- fix(throttle): `throttleHost` now **reserves the next slot synchronously** (before awaiting), so N concurrent callers on the same host are correctly spaced by `minGapMs` instead of bursting together (the prior check-then-set-after-sleep let concurrent callers read the same timestamp and fire at once). Sequential callers behave identically. Benefits both the crawl and the browser probe path.

## [0.1.44] - 08-06-2026

### Added

- feat(shots): **`browser_shots_batch`** (MCP) / **`shots-batch <url...>`** (CLI) — full-page responsive screenshots for many URLs in parallel, the visual counterpart of `browser_fetch_batch`. Each URL is rendered in a real browser at each viewport (default `mobile,desktop`) and saved as a PNG; concurrency is **low by default (2)** since every page is a full Chromium instance. Returns saved paths per URL; a failed URL becomes `{ url, error }` without aborting the batch. 35th tool.

### Changed

- refactor(viewport): `parseViewports` (CSV → viewport inputs) moved to `engine/viewport.ts` and shared by the `shots` and `shots-batch` CLIs (removes duplication).

## [0.1.43] - 08-06-2026

### Added

- feat(crawl): **`browser_crawl`** (MCP) / **`crawl <url>`** (CLI) — bounded same-origin crawl from a seed URL via the HTTP fast-path. Breadth-first, fetching each depth level in parallel, returning clean markdown per page (with its `depth`). Reuses the fast-path + per-page SPA `browserFallback` + the bounded-concurrency map. Conservative defaults: `maxPages` 25, `maxDepth` 2, `concurrency` 5, `sameOrigin` true, and **`respectRobots` true** (robots.txt honored by default; opt out with `respectRobots:false` / `--no-robots`). URLs are de-duplicated at enqueue time and hash fragments are stripped. New `net/extract-links.ts` (same-origin link extraction). 34th tool.

## [0.1.42] - 08-06-2026

### Added

- feat(cli): both bins handle `--help`/`-h` and `--version`/`-v` **before** strict arg parsing (and, for `browser-mcp`, before the stdio transport binds — printing to stdout after connect would corrupt the protocol). Unknown top-level flags now produce a concise `error: Unknown option '…'` (exit 1) instead of a raw `ERR_PARSE_ARGS_UNKNOWN_OPTION` stack trace. Logic lives in a shared `bin/cli-meta.ts` helper (`handleMetaFlags`, `parseArgsOrExit`, `firstFlag`).

## [0.1.41] - 08-06-2026

### Added

- feat(fetch): **`browser_fetch_batch`** (MCP) / **`fetch-batch <url...>`** (CLI) — fetch many URLs in parallel via the HTTP fast-path, bounded concurrency (default 8). Each URL keeps full `browser_fetch` semantics (markdown for HTML, JSON/plain-text verbatim, per-URL `browserFallback` SPA escalation). Results are returned in input order; a failed URL becomes `{ url, error }` and never aborts the batch. Lets an agent retrieve N pages in one call instead of N round-trips. CLI flag `--concurrency`.

### Changed

- refactor(fetch): extracted the shared body→`{ format, text, escalated }` rendering into `agent/fetch-render.ts` (`renderFetch`), now the single source used by `browser_fetch`, the `fetch` CLI, and `browser_fetch_batch` (removes the prior duplication). New `net/concurrent.ts` (`mapConcurrent`) is a dependency-free, order-preserving, error-isolating bounded-concurrency map.

## [0.1.40] - 08-06-2026

### Added

- feat(fetch): **`browserFallback`** (MCP) / **`--browser-fallback`** (CLI) on `browser_fetch` — opt-in escalation so a single call can "see everything". When the HTTP fast-path returns an unrendered client-side shell (SPA/CSR), it transparently re-renders the page in a real browser (Patchright, reusing the `browser_probe` pipeline) and returns the rendered markdown. Off by default — the fast-path stays fast and predictable. Results carry `escalated: true` when a browser was used. Detection is conservative (thin **visible** text + SPA mount markers / heavy scripting), so server-rendered pages (Next.js SSG/SSR, Nuxt, Astro, Remix, VitePress…) never pay the browser cost.
- feat(cli): the `fetch` subcommand now accepts `--text` and `--format <markdown|text>` (previously read by the handler but not registered, so unusable).

### Changed

- perf(fetch): the fast-path no longer parses HTML it doesn't need. `FastResponse.text` is now **lazy + memoized** — the linkedom text pass runs only when a consumer reads it, so the common markdown path (and the robots.txt path) skips a full parse.
- perf(serialize): `htmlToMarkdown` caps its input at `DEFAULT_MAX_INPUT_CHARS` (2 MB) before parsing — bounds parse cost on pathological pages.
- perf(fetch): the body download is **streamed with a 10 MB hard cap** (`readCappedText`), cancelling early instead of buffering unbounded payloads; the cap truncates on a clean UTF-8 boundary (no trailing `U+FFFD`).
- feat(fetch): requests send `Accept: text/markdown, text/html, …` — servers that serve native markdown (e.g. nuxt.com) are returned verbatim, skipping HTML→markdown entirely.

### Fixed

- fix(fetch): `htmlToText` no longer throws (and no longer returns empty) on **fragment / rootless** pages with no `<html>`/`<body>` — it falls back to a tag strip of the raw HTML, so visible text is always recovered.
- fix(fetch): thin-shell detection ignores inline `<script>` source (which `textContent` wrongly counts as text), so a bare SPA shell is correctly identified.

## [0.1.39] - 07-06-2026

### Fixed

- fix(fetch): the HTTP fast-path no longer mangles **non-HTML** responses. `fetchFast` now reads the `content-type` and, for anything that is not `text/html` / `application/xhtml+xml` (JSON APIs, `text/plain`, …), returns the body **verbatim** instead of running it through the linkedom HTML parser and Defuddle markdown pipeline. `browser_fetch` / the `fetch` CLI force raw `text` output for these bodies. As a bonus, `browser_fetch` is now usable as a fast **JSON-API** fetcher. An absent `content-type` is still treated as HTML (preserves prior behavior); the HTML happy path is unchanged. MIME matching uses an exact allowlist (not `includes("html")`) so payloads like `application/vnd.github.html+json` are correctly treated as non-HTML.

## [0.1.38] - 04-06-2026

### Added

- feat(live): **human live view** — `browser_live_view` / `browser_live_view_stop` (31st/32nd tools). A CDP screencast (`Page.startScreencast`, ack-per-frame, re-issued on navigation) streams JPEG frames over an ephemeral, token-gated `127.0.0.1` Server-Sent-Events server to a self-contained `<canvas>`/`<img>` viewer that auto-opens in the OS browser. Watch any session in real time — **works headless too**. Read-only; auto-closes on page close or stop; zero new dependencies. `broadcast()` is hardened against viewer mid-stream disconnects (no process crash on EPIPE/ECONNRESET).

## [0.1.37] - 04-06-2026

### Added

- feat(observability): **`browser_metrics`** tool (30th) — process-global scraping snapshot: probes ok/failed, avg/min/max probe duration, circuit-breaker/queue/budget rejects, live probe-queue depth (`running`/`admitted`/`waiting`), RSS and uptime. `reset:true` zeroes the counters after reading (job-scoped). Zero-dependency in-memory counters; only browser probes are counted (the HTTP fast-path is not), and resilience rejections are tracked distinctly from probe failures. Browser recycling was deemed N/A — the probe model is already ephemeral (fresh browser per probe), so there is no cross-probe memory growth to bound.

## [0.1.36] - 04-06-2026

### Added

- feat(resilience): opt-in **bounded probe queue + per-process budget** (`probeQueue` option, off by default). Caps concurrent **browser** probes (excess callers wait FIFO for a slot); a full waiting list fails fast with `Probe queue full …` (transient), and an optional `maxProbes` lifetime budget rejects further probes with `Probe budget exhausted …` (terminal). Only the browser path is gated — the HTTP fast-path bypasses the queue. Wired into `browser_probe`/`browser_probe_html`. Single-process, in-memory, zero-dependency. Defaults: 2 concurrent / 8 queued / unlimited budget.

## [0.1.35] - 04-06-2026

### Added

- feat(resilience): opt-in per-host **circuit breaker** for mass scraping (`circuitBreaker` option, off by default). After N consecutive thrown navigation failures on an origin, the circuit opens and further attempts fail fast for a cooldown (exponential reopen backoff, capped) instead of burning browser time on a dead host; a half-open trial after the cooldown closes on success or reopens. Wired into `browser_probe` (returns `Circuit open …`) and `browser_serp_batch` (per-query error row). HTTP 4xx/5xx/429 are returned responses, not throws, so they do not trip the breaker (429 stays a retry/`Retry-After` concern). Defaults: 5 failures / 30s / 10min cap.

## [0.1.34] - 04-06-2026

### Added

- feat(resilience): automatic crash recovery for live sessions. When a page crashes (or is closed) while its browser context is still alive, the next tool call transparently recreates the page in the **same context** — keeping cookies, `storageState` and auth — re-attaches listeners, re-applies HAR replay and re-navigates to the last URL. A lost browser/context evicts the session with a clear `session_lost: reopen with browser_open` error instead of an opaque exception. Default behavior unchanged on the happy path; no new tool or option.

## [0.1.33] - 04-06-2026

### Added

- feat(design): `browser_inspect({ sessionId, ref })` returns the computed styles, box model (content/padding/margin/border), typography, and resolved colors for any element by `ref`, plus the **WCAG 2.x contrast ratio** (text vs. effective background walked up the ancestor chain) with AA/AAA pass flags. Pure-Node contrast math; design-audit friendly. 29th MCP tool.

## [0.1.32] - 04-06-2026

### Added

- feat(vision): opt-in `annotate:true` on `browser_act` (re-marked Set-of-Marks frame of the new state, anti-drift) and `browser_screenshot` (SoM viewport frame). Default off (no behavior change).

## [0.1.31] - 04-06-2026

### Added

- feat(vision): opt-in `browser_snapshot({ annotate: true })` returns a Set-of-Marks JPEG — numbered badges (= each element's `ref`) drawn over the page — plus the refMap, so vision models (Claude/GPT-4o/Gemini) see the page and target by `ref`. Default off (no behavior change). Main-frame, viewport-only.

## [0.1.30] - 03-06-2026

### Added

- feat(probe): opt-in `fastPathFirst` cascade — with `extractContacts`, tries HTTP-only extraction first and skips the browser when the contact card is complete (email AND phone), escalating to a full browser probe + `contactCrawl` only when incomplete. Result carries `fastPath: true`. Default false (no behavior change). ~0.6s vs ~7s on static/SSR sites.

## [0.1.29] - 03-06-2026

### Added

- feat(fetch): `browser_fetch` and the `fetch` CLI accept `extractContacts` — structured contacts (emails, phones E.164, contact form) are extracted from the fetched HTML with no browser launch (~7s → ~0.6s on static/SSR sites). New `contactFilter` ("strict" default | "off") drops template placeholder emails and orders same-domain first; also exposed on `browser_probe`. Bounded haystack guards against ReDoS on hostile HTML.

## [0.1.28] - 03-06-2026

### Added

- feat(legal): opt-in `respectRobots` honors the origin's `robots.txt` (RFC 9309 matcher) — disallowed primary URL throws `RobotsDisallowed`, disallowed crawl links are skipped. Default false (blocks nothing). Added `LEGAL.md` (operator responsibility, GDPR/nLPD, opt-in levers) and GDPR hints on the contact MCP fields.

## [0.1.27] - 03-06-2026

### Added

- feat(mcp): `browser_probe` / `browser_probe_html` now accept `extractContacts`, `contactCrawl`, and the CDP-remote options `cdpHeaders` / `cdpCloseOnDone` / `cdpTimeoutMs`. `report.contacts` is included in the compact result. All optional — no behavior change when absent. Docs/tests use RFC 2606 example domains (no real PII).

## [0.1.26] - 03-06-2026

### Added

- feat(contacts): opt-in `probe({ extractContacts: true })` populates `report.contacts` (emails, phones in E.164 via libphonenumber-js, contact-form detection) from 3 deduped sources — mailto/tel hrefs, text+HTML regex, and deobfuscation ([at]/[dot], HTML entities, bounded bare spans). Opt-in `contactCrawl` follows same-domain contact/kontakt/impressum links (bounded) when the page has no email. No behavior change without the flags. See docs/recipes/prospection.md.

## [0.1.25] - 03-06-2026

### Fixed

- fix(probe): `BrowserAgent.probe()` now honors `cdpEndpoint` (attaches over CDP via `selectEngineForConfig`) and tears down via `teardownOpened`, so it never closes a user's attached browser. Previously it always launched a fresh browser and ignored `cdpEndpoint`. No behavior change when `cdpEndpoint` is unset.

## [0.1.24] - 03-06-2026

### Added

- feat(cdp): remote Browserless attach over `ws/wss` with `cdpHeaders` (or inline `?token=`) auth and configurable `cdpTimeoutMs`. Remote endpoints get a fresh identity-configured context closed on teardown (`cdpCloseOnDone`, default true for `ws/wss`); local CDP attach reuses the user's context and is never closed.
- feat(cdp): stealth parity on the CDP path — `addInitScript` re-injects `navigator.webdriver`/`languages` masks (a CDP-reached browser is already running and cannot be patched by Patchright). Launch path unchanged.

## [0.1.23] - 03-06-2026

### Added

- feat(fetch): `browser_fetch` and `browser_extract` (and the fetch CLI) now return clean LLM-ready markdown (main content + YAML frontmatter) by default, via a shared `defuddle`-based serialization layer. A `format: "markdown" | "text"` option preserves the previous raw-text behaviour.
