# Anti-bot & proxies

How fuse-browser stays under the radar: a stealth-by-default engine, proxy
rotation/routing, WebRTC leak prevention, a TLS-impersonating HTTP fast-path,
and an opt-in captcha solver. This is a reference for the mechanisms and their
honest limits — there is no magic.

## Stealth engine

The default engine is **Patchright** (a Playwright-compatible Chromium driver).
It neutralizes the real automation signals **at the source** rather than
patching them after the fact:

- **No `Runtime.enable`** — the single most reliable CDP-based bot tell is
  never emitted.
- **`navigator.webdriver` removed** — the flag automation frameworks normally
  expose is gone.
- **Automation launch flags stripped** — the tell-tale `--enable-automation`
  /AutomationControlled surface is not present.
- **Isolated-world evaluation** — injected scripts run in an isolated world,
  so page-side detectors can't observe the framework's `evaluate` calls.

### "Just disconnect CDP" is a misconception

A common suggestion is to "disconnect CDP" to evade detection. This is wrong:
**Playwright/Patchright *is* the CDP connection** — disconnecting it would mean
no browser control at all. What sites actually detect are *side-effects* of
CDP (e.g. `Runtime.enable`, the webdriver flag, automation flags), not the
transport itself. Patchright already suppresses those side-effects. There is
nothing further to gain by tampering with the CDP channel.

Residual hardening is therefore **not** a CDP trick. It is:

- **Residential proxies** (clean IP reputation)
- **Realistic timing** (human-like pacing between actions)
- **A coherent identity** (UA, locale, timezone, viewport, and proxy country
  all agreeing)

## Proxies

Three ways to supply proxies, resolved in a fixed priority order.

| Mechanism | How to configure | Notes |
|-----------|------------------|-------|
| Single proxy | `proxyUrl` | Highest priority; forces this exact proxy. |
| Per-country routing | `proxyMapPath` (JSON file, `country → proxyUrl`) and/or inline `proxyCountryMap` | Inline map overrides file; country keys are uppercased. |
| Rotating pool | `FUSE_PROXIES` env (comma/newline list) and/or `proxiesPath` (JSON array file) | Merged + deduped; round-robin with cooldown. |

### Resolution order

`resolveProxy` (`src/proxy/country-map.ts`) picks the effective proxy:

1. **explicit** — `proxyUrl` if set.
2. **country_map** — match for the requested country code.
3. **pool** — fall back to the rotating pool (`acquirePoolProxy`).

If none of these yields anything, no proxy is used.

### Pool behavior (`src/proxy/pool.ts`)

- **Round-robin** — `acquire()` returns the next available entry and advances a
  cursor.
- **Cooldown on block** — when a proxy triggers a captcha / Cloudflare
  challenge (or 403/429), `reportBlocked()` puts it on a **5-minute cooldown**
  and `acquire()` skips it.
- **Auto-retire, never removed** — a cooled-down proxy re-enters rotation
  automatically once its cooldown elapses. The pool size never shrinks.
- `available` reports how many entries are not currently cooling; `acquire()`
  returns `null` when all entries are cooling or the pool is empty.

The proxy list (`FUSE_PROXIES` / `proxiesPath`) is a secret you provide — keep
it out of the repo.

## WebRTC leak guard

When a proxy is set on Chromium, the engine adds launch args
(`WEBRTC_LEAK_ARGS`, `src/engine/webrtc.ts`) that force WebRTC through the
proxy and block non-proxied UDP:

```
--webrtc-ip-handling-policy=disable_non_proxied_udp
--force-webrtc-ip-handling-policy
```

This stops a page from revealing the machine's real IP via WebRTC ICE/STUN
behind the proxy. Chromium-only.

## HTTP fast-path (`browser_fetch`)

`browser_fetch` uses **`impit`** to impersonate a real Chrome **TLS/JA3 +
HTTP/2 fingerprint** with **no browser launch** (~10× faster than a full
probe). It returns status, body text, and optional extracted prices, and
accepts an optional `proxyUrl`.

- **Passes:** static / server-rendered HTML, and low/medium Cloudflare.
- **Does NOT pass:** JS challenges, Turnstile, DataDome, or SPA pages that need
  a real DOM.
- **Fallback:** for anything in the "does not pass" list, use `browser_probe`
  (full stealth browser).
- **A block is reported, not passed off as a page.** When the response is a
  challenge interstitial (Cloudflare, DataDome, AWS WAF), `browser_fetch` /
  `browser_fetch_batch` / `browser_crawl` return `blocked: true`, `blockedBy`
  and a `hint` instead of an ordinary-looking result. This is detection and
  routing only — nothing is solved or evaded: next step is `browserFallback:
  true` (or `FUSE_FETCH_ESCALATE_BLOCKED=1` server-side), then a session
  (`browser_open` → `browser_navigate` → `browser_extract`), then
  `browser_handoff` when the live page shows a human step (CAPTCHA /
  Turnstile). Whether a real browser passes a given challenge depends on the
  site and on the client's reputation at that moment — see
  [blocked-fast-path-live-check-2026-11-11.md](./blocked-fast-path-live-check-2026-11-11.md).
  Signals and combination rules: `src/net/block-signals.ts`,
  `src/net/block-detect.ts`.

## Captcha solver (opt-in — authorized testing only)

> Intended for sites you own or are explicitly permitted to test. Disabled
> unless you explicitly turn it on.

Enable with `solveCaptcha: true` plus a `captcha` config object
(`CaptchaConfig`, `src/interfaces/net.ts`):

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `provider` | yes | — | `2captcha` \| `anticaptcha` \| `capmonster` |
| `apiKey` | yes | — | Provider client key. |
| `baseUrl` | no | provider default | Override base URL (e.g. a 2captcha-compatible aggregator). |
| `timeoutMs` | no | `180000` | Total solve budget. |
| `pollMs` | no | `5000` | Poll interval while the task is processing. |

### What it handles

reCAPTCHA v2 and Cloudflare Turnstile. The three providers share the same
`createTask` / `getTaskResult` JSON API, so a single adapter only
parameterizes the base URL (`src/net/captcha-client.ts`):

| Provider | Base URL |
|----------|----------|
| `2captcha` | `https://api.2captcha.com` |
| `anticaptcha` | `https://api.anti-captcha.com` |
| `capmonster` | `https://api.capmonster.cloud` |

### Flow (`src/captcha/solve.ts`)

1. **Detect** the captcha kind present on the page (Turnstile preferred over
   reCAPTCHA when both are flagged).
2. **Read** the sitekey from the DOM.
3. **Solve** via the provider (`createTask` → poll `getTaskResult` until
   `ready`).
4. **Inject** the returned token into the page.

### Result reporting

The outcome is reported as `captcha: { attempted, solved, kind, provider,
reason }` (`CaptchaOutcome`). **Failures are reported, never thrown** — a
missing sitekey, injection failure, timeout, or provider error surfaces as
`solved: false` with a `reason` (`sitekey-not-found`, `token-injection-failed`,
etc.).

### Getting a key

2captcha.com — sign up and make a small deposit (~$5). **NEVER commit the API
key.** Pass it via config/env, not source.

## Limits (honest)

- **Beats:** static HTML + low/medium Cloudflare, with proxies + stealth.
- **Needs more:** hard JS anti-bot — interactive Turnstile, DataDome,
  PerimeterX/Shape — requires **real residential proxies** + the **captcha
  solver**, and for the hardest cases a **human handoff**.
- There is no magic. Stealth + clean IPs + realistic behavior get you far;
  the rest is the captcha solver and, when that's not enough, a human.
