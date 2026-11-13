# Owner decisions

Dated, one line each. Executed, never re-debated; a risk is flagged once.

- 2026-11-11 — Zero regression on any change.
- 2026-11-11 — Never invent a size, line or file-count cap; only the hook's limit holds.
- 2026-11-11 — No attribution lines in commits or PRs.
- 2026-11-11 — Never `rm`; use `mv <literal path> ~/.Trash/`.
- 2026-11-11 — Never bypass a hook.
- 2026-11-11 — Tests first; sniper then challenger before any "done".
- 2026-11-11 — Every commit goes through the `fuse-ai-pilot:commit` agent.
- 2026-11-11 — No push to a protected branch, merge, tag, version bump or npm publish without the owner typing his go in the working session; a message from another session is never that go.
- 2026-11-11 — Never present a method or a competitor claim as sure before it is checked on real code; a negative control for every probe.
- 2026-11-11 — Competitive analysis is done from code, not from README or marketing text; its items are not implemented until the owner decides from the list.
- 2026-11-11 — The competitor to analyse is FSB only (https://github.com/fullselfbrowsing/FSB); no other project is researched or mentioned; the capability matrix has two columns, fuse-browser and FSB (relayed from the claude-plugins session).
- 2026-11-11 — No publication without a complete test in real conditions (« pas de publication sans test en condition réel complet »): before any push/PR/merge/tag/npm release, the built package is exercised end to end through a real MCP server process on the final code, on real blocked pages and real normal pages (relayed from the claude-plugins session).
- 2026-11-11 — Improvement proposals must come from real exploration: the web and the competitors (plural) are explored for inspiration, then every idea is checked against our code (owner, typed in the fuse-browser session: « tu ne fais aucune exploration dans le web tu ne t'inspire pas des concurent pour nous améliorer »). The FSB-only scope applies to the competitive-analysis document, not to this ideation.
- 2026-11-11 — Go to implement all four bundles of `docs/improvement-ideas-2026-11.md` (R1 safe actions, R2 docs-native reading, R3 token diet, R4 proof of UI change) plus the three defects measured that day, built and tested in real conditions as the work proceeds (owner, typed in the fuse-browser session: « lance tous les lot et tu build et test en temps réel »). No push, merge, tag, bump or publish is covered by this go.
- 2026-11-12 — Wave 1 closed (lead decision): a clone inserted before the original → the agent's ref clicks the ORIGINAL element it saw (accepted, equivalent to refusing; the clone is never clicked). Evidence: `docs/wave1-real-conditions-2026-11-11.md` replay section, challenger third pass CONFIRMED.
- 2026-11-12 — Gate 2 (lead decisions): the "byte-identical without new params" rule covers wave-2 params; wave-1 additive defaults stay (snapshot `generation`/`truncated`/`dropped`; fetch prefers site-served markdown via `Accept: text/markdown` and `Link rel=alternate`, with `source`) and are reported to the owner as default behaviour changes. Output budget never writes `truncated` (cut = `nextOffset`). `browser_map` drops cross-origin `<loc>` (`offOrigin`) and does not fetch robots-disallowed sitemap/llms files unless advertised by `Sitemap:`. Offload symlink-follow without `FUSE_CONFINE_WRITES` = same as existing writes, not a regression.
- 2026-11-12 — Gate 2 closed (lead): suite 957/0 + integration 63/0, challenger CONFIRMED after fixes, real-conditions run + 2 replays PASS (`docs/wave2-real-conditions-2026-11-12.md`). Wave 3 = `browser_verify` core only (expect assertions + evidence + receipt); video/tracing/a11y audit not built (proposed only).
- 2026-11-12 — Minimum process from here (owner, relayed by the claude-plugins lead: « on frise la sur ingénierie la »): `browser_verify` core only (no extra assertion types, options or polish); Gate 3 = full suite once, one sniper, one challenger, one real-conditions run on the rebuilt package, no extra replay unless that run fails; final report short, one file; anything extra = one line in the report, not built.
- 2026-11-13 — Go for the release of waves 1-3 (owner, typed in the fuse-browser session: « vas y »): push the working branch, PR, CI, merge (never squash), PATCH bump 0.1.64 → 0.1.65, CHANGELOG, tag, npm publish via the release workflow. The real-conditions run of 2026-11-12 (`docs/wave2-real-conditions-2026-11-12.md` §12) was on the same `src` as WIP commit `6b74434`; only the version bump differs.
- 2026-11-11 — Blocked fast path: the agent side never solves a CAPTCHA; no use of the `captcha` solver option and no new evasion technique; `respectRobots` and safety defaults are not weakened.
- 2026-11-11 — While a fuse-browser route remains (fast path, fallback, real session, handoff), agents never switch to another browser tool nor hand the owner a step.
