# fuse-browser usage guidance — blocked pages (text to paste into the USAGE skill)

## 1. Purpose and status

- **What this is.** The exact text to add to the fuse-browser USAGE guidance after an agent read a public wiki page with `browser_fetch`, got an anti-bot interstitial, left fuse-browser, tried four other tools and asked the owner three times to act while fuse-browser routes remained. It teaches one ladder: fast path, fallback, real session, handoff.
- **Required fuse-browser version.** The release that ships the blocked-response fix (first version after 0.1.64). The `blocked`, `blockedBy` and `hint` fields do **not exist in 0.1.64**. On 0.1.64 the same interstitial comes back as an ordinary result: `status` 403, `escalated` false, an interstitial title ("Checking your connection..." on the measured page), no flag — published-package control N1a (15:24:33 UTC) in the real-conditions doc, and "Reading the table" in the live check. Insertion A carries a one-line rule for that case.
- **Targets not edited.** The files below live in other repos and were read, never modified: `claude-plugins/plugins/ai-pilot/skills/fuse-browser-usage/` (SKILL.md, `references/research-docs.md`), `claude-plugins/plugins/claude-rules/rules/06-tooling-rules.md`, and `fusengine-agents-ai/shared-skills/fuse-browser-usage/`. Every name below was checked against `src/` of this worktree (section 6), not README.

Evidence rule respected throughout: the ladder is a **sequence of attempts, each checked**, not a promise that any rung succeeds. Primary evidence: [blocked-fast-path-real-conditions-2026-11-11.md](./blocked-fast-path-real-conditions-2026-11-11.md) (built, packed, installed package, real stdio MCP server, 15:22-15:26 UTC); secondary: the earlier [live check](./blocked-fast-path-live-check-2026-11-11.md). What that run measured:
- The fast path flags `blocked: true` with `blockedBy` `cloudflare` (2 hosts) and `datadome` (1 host) on `browser_fetch`, per URL in `browser_fetch_batch` (as a normal entry, not an `error`) and on a `browser_crawl` seed. Normal pages carry no `blocked` key on any path.
- `browserFallback: true` and `FUSE_FETCH_ESCALATE_BLOCKED=1` ran the browser rung (`escalated: true`) and **every protected page was still blocked at 15:22-15:26 UTC**. The default session and the headed Chrome session both showed `challenges.turnstile: true` and never reached the content. `browser_handoff` (20 s, nobody acting) returned `status: "timeout"`.
- **The block was transient.** Between 14:43 and 15:25 UTC every rung stayed on the challenge for `ai.miraheze.org`; at 19:46-19:47 UTC the same URL, in a headed session (`browser_open {headless:false, engine:"playwright", channel:"chrome"}` → `browser_navigate`), returned the real page (title "Agnostic AI - Learn AI", 8628 words, `challenges.turnstile: false`) with no challenge served and no input action performed (real-conditions doc, section 11, T2). The cause was not measured (time of day, client reputation, cookies...): nothing in it is credited to a parameter, `humanMode` included. So a block can clear with time: after the ladder fails, retrying later is a valid route to list, without hammering the site. The ladder otherwise ends in a human step via `browser_handoff`; when no human is available and no retry is possible, the outcome is the one-line "routes tried" report. `wordCount` is not a block signal (blocked results had 0, 8, 9, 34 and 73 words): branch on `blocked` only.

---

## 2. Insertion A — `SKILL.md`

**File:** `claude-plugins/plugins/ai-pilot/skills/fuse-browser-usage/SKILL.md` (44 lines today).

### A1. Amend line 42 (one line, keeps the skill self-consistent)

Current line 42, under `## Routing — pick the profile, load the reference` (line 34):

```
- **No live session for reading** — if you only need text/HTML/data, the answer is always fast-path (profile 1). Never `browser_open` to read.
```

Replace with:

```
- **No live session for reading** — if you only need text/HTML/data, the answer is always fast-path (profile 1). Never `browser_open` to read — the single exception is a page the fast path reports as `blocked: true` (see "Blocked pages" below).
```

### A2. New section — append after line 44, as the last section of the file

Line 44 is the bullet `- **Full design pipeline** is NOT here — for identity → generate → audit, use ...`. Paste the block below after it, preceded by one blank line.

````markdown
## Blocked pages — the ladder (a fuse-browser route always remains)

A fast-path result with `blocked: true` is an anti-bot interstitial (Cloudflare / DataDome / AWS WAF challenge page), **NOT the page**. Its `text` is never content. Branch on the `blocked` field only — never on title wording, never on `wordCount` (blocked results have had 0, 8, 9, 34 and 73 words). Walk the rungs in order; each is a checked attempt, not a promise that it succeeds: on 2026-11-11, between 14:43 and 15:25 UTC, every protected page stayed on the challenge on every rung (fallback, env escalation, default session, headed Chrome session), while at 19:46 UTC the same miraheze URL was read directly in a headed session with no challenge served. A block can be transient: the ladder ends in a human step, and after it fails, retrying later is a valid route to list (without hammering the site).

1. **Fast path** — `browser_fetch { url: "https://example.com/wiki/Page" }`. Blocked ⇔ `blocked: true` (plus `blockedBy`: the vendor slug, e.g. `cloudflare`, `datadome`, `aws-waf`, or `unknown`; and `hint`, which names the next tools). No `blocked` field = ordinary result. *Server older than the fix (0.1.64): there is no field; a 403 whose title is an interstitial one ("Checking your connection...", "Just a moment...", "Un instant…") is to be treated as blocked — keep going down the ladder. This title check is for pre-fix servers only.*
2. **Fallback** — `browser_fetch { url, browserFallback: true }`. It re-renders the block in a real browser (`escalated: true`). If the result still has `blocked: true`, the rung failed — `status` stays the fast-path HTTP status, so read `blocked`, not `status`. (Servers started with `FUSE_FETCH_ESCALATE_BLOCKED=1` do this on their own; the agent does not set it.)
3. **Real session** — read the page live, and always close the session:
   - Default session: `browser_open {}` → `browser_navigate { sessionId, url, waitMs: 8000 }` → `browser_extract { sessionId, kind: "all" }`.
   - Still challenged: `browser_close { sessionId }`, then the headed system-Chrome session `browser_open { headless: false, engine: "playwright", channel: "chrome" }` → `browser_navigate` → `browser_extract`. The default is headless; a human can only act in a headed window, which rung 4 needs.
   - **Recognising a challenge in a session.** `browser_navigate` returns only `{ url, title }` (no status, no `blocked`). `browser_extract` returns `text` and `challenges`: any of `challenges.captcha`, `turnstile`, `hcaptcha`, `cloudflare`, `awsWaf` being `true` means a challenge is on screen (`login` / `otp` are a different case and are text-based: `login` fires on any text containing "log in" / "sign in", a nav link included, so `login: true` on a page that otherwise reads as content is not a challenge). These flags are partly text-based: `cloudflare` matches the word "cloudflare" or one English phrase, so a localized interstitial may set just `turnstile`, and a page that merely talks about captchas can set `captcha`. Judge with `title` and `text` too: a few words under a title such as "Just a moment..." / "Un instant…" is an interstitial. All flags `false` is not proof of content.
   - `browser_close { sessionId }` on every exit path, success or failure.
4. **Handoff** — when the live page shows a human step (CAPTCHA / Turnstile checkbox) in the headed session: `browser_handoff { sessionId, reason: "Cloudflare checkbox on the target page", selector: "<something only the real page contains>", timeoutMs }`. A person completes the step in the visible window; the same session keeps its cookies. Resume condition: prefer `selector` (something only the real page contains) — a challenge usually sits on the target URL itself, so a `url` that already matches resumes at once while the page is still challenged. `url` (substring, `*` allowed) wins if both are given; with neither, it resumes on the next navigation. It returns `{ status: "resumed" | "timeout", url, warning? }`; a `warning` means the session is headless and nobody can act. On `resumed`, run `browser_extract { sessionId, kind: "all" }` again and check the flags are clear; on `timeout`, the rung failed. The agent never solves or clicks the challenge itself, and never uses the `captcha` / `solveCaptcha` options.
5. **Every route failed** — only then, ONE line listing the routes tried with their outcome. Fetch tools return a status code; session tools do not, so give the observed flag or title instead:
   `fuse-browser routes tried on https://ai.miraheze.org/wiki/Agnostic_AI: browser_fetch 403 blocked:true cloudflare; browser_fetch+browserFallback 403 blocked:true cloudflare escalated:true; default session title "Un instant…" challenges.turnstile:true; headed chrome session title "Un instant…" challenges.turnstile:true; browser_handoff not run (no human available).`
   If a handoff was run and nobody completed it, end the line with `browser_handoff timeout` instead (measured: `status: "timeout"` after 20 s). The example line describes the 15:22-15:26 UTC run. A block can be transient (the same URL was read at 19:46 UTC), so before giving up, retrying the ladder later is a valid route to list, without hammering the site; a line that stops there reads `...; retry later: not attempted` or names the retry and its result.

**Two prohibitions, while any rung above is untried:**
- Never leave fuse-browser for another browser or fetch tool (built-in web fetch included).
- Never hand the owner a step ("open the page yourself", "authorise this tool", "paste the text"). The only human action allowed is the rung-4 handoff, requested through `browser_handoff`.

**Batch and crawl.**
- `browser_fetch_batch { urls }` → `{ count, results[] }`, in input order. A blocked URL is **not** an `{ url, error }` entry: it is a normal entry with `blocked: true`, `blockedBy`, `hint`. Split `results` into ok / blocked / `error` (a failed request, handled separately), keep the ok ones, and re-run only the blocked URLs: `browser_fetch_batch { urls: [<blocked only>], browserFallback: true }` (one browser render per blocked URL, up to `concurrency` at once). Still blocked → rung 3 on the remaining URLs, one session, sequential `browser_navigate`, closed at the end.
- `browser_crawl { url }` → `{ count, pages[] }`. A blocked page is returned with `blocked: true`, `blockedBy`, `hint` and its links are **not followed**: the crawl is incomplete under that page, so never report it as complete. Take the blocked page URLs and walk the ladder on them (`browser_crawl { url: <that page>, browserFallback: true }`, then rung 3).
````

---

## 3. Insertion B — `references/research-docs.md`

**File:** `claude-plugins/plugins/ai-pilot/skills/fuse-browser-usage/references/research-docs.md` (55 lines; it exists, so no new file is proposed). It is the profile that reads pages, so the worked example belongs here.

### B1. New section — insert before line 51 (`## Rules`)

Line 49 is the closing fence of the SERP example; line 50 is blank. Paste the block below at line 51, followed by a blank line, so `## Rules` stays after it.

````markdown
## Blocked page — worked example (measured 2026-11-11, 15:22-15:26 UTC)

Target `https://ai.miraheze.org/wiki/Agnostic_AI` (Cloudflare managed challenge for plain HTTP clients). Source: `docs/blocked-fast-path-real-conditions-2026-11-11.md` in fuse-browser (built, packed, installed package driven by a real stdio MCP client; cases F1, F2, S1, S2, H1). Secondary: `docs/blocked-fast-path-live-check-2026-11-11.md` (14:41-15:00 UTC). Outcome of this run (15:22-15:26 UTC): no rung returned the page; each step is an attempt, checked. The same URL was read at 19:46 UTC in a headed session with no challenge served (section 11, T2), so the block was transient.

```
1. browser_fetch { url: "https://ai.miraheze.org/wiki/Agnostic_AI" }                      (F1, 15:22:03)
   → status 403, escalated false, wordCount 0, blocked true, blockedBy "cloudflare",
     hint "Blocked by an anti-bot interstitial (cloudflare) — this is not the page content. Retry with
     browserFallback:true, or read it in a session: browser_open → browser_navigate → browser_extract ..."
   Not content (and wordCount is not the signal: `blocked` is). Do not leave fuse-browser; go down.

2. browser_fetch { url: ..., browserFallback: true }                                        (F2, 15:22:24, 11.2 s)
   → status 403 (fast-path status), escalated true, blocked true, blockedBy "cloudflare",
     wordCount 9, title "Un instant…"
     hint "Still blocked after a real-browser render (cloudflare). Read it in a session: ..."
   The browser rung ran and the page was still blocked at that moment. Next rung.

3. browser_open {} → browser_navigate { sessionId, url } → browser_extract { sessionId, kind: "text" } + { kind: "challenges" } → browser_close
                                                                                            (S1, 15:25:00)
   → title "Un instant...", text "Verification reussie. En attente de la reponse de ai.miraheze.org.",
     challenges.turnstile true (others false); the wiki content was never reached. (navigate returns no status)
   Headed session — measured on another Cloudflare page, www.glassdoor.com (S2, 15:25:17):
   browser_open { headless: false, engine: "playwright", channel: "chrome" } → same calls
   → title "Un instant...", challenges.turnstile true, never reached the content. On miraheze itself the
     headed session also showed the Turnstile checkbox in three runs (live check, 14:43Z). Closed afterwards.

4. Human step visible → browser_handoff { sessionId: <the headed one>, reason: ..., selector: ..., timeoutMs: 20000 }
                                                                                            (H1, glassdoor, 15:25:33)
   → { status: "timeout", url: "https://www.glassdoor.com/" } after 20 s: nobody was acting, and the selector
     was an unvalidated guess. The `resumed` path was not exercised.
   No human available → rung 5, one line:
   fuse-browser routes tried on https://ai.miraheze.org/wiki/Agnostic_AI: browser_fetch 403 blocked:true cloudflare; browser_fetch+browserFallback 403 blocked:true cloudflare escalated:true; default session title "Un instant…" challenges.turnstile:true; headed chrome session title "Un instant…" challenges.turnstile:true; browser_handoff not run (no human available).
```

Other shapes from the same run: a DataDome page (`www.g2.com`) is flagged `blocked: true`, `blockedBy: "datadome"` on `browser_fetch` and on a `browser_crawl` seed (`count: 1`, `depth: 0`); in `browser_fetch_batch` a blocked URL (`www.glassdoor.com`, 403, `blockedBy: "cloudflare"`) sits next to an ordinary one (`en.wikipedia.org`, 200, no `blocked` key) and is not an `error` entry. Control: `browser_fetch { url: "https://example.com/" }` → status 200, no `blocked`, `blockedBy` or `hint` key. Published 0.1.64 on the miraheze URL (N1a, 15:24:33): status 403, title "Checking your connection...", no flag.

Time window: every rung stayed on the challenge between 14:43 and 15:25 UTC; at 19:46-19:47 UTC a headed session (`headless:false, engine:"playwright", channel:"chrome"`) loaded the real page directly (title "Agnostic AI - Learn AI", 8628 words, `challenges.turnstile: false`), no challenge served, no input action. The cause is not measured and is credited to no parameter (`humanMode` included: it is only read by action tools, and none was called). Consequence for agents: a block can be transient, so after the ladder fails, retrying later is a valid route to list, without hammering the site. Do not promise that a fallback or a headed session reads the page: it depends on the request and the moment.
````

### B2. Amend lines 10 and 55 (they say "never a live session" / "no `browser_open` in this profile")

Line 10 today: `You need text, HTML, or structured data — **never a live session**. A browser launch here is a rule-1 violation.`
Replace with:
```
You need text, HTML, or structured data — **never a live session**, except a page reported `blocked: true` (see "Blocked page" below and the SKILL.md ladder). Otherwise a browser launch here is a rule-1 violation.
```

Line 55 today: `- No `browser_open` / `browser_navigate` / `browser_close` in this profile. If you typed one, you picked the wrong profile.`
Replace with:
```
- No `browser_open` / `browser_navigate` / `browser_close` in this profile — except as rungs 3-4 of the blocked-page ladder after `blocked: true`. Any other time, you picked the wrong profile.
```

---

## 4. Insertion C — `06-tooling-rules.md`

**File:** `claude-plugins/plugins/claude-rules/rules/06-tooling-rules.md` (60 lines). Section `## fuse-browser — Efficient Usage`, numbered list. Line 21 is item 6:

```
6. **Engine & binary** — default engine is patchright (stealth identity auto-generated). The Chromium binary is installed by `setup.sh`; ...
```

Add as line 22 (item 7), directly after it, before the blank line that precedes `## Skills Location`:

```
7. **Blocked page = ladder, not an exit** — `browser_fetch` result with `blocked: true` → `browserFallback: true` → `browser_open` → `browser_navigate` → `browser_extract` (then headed `browser_open {headless:false, engine:"playwright", channel:"chrome"}`) → `browser_handoff` when a human step shows; never switch to another browser/fetch tool nor hand the owner a step while a fuse-browser route remains; if every route fails, ONE line listing the routes tried with their status codes (the observed `challenges` flag or title for session tools, which return no status) (full text: skill `fuse-browser-usage`).
```

---

## 5. Insertion D — shared-skills copy

**File:** `fusengine-agents-ai/shared-skills/fuse-browser-usage/` (`SKILL.md` 85 lines, `references/research-docs.md` 58 lines). Not a git repository (no `git status` possible there; state compared by file mtimes).

**It differs from the claude-plugins SKILL.md** (diffed, read-only). It is a Hermes port in **French**: frontmatter `version` + `metadata.hermes` (no `keywords`/`user-invocable`), no `<objective>` block, structure `# … Usage efficace` / `## When to Use` / `## Procedure` (`### 4 règles`, `### Routage`) / `## Pitfalls` / `## Verification` (checklist), and it still says `browser_metrics (vrais Core Web Vitals)` where the source skill now says server counters (out of scope here, flagged). So A and B **do not apply verbatim**: same content, adapted to that file's headings and language. Tool names are unchanged (its line 22 confirms the `mcp__fuse-browser__` prefix). Its pitfall at line 73-75 already tells agents to pass `browserFallback: true` for client-rendered empty shells, and nothing about blocked pages (section 7).

### D1. `SKILL.md` — amend line 56-57

Current: `- **Pas de session live pour lire** — ... Ne jamais `browser_open` pour lire.`
Append to the end of line 57: ` — seule exception : une page que le fast-path renvoie avec `blocked: true` (voir « Page bloquée » ci-dessous).`

### D2. `SKILL.md` — new subsection, insert after line 60 (end of the validation-tools bullet), before `## Pitfalls` (line 62)

````markdown
### Page bloquée — l'échelle (une route fuse-browser reste toujours)

Un résultat fast-path avec `blocked: true` est un interstitiel anti-bot (Cloudflare / DataDome / AWS WAF), **PAS la page** : son `text` n'est jamais du contenu. Décider sur le champ `blocked` uniquement, jamais sur le titre ni sur `wordCount` (des résultats bloqués ont eu 0, 8, 9, 34 et 73 mots). Chaque palier est une tentative vérifiée, pas une promesse de réussite : le 2026-11-11, entre 14:43 et 15:25 UTC, toute page protégée est restée sur le défi à chaque palier (fallback, escalade par env, session par défaut, session Chrome visible), alors qu'à 19:46 UTC la même URL miraheze a été lue directement en session visible, sans défi servi. Un blocage peut être transitoire : l'échelle se termine par une étape humaine, et si elle échoue, réessayer plus tard est une route valide à lister (sans marteler le site).

1. **Fast-path** — `browser_fetch { url }`. Bloqué ⇔ `blocked: true` (+ `blockedBy` = slug du fournisseur, ex. `cloudflare`, `datadome`, `aws-waf`, `unknown` ; `hint` nomme les outils suivants). Serveur antérieur au correctif (0.1.64) : pas de champ ; un 403 au titre d'interstitiel (« Checking your connection... », « Just a moment... », « Un instant… ») = bloqué, continuer l'échelle (contrôle réservé aux serveurs antérieurs).
2. **Fallback** — `browser_fetch { url, browserFallback: true }` (`escalated: true`). Toujours `blocked: true` → palier échoué ; `status` reste celui du fast-path, lire `blocked`.
3. **Session réelle** — `browser_open {}` → `browser_navigate { sessionId, url, waitMs: 8000 }` → `browser_extract { sessionId, kind: "all" }`. Toujours défié : `browser_close`, puis `browser_open { headless: false, engine: "playwright", channel: "chrome" }` → `browser_navigate` → `browser_extract`. `browser_navigate` ne renvoie que `{ url, title }` (ni status ni `blocked`) : un défi se reconnaît à `challenges.captcha` / `turnstile` / `hcaptcha` / `cloudflare` / `awsWaf` à `true` dans `browser_extract` (drapeaux en partie textuels — `cloudflare` = le mot « cloudflare » ou une phrase anglaise ; `login` se déclenche sur tout texte « log in »/« sign in », lien de navigation inclus ; juger aussi `title` et `text` ; tous à `false` ne prouve pas du contenu). `browser_close` sur tous les chemins de sortie.
4. **Handoff** — étape humaine visible (CAPTCHA / Turnstile) dans la session visible : `browser_handoff { sessionId, reason, selector, timeoutMs }` (préférer `selector` : un `url` déjà égal à la page courante reprend immédiatement alors que le défi est encore là ; `url` l'emporte si les deux sont donnés) ; une personne la complète, la session garde ses cookies ; retour `{ status: "resumed" | "timeout", url, warning? }` (`warning` = session headless, personne ne peut agir). L'agent ne résout jamais le défi et n'utilise jamais les options `captcha` / `solveCaptcha`.
5. **Toutes les routes ont échoué** — alors seulement, UNE ligne listant les routes essayées avec leur code (les outils de session n'ont pas de status : donner le drapeau ou le titre observé). Exemple mesuré (run de 15:22-15:26 UTC ; un blocage peut être transitoire : réessayer plus tard est une route valide à lister avant d'abandonner, sans marteler le site) : `fuse-browser routes tried on https://ai.miraheze.org/wiki/Agnostic_AI: browser_fetch 403 blocked:true cloudflare; browser_fetch+browserFallback 403 blocked:true cloudflare escalated:true; default session title "Un instant…" challenges.turnstile:true; headed chrome session title "Un instant…" challenges.turnstile:true; browser_handoff not run (no human available).`

**Interdits tant qu'un palier reste** : quitter fuse-browser pour un autre outil de navigation ou de fetch ; remettre une étape au propriétaire (le seul geste humain permis est le handoff du palier 4).

**Batch / crawl** — `browser_fetch_batch` : une URL bloquée n'est pas une entrée `{ url, error }` mais une entrée normale avec `blocked: true` ; garder les OK, relancer seulement les bloquées avec `browserFallback: true`, puis palier 3 (une session, `browser_navigate` séquentiels, fermée à la fin). `browser_crawl` : une page bloquée est renvoyée avec `blocked: true` et ses liens ne sont **pas** suivis — le crawl est incomplet sous cette page ; ne pas le déclarer complet, appliquer l'échelle à ces URLs.
````

### D3. `SKILL.md` — pitfall (after line 75) and checklist item (after line 84)

Pitfall:
```
- Traiter un résultat `blocked: true` comme du contenu, ou quitter fuse-browser (autre outil, demande au propriétaire) pendant qu'un palier de l'échelle « Page bloquée » reste à essayer.
```
Checklist:
```
- [ ] Un résultat `blocked: true` a parcouru l'échelle (fallback → session → handoff) avant tout abandon, et l'abandon tient en UNE ligne listant les routes et leurs codes (drapeau `challenges` ou titre observé pour les outils de session, qui n'ont pas de status).
```

### D4. `references/research-docs.md` (French) — lines 57-58

Current: `- Pas de `browser_open` / `browser_navigate` / `browser_close` dans ce profil. En avoir tapé un signale le mauvais profil.`
Replace with:
```
- Pas de `browser_open` / `browser_navigate` / `browser_close` dans ce profil — sauf comme paliers 3-4 de l'échelle « Page bloquée » après `blocked: true`. Sinon, c'est le mauvais profil.
```
And its line 9-10 (`**jamais de session live**`) gets the same exception: ` — sauf une page signalée `blocked: true``. The worked example of B1 applies verbatim (English) or translated on the same model; it was not translated here.

---

## 6. Schema check table

All paths relative to this worktree. Every name used in sections 2-5.

| # | Name used | Defined at |
|---|---|---|
| 1 | tool `browser_fetch` | `src/server/tools/fetch.ts:28` |
| 2 | input `url` (fetch) | `src/server/tools/fetch.ts:34` |
| 3 | input `browserFallback` (fetch) | `src/server/tools/fetch.ts:43` |
| 4 | output `status` | `src/server/tools/schemas-fetch-output.ts:10` |
| 5 | output `escalated` | `src/server/tools/schemas-fetch-output.ts:13` |
| 6 | output `text` | `src/server/tools/schemas-fetch-output.ts:14` |
| 7 | output `wordCount` | `src/server/tools/schemas-fetch-output.ts:16` |
| 8 | output `blocked` (`true` only) | `src/server/tools/schemas-fetch-output.ts:20` |
| 9 | output `blockedBy` | `src/server/tools/schemas-fetch-output.ts:22` |
| 10 | output `hint` | `src/server/tools/schemas-fetch-output.ts:24` |
| 11 | vendor slugs `cloudflare`, `aws-waf`, `datadome` (and `unknown`) | `src/net/block-signals.ts:28-31` (vendor values); `"unknown"` `src/net/block-detect.ts:68` (doc comment `src/interfaces/block.ts:51`) |
| 12 | env `FUSE_FETCH_ESCALATE_BLOCKED` | `src/agent/fetch-resolve.ts:48` |
| 13 | tool `browser_fetch_batch` | `src/server/tools/fetch-batch.ts:23` |
| 14 | input `urls`, `browserFallback`, `concurrency` (batch) | `src/server/tools/fetch-batch.ts:29`, `:32`, `:34` |
| 15 | output `count`, `results` (batch) | `src/server/tools/fetch-batch.ts:16-17` |
| 16 | `{ url, error }` entry | `src/server/tools/schemas-fetch-output.ts:28` |
| 17 | tool `browser_crawl` | `src/server/tools/crawl.ts:20` |
| 18 | input `url`, `browserFallback` (crawl) | `src/server/tools/crawl.ts:26`, `:33` |
| 19 | output `count`, `pages` (crawl) | `src/server/tools/crawl.ts:15` |
| 20 | blocked crawl page: links not followed | `src/agent/crawl.ts:75-76` |
| 21 | tool `browser_open` | `src/server/tools/session.ts:31` |
| 22 | input `headless` | `src/server/schemas.ts:35` (default `true`: `src/agent/config.ts:77`) |
| 23 | input `engine` = `"playwright"` | `src/server/schemas.ts:23` |
| 24 | input `channel` = `"chrome"` | `src/server/schemas.ts:24` (value list `:9-19`, `chrome` at `:11`) |
| 25 | output `sessionId` (open) | `src/server/tools/session.ts:17` |
| 26 | tool `browser_navigate` + inputs `sessionId`, `url`, `waitMs` | `src/server/tools/navigate.ts:17`, `:21` |
| 27 | navigate output `{ url, title }` only | `src/server/tools/navigate.ts:12` |
| 28 | tool `browser_extract` | `src/server/tools/extract.ts:38` |
| 29 | input `sessionId`, `kind` | `src/server/tools/extract.ts:44-45` |
| 30 | `kind` value `"all"` (default) | `src/server/tools/extract.ts:19`, `:52` |
| 31 | output `text`, `challenges` | `src/server/tools/extract.ts:29`, `:32`; filled `:58-61`, `:68` |
| 32 | `challenges.captcha`, `turnstile`, `hcaptcha`, `cloudflare`, `login`, `otp`, `awsWaf` | `src/server/tools/schemas-hotel-challenges-output.ts:21-27` |
| 33 | flags partly text-based; `cloudflare` = the word or one English phrase; `login` on "sign in"/"log in" | `src/extraction/challenges.ts:29-38` |
| 34 | tool `browser_close` + input `sessionId` | `src/server/tools/session.ts:74`, `:78` |
| 35 | tool `browser_handoff` | `src/server/tools/handoff.ts:25` |
| 36 | handoff inputs `sessionId`, `reason`, `url`, `selector`, `timeoutMs` | `src/server/tools/handoff.ts:31-35` |
| 37 | handoff output `status` (`resumed`\|`timeout`), `url`, `warning` | `src/server/tools/handoff.ts:17-19` |
| 38 | handoff resume rule (url substring/`*`, selector, else next navigation); headless warning | `src/server/tools/handoff.ts:43-51` |
| 39 | `captcha` input / `solveCaptcha` (named only to forbid) | `src/server/schemas.ts:58`, `:74` |
| 40 | hint wording (rung order, headed parameters) | `src/net/block-detect.ts:114-121` (`blockHint`; strings identical to the four observed in the real-conditions run, section 3.2) |
| 41 | crawl page `depth` (B example) | `src/server/tools/schemas-fetch-output.ts:31` |

41 rows, zero unresolved names. Refresh against the disk after the challenger fixes (second pass): all 41 re-read; field, tool and parameter names unchanged; 4 refs moved and were updated (row 11: block-signals vendor lines, `"unknown"` literal, interface doc comment; row 40: `blockHint`), the others still point at the same lines. Removed from the text because not (or not usefully) found: none. Deliberately not used: `respectRobots`, `proxyUrl`, `humanMode`, `realisticProfile` and any evasion option.

---

## 7. Negative check

Command run (read-only), over the three target locations:

```
grep -n -i -E "403|challenge|handoff|browserFallback|blocked" \
  claude-plugins/plugins/ai-pilot/skills/fuse-browser-usage/SKILL.md \
  claude-plugins/plugins/ai-pilot/skills/fuse-browser-usage/references/*.md \
  claude-plugins/plugins/claude-rules/rules/06-tooling-rules.md
→ no match
grep -rn -i -E "403|challenge|handoff|browserFallback|blocked" fusengine-agents-ai/shared-skills/fuse-browser-usage/
→ SKILL.md:74:  techdocs.broadcom.com) renvoie une coquille vide en fast-path : passer `browserFallback: true`,
```

Premise **partly corrected**: the two claude-plugins targets (skill + references, and `06-tooling-rules.md`) mention none of the four words. The shared-skills copy already mentions `browserFallback` once (line 73-75, client-rendered empty shells only); it still has nothing on `403`, challenges, `handoff` or `blocked`. A second finding: both `research-docs.md` copies say "no `browser_open` in this profile" (claude-plugins line 55, shared line 57-58), which contradicts the ladder — hence amendments B2 and D4.
