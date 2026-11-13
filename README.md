# fuse-browser

**Give your AI agent a real, stealth browser.** An [MCP](https://modelcontextprotocol.io)
server + CLI on top of [Patchright](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright-nodejs)
(stealth Chromium) with a Playwright fallback.

Your agent gets a **real browser** — per-country identity (locale/currency/timezone/geo),
stealth fingerprint, self-healing actions, an indexed snapshot with stable refs (piercing
Shadow DOM + iframes), multi-step plans, structured extraction, visual diff, and **human
guardrails** for payments and bookings. It drives real Chromium, so it reads **Next.js / SPA**
pages after hydration — not just static HTML.

> 54 MCP tools · stealth + rotating proxies · HTTP fast-path (single, batch & crawl) · full-site content + screenshot snapshots · structured per-card product extraction · form fill + file upload · encrypted credential vault + TOTP (fill-by-reference, origin-bound, never exposed to the LLM) · hover + drag&drop · PDF export · cookies / permissions · network mocking · clipboard · virtualized-list scraping + autoscroll · tabs / dialogs / downloads · console + network logs · MCP screenshot resources · `FUSE_CAPS` / `FUSE_PRESET` (`docs`/`qa`) tool filtering · tool annotations · output budget (`maxTokens`, `outputMode:"file"`) · named auth profiles (cookies + localStorage + IndexedDB, saved at login) · `blockResources` · HAR record/replay · pixel visual-diff · human handoff + live view · typed structured output (`outputSchema` + `structuredContent`).

## Install

```bash
# Register with Claude Code (or any MCP client) — user scope = all projects
claude mcp add fuse-browser --scope user -- npx -y @fusengine/browser-mcp
```

```jsonc
// …or add it to your MCP config manually:
{ "mcpServers": {
  "fuse-browser": { "command": "npx", "args": ["-y", "@fusengine/browser-mcp"] }
}}
```

Chromium installs automatically. That's it — now just ask your agent in plain language:

> "Find a hotel in Annemasse this Friday under CHF 100."
> "What's my Google rank for 'agence web vevey' (CH)?"
> "Screenshot localhost:3000 in mobile and desktop."

Prefer a terminal? Install the CLI: `npm i -g @fusengine/browser-mcp`

```bash
fuse-browser probe https://example.com --extract-prices
fuse-browser fetch https://books.toscrape.com/ --extract-prices   # no browser, ~10× faster
fuse-browser products "https://www.digitec.ch/en/search?q=macbook" --limit 20   # structured cards → sort to find the cheapest
```

## How it works

An LLM runs a **perceive → decide → act** loop through the tools: `browser_open` →
`browser_navigate` → `browser_snapshot` (indexed `ref`s + form state) → `browser_act`
(click/fill/select/pick/upload/hover/drag, returns a page diff) → `browser_wait_for` → `browser_autoscroll`
(drain lazy lists) → `browser_products` / `browser_collect` / `browser_extract` /
`browser_screenshot`. Sensitive actions (pay / book / checkout) are **blocked** unless the
agent passes `humanApproved`.

## What you get

- **Stealth** — Patchright neutralizes the real automation signals; per-country identity + rotating proxy pool.
- **Agentic targeting** — accessibility-style snapshot with stable refs, self-healing click/fill, multi-step plans.
- **Vision (Set-of-Marks)** — `annotate:true` on `browser_snapshot`/`browser_act`/`browser_screenshot` draws numbered badges (= each `ref`) on the page, so vision models *see* it and target by ref.
- **Sees everything** — open Shadow DOM, same/cross-origin iframes, and **virtualized/infinite lists** (`browser_collect`, `browser_autoscroll` to drain lazy-loaded results first).
- **Structured extraction** — `browser_products` pulls **per-card** rows (`{title, price, currency, url?}`, each price tied to its own title) by detecting repeated card containers — works on Digitec, Booking, Amazon… Sort by price to answer "which is the cheapest?". **Layout-agnostic prices**: prefix/suffix currency, thousands/decimal markup, CH/EU formats. Also exposed as the CLI `products` command.
- **Full session control** — multi-tab (`browser_tabs`: list/new/select/close popups & OAuth windows), native dialog policy (`browser_dialog`), captured `browser_downloads`, plus `browser_console` / `browser_network` logs to debug why a page misbehaves.
- **Fast-path** — `browser_fetch` impersonates a real Chrome TLS fingerprint for server-rendered HTML, no browser launch — returns clean **markdown** and optional **contacts** (`extractContacts`) at ~HTTP speed. **JSON APIs / plain text** come back verbatim (no HTML mangling). Opt-in **`browserFallback`** auto-renders client-side (SPA/CSR) pages in a real browser when the HTTP response is an empty shell (`escalated: true`). **`browser_fetch_batch`** fetches many URLs in parallel (bounded concurrency, errors isolated per URL). **`browser_crawl`** walks a whole site (bounded same-origin BFS, robots-honored) → clean markdown per page. **`browser_shots_batch`** captures responsive full-page screenshots of many URLs in parallel (see the design of a whole set of pages at once). **`browser_collect_batch`** exhausts the infinite-scroll list of many listing URLs at once (crawl finds the pages, collect drains them). **`browser_site_shots`** snapshots a whole site in one call — crawl + screenshot each page, returning content **and** responsive PNGs per page.
- **Data out** — multi-currency prices, typed CSS extraction, **contact extraction** (emails/phones E.164, `fastPathFirst` cascade), a clean→validate→dedupe→emit pipeline, CSV export, Google SERP rank tracking.
- **Ops** — persistent sessions, **auto crash recovery** (a crashed page is recreated in the same context and restored to its last URL between calls), opt-in **per-host circuit breaker** + **bounded probe queue/budget** + **`browser_metrics`** for mass scraping, **live view** (watch any session — even headless — in your browser), **`screenshot://{sessionId}/last` MCP resource** (read a session's current page as a JPEG on demand), `storageState` auto-save, **named auth profiles** (`profile`), **`blockResources`** to skip images/fonts/etc. on batch runs, HAR record/replay, pixel `visual_diff`, human handoff for login/2FA.
- **Context control** — **`FUSE_CAPS`** registers only the tool groups you need (`core`/`batch`/`extract`/`debug`/`live`) for a lighter LLM context, and the batch tools emit MCP **progress notifications** when the client sends a `progressToken`.

## Documentation

Full reference in **[`docs/`](./docs/README.md)**:

[Installation](./docs/installation.md) ·
[CLI](./docs/cli.md) ·
[MCP tools (51)](./docs/mcp-tools.md) ·
[Configuration](./docs/configuration.md) ·
[Sessions](./docs/sessions.md) ·
[Extraction](./docs/extraction.md) ·
[Anti-bot & proxies](./docs/anti-bot.md) ·
[Library](./docs/library.md)

## Disclaimer

Provided **as-is** under MIT, no warranty. `fuse-browser` is a neutral, **dual-use** automation
tool built for **responsible automation**: sensitive actions (payment, booking, checkout,
destructive operations) are gated behind **human-approval guardrails**, and compliance controls —
`robots.txt` respect (`respectRobots`), rate limiting, contact-extraction filters — are built in
and **opt-in**, to be configured according to your lawful basis and the target's rules.
**You alone are responsible** for complying with applicable law, target sites' Terms of Service,
`robots.txt`, and data-protection rules (GDPR, nLPD). The opt-in captcha solver and contact
extraction are for **authorized, lawful use only**. See **[LEGAL.md](./LEGAL.md)**.

## License

MIT
