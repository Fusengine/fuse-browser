# Blocked fast-path responses — live check, 2026-11-11

Build under test: the **worktree** (branch `claude/competitive-analysis-blocked-fetch-ec1ef9`, base 0.1.64 + the
blocked-response fix), driven through the real MCP tools of `createServer()` over an in-memory client — not the
installed MCP server. Target: `https://ai.miraheze.org/wiki/Agnostic_AI` (Cloudflare managed challenge for plain
HTTP clients). Negative control: `https://example.com/`. Every browser session opened by the script was closed
(`browser_close`; no leftover browser process afterwards). No CAPTCHA was solved and none of the `captcha` /
`solveCaptcha` options were used.

## Results

| # | Time (UTC) | Tool + exact params | status | `blocked` | `blockedBy` | `hint` | wordCount / bytes | `escalated` |
|---|---|---|---|---|---|---|---|---|
| a | 14:41:52Z | `browser_fetch {url}` | 403 | **true** | `cloudflare` | "Blocked by an anti-bot interstitial (cloudflare) — this is not the page content. Retry with browserFallback:true, or read it in a session: browser_open → browser_navigate → browser_extract (if the default session is also challenged, use browser_open {headless:false, engine:"playwright", channel:"chrome"}); if the live page shows a human step (CAPTCHA/turnstile), call browser_handoff." | 0 / 224 | false |
| b | 14:41:52Z (render ≈ 6 s) | `browser_fetch {url, browserFallback:true}` | 403 (fast-path status) | **true** | `cloudflare` | "Still blocked after a real-browser render (cloudflare). Read it in a session: browser_open {headless:false, engine:"playwright", channel:"chrome"} → browser_navigate → browser_extract; if the live page shows a human step (CAPTCHA/turnstile), call browser_handoff so a person completes it." | 9 / 278 (title "Un instant…") | true |
| c | 14:45:05Z (first run 14:42:04Z, same outcome) | `browser_open {}` → `browser_navigate {sessionId, url, waitMs:8000}` → `browser_extract {kind:"text"}` (+ `kind:"challenges"`) | n/a (navigate returns no status) | true (same detector on `page.content()`) | `cloudflare` | — (session tools carry no `hint`; the fast-path hint above points here) | 33 / 278 (title "Un instant…"); `challenges.turnstile: true` | n/a |
| d | 14:43:56Z (earlier runs 14:42:08Z with no wait and 14:42:32Z with `waitMs:10000`, same outcome) | `browser_open {headless:false, engine:"playwright", channel:"chrome"}` → `browser_navigate {sessionId, url, waitMs:8000}` → `browser_extract {kind:"text"}` (+ `kind:"challenges"`) | n/a | true (same detector on `page.content()`) | `cloudflare` | — | 33 / 278 (title "Un instant…"); `challenges.turnstile: true`; screenshot shows a Cloudflare "Verify you are human" checkbox | n/a |
| e (control) | 14:41:58Z | `browser_fetch {url:"https://example.com/"}` | 200 | not set | not set | not set | 25 / 242 | false |

Row c and d `blocked` is computed by running the same `detectBlock` on the session's `page.content()`; the session
tools themselves do not return a `blocked` field.

Rows a–e were measured on the first implementation, before the first challenger review. Rows a′/e′ below were
measured at 15:00Z on the code as of that time (weak-signal quorum 3, 1 MiB scan cap, and a broad "any thin render
inherits the fast-path verdict" rule), NOT on the final code. Three changes came after 15:00Z, from the later
challenger fixes: the HTML markers were tightened to executable context (`_cf_chl_opt = {` assignment,
`src="…captcha-delivery.com…"`); the inheritance rule was narrowed to blocks only response headers can identify
(`isHeaderOnlyBlock`, today AWS WAF); and the `x-datadome` presence header was excluded from the weak quorum
(`presenceOnly`), with the "verify you are human" phrase no longer counted twice. The run on the final code is in
`docs/blocked-fast-path-real-conditions-2026-11-11.md` (written by `e2e-runner`); this document makes no claim
about it. Rows a′ and e′ (no browser, 2 requests, same script as a–e):

| # | Time (UTC) | Tool + exact params | status | `blocked` | `blockedBy` | `hint` | wordCount / bytes | `escalated` |
|---|---|---|---|---|---|---|---|---|
| a′ | 15:00:03Z | `browser_fetch {url:"https://ai.miraheze.org/wiki/Agnostic_AI"}` | 403 | **true** | `cloudflare` | identical to row a | 0 / 224 | false |
| e′ (control) | 15:00:03Z | `browser_fetch {url:"https://example.com/"}` | 200 | not set | not set | not set | 25 / 242 | false |

Rows b, c and d were not re-run after the first implementation (they need a browser and more requests to the site).
The captured real responses are replayed against the current code by the unit suite
(`tests/unit/fetch-blocked.test.ts`, `tests/unit/block-detect.test.ts`) — fixtures, not live measurements.

## Reading the table

- **Before the fix** row a was `{status:403, title "Checking your connection...", wordCount:0, extraction:"primary",
  escalated:false}` — a blocked response returned as an ordinary result. It is now `blocked:true` with a hint (row a).
- **`browserFallback:true` does not turn this particular block into content** (row b): the headless browser
  renders the same Cloudflare challenge (French title "Un instant…"), and the result stays `blocked:true`
  with `escalated:true` and a hint that points at a headed session and `browser_handoff`.
- **Human step.** In rows c and d the live page shows a Cloudflare Turnstile checkbox (`challenges.turnstile:true`
  and the screenshot). It was **not** solved. This is the case where `browser_handoff` is the hint: a person
  completes the step in the headed session (`browser_open {headless:false}`), then the agent resumes.
- **Negative control** (row e): a normal public page reports no `blocked` field at all (and the result has exactly
  the pre-fix keys).

## Discrepancy with the earlier manual measurement (not resolved)

Earlier the same day, a plain headed session (`browser_open {headless:false, engine:"playwright", channel:"chrome"}`
→ `browser_navigate` → `browser_extract`) read this page in full (48.8 KB, no human step). This check did **not**
reproduce that: the same headed-Chrome parameters hit the Turnstile checkbox on every run (three runs, including
one with `waitMs:10000`). Cloudflare decides per request and per client reputation, and this check issued 9 requests
to the site between 14:31Z and 14:46Z (one fixture-capture GET, the fast-path GETs of rows a and b, one headless
render for b, two headless session loads for c, three headed loads for d); the cause of the difference was **not** established and the claim "a headed Chrome session always passes
this challenge" is therefore **not** supported by this evidence. What is supported: the fast path now says
`blocked`, and the routing it recommends (`browserFallback`, then a session, then `browser_handoff` when a human step
shows) is the one that applies in each observed state.

## Real blocked responses used as fixtures (one plain GET each, 2026-11-11, `tests/fixtures/blocked/`)

| Fixture | Origin / vendor | Status | Distinguishing signals |
|---|---|---|---|
| `cloudflare-managed-miraheze` | ai.miraheze.org / Cloudflare managed challenge | 403 | `cf-mitigated: challenge`, `window._cf_chl_opt`, title "Checking your connection...", `<meta http-equiv="refresh">`, 80 visible chars |
| `cloudflare-security-glassdoor` | glassdoor.com / Cloudflare "Security" page | 403 | `cf-mitigated: challenge`, `_cf_chl_opt`, 555 visible chars (just under the 600 thin threshold) |
| `cloudflare-just-a-moment-stockx` | stockx.com / Cloudflare "Just a moment..." | 403 | `cf-mitigated: challenge`, `_cf_chl_opt`, `challenges.cloudflare.com` |
| `datadome-g2` | g2.com / DataDome | 403 | **no** `cf-mitigated`; `x-datadome: protected`, `captcha-delivery.com` script, 50 visible chars, 1.8 KB |

Sanitized: cookies, ray ids, client IPs, tokens and inline CSS removed. A fifth shape, AWS WAF
(`x-amzn-waf-action: challenge`, HTTP 202), is **synthetic**, from the AWS WAF developer guide
(`https://docs.aws.amazon.com/waf/latest/developerguide/waf-captcha-and-challenge-actions.html`). The Cloudflare header
contract is from `https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response/`.
Two control captures from the same pass were NOT blocked and shaped the false-positive rules: `hermes.com` (HTTP 200,
carries `x-datadome: protected`, real content) and `nowsecure.nl` (200, sparse).
