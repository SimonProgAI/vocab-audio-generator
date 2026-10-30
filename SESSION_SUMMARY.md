# Session Summary: 2026-10-29

## TL;DR

- **Goal of the session:** write durable handoff documentation, so any person or AI agent can
  continue with nothing but the repository. **No code was changed, and nothing was committed.**
- **Healthy state.** All 456 tests in 26 files pass, the type check passes, the production build
  succeeds, the live site is up, and the last deploy (#6) succeeded. Nothing is known to be
  broken.
- **The project is young but careful:** 13 commits over four days (2026-10-23 → 2026-10-26),
  clear layers, defensive parsing of every API reply and every saved session, and a README kept
  current with each feature.
- **"Never pay twice" is the central design theme,** visible in the retry rules, the
  "up to date" check, resuming jobs after a reload, and cached samples.
- **The most fragile part is the voice catalog** (`src/utils/voices.ts`): hard-coded, French
  only, dated 2026-10-25/26, and built from hand checks that can't be re-run from the
  repository.
- **The biggest testing gap is the code that spends credits:** `src/hooks/useGeneration.ts` has
  no direct tests.
- **The only saved benchmark is misleading** (made before the cache fix). Its one real round
  suggests that `qwen3-tts` (both voices, over 120 s) and `openvoice` (49 s) are slow among the
  voices the app shows.
- **Main risks:** TTS.ai changes (CORS, API shape, voice IDs), wasted credits (Stop doesn't
  cancel; Round Robin follows row position), key exposure through a local build, and large
  batches being untested.
- **Recommended first action:** review and commit these docs, then write
  `src/hooks/useGeneration.test.ts` (NEXT_STEPS.md N1). It needs no credits and no decisions.

---

## About this document

A record of the analysis session that wrote the project documentation. The session was run by an
AI coding assistant (Claude Opus 5.5 in Claude Code) at the owner's request, on commit `b71afb5`.
A later session should add its own summary above this one, or replace this file and move the old
summary into git history.

## Scope and method

What the session **read**:

- every source file in `src/` and `scripts/` in full (the tests through their test names and
  shared helpers);
- `package.json`, `vite.config.ts`, the `tsconfig*.json` files, `index.html`, `.env.example`,
  `.gitignore` and `.github/workflows/deploy-pages.yml`;
- all 13 commit messages with their bodies, plus a few diffs to check how things worked before
  (for example: before `7e30e88` the session was saved after every change and interrupted rows
  restarted as Pending);
- the existing `README.md`;
- the git-ignored `benchmark-results/` (one run from 2026-10-25), now summarized in
  CURRENT_STATE.md because it exists only on the development machine;
- notes from earlier sessions, now in AGENT_CONTEXT.md, Rule 8. The owner edits files during
  sessions, so a missing line may be the owner's deliberate change.

What it **ran**:

| Command / check | Result |
| --- | --- |
| `npm test` | 26 files, 456 tests passed (about 33 s) |
| `npm run typecheck` | passed |
| `vite build` with CI's variables, into a scratch folder (to leave `dist/` alone) | succeeded. Main JS ≈ 430 KB (137 KB gzipped). lamejs only in `mp3Worker-*.js` and `wavToMp3-*.js`. Icon links rewritten to `./…`. |
| Search of the local `dist/` for the `.env` key's value (only a count printed) | 0 files: no key in the local build |
| Fetching the live site and the repository's Actions page | the site answered; runs #2–#6 succeeded, #1 (2026-10-25) failed |
| `node -v`, `npm -v`, `npm ls --depth=0` | Node v25.2.1, npm 11.6.2; the installed packages match `package.json` |

What it **didn't** do:

- no real TTS.ai calls, because they spend credits;
- no manual testing in a browser;
- no changes to code, tests or configuration;
- no commit or push.

## Major findings

1. **Feature-complete for its current scope.** The README's TODO list is empty. Everything it
   describes is implemented and tested against an MSW mock of TTS.ai (CURRENT_STATE.md, What is
   working).
2. **The architecture is consistent.**
   - `App.tsx` orchestrates; hooks hold stateful logic; services do the side effects; utils are
     pure.
   - Only `ttsApi.ts` talks to TTS.ai. Components render props.
   - All of this is documented in ARCHITECTURE.md.
3. **Cost protection runs through everything** (DECISIONS.md D-05, D-07, D-13, D-16, D-18), and
   the tests protect it, except inside the generation loop itself.
4. **The voice catalog drives what users see:** which voices are hidden, which are tested, speed
   labels and price groups. It's hand-maintained data with dated evidence comments, and it goes
   stale silently when TTS.ai renames voices (CURRENT_STATE.md T3, T5).
5. **Slow voices** (an open known issue in the README) are still unhandled, and the data to
   decide is missing. The saved benchmark's rounds 2–3 were TTS.ai cache hits.
6. **Known limitations worth an owner decision:**
   - Stop doesn't cancel jobs TTS.ai has accepted.
   - Removing a row in Round Robin regenerates later rows.
   - Status checks are sequential, with no limit on jobs in flight.

   All three were confirmed by reading the code (CURRENT_STATE.md, Known limitations 1, 2, 4).
7. **Conventions are strong but enforced only by habit:** no linter or formatter, strict
   TypeScript, behavior-sentence test names, plain-English UI text. AGENT_CONTEXT.md writes them
   down.

## Risks identified

Details and what limits each one are in CURRENT_STATE.md, Known risks.

| # | Risk | Summary |
| --- | --- | --- |
| R1 | TTS.ai changes | CORS, API shape, voice IDs, prices or caching changing would break or degrade the app. The hosted site relies on CORS. |
| R2 | Wasted credits | Stop not cancelling, Round Robin shifting, regenerating after setting changes, failed storage losing job IDs. |
| R3 | Key exposure | A local build with `.env` set embeds the key. A remembered key is shared across the account's `github.io` sites. |
| R4 | LGPL | lamejs must stay out of the main bundle. |
| R5 | New toolchain | TypeScript 7, Vite 8, Vitest 5, MSW 3, jsdom 30; upgrades may break. |
| R6 | Deploy on push | Every push to `main` goes live. |
| R7 | Scale | Hundreds of rows are untested against TTS.ai's real limits. |

## What changed in the repository

| File | Change |
| --- | --- |
| `README.md` | **Restructured, content kept.** New sections: TL;DR, Overview, Goals (marked as inferred), Requirements, High-level architecture, Directory structure (replacing the short tree under "How it works"), Project documentation. The only lines removed are the old "Needs Node 22.22 or newer…" sentence (now under Requirements) and the old short tree (now Directory structure). The TODO section is still empty, and still the owner's. |
| `ARCHITECTURE.md` | New: system context, module map, component tree, state, domain model and lifecycle, data flows, the TTS.ai API as the code uses it, the audio pipeline, the voice catalog, build and deploy, tests, scripts. |
| `CURRENT_STATE.md` | New: snapshot, how it was checked, what works, partial work, broken (nothing known), known limitations, technical debt, risks, open questions, benchmark data on record. |
| `DECISIONS.md` | New: 28 decisions (D-01 to D-28) with alternatives and consequences, the superseded approaches, and the assumptions (A1–A11). |
| `NEXT_STEPS.md` | New: tasks N0–N13 with order and dependencies, short, medium and long term, and a definition of done. |
| `AGENT_CONTEXT.md` | New: rules, how the owner works, coding standards, constraints, 21 gotchas, a change cookbook, a checklist, a glossary. |
| `AGENTS.md` | New, added after the owner agreed to it: a short pointer to AGENT_CONTEXT.md that Claude Code (v2.1.277+) and other coding agents load on their own (DECISIONS.md D-28). |
| `SESSION_SUMMARY.md` | New: this file. |

No file under `src/`, `scripts/`, `public/` or `.github/`, and no configuration file, was
changed.

## Recommended first action for the next session

1. **If these docs aren't committed yet:** the owner reviews them, especially the inferred Goals
   in the README and the Open questions in CURRENT_STATE.md, and commits them (N0). A push to
   `main` redeploys the site, but the app itself doesn't change.
2. **Then confirm the baseline:** `npm ci`, then `npm test` (expect 456 passing), then
   `npm run typecheck`.
3. **Then write `src/hooks/useGeneration.test.ts`** (N1), following the ten cases in
   NEXT_STEPS.md. It protects the code that spends credits before anyone changes it (N6, N7, N8
   all touch it), and it needs no credits and no owner decisions.

## Questions to bring to the owner

The full list is in CURRENT_STATE.md, Open questions. These four unblock the most work:

1. May the voice benchmark be re-run (about 460 credits, N3)? And how should slow voices be
   handled afterwards (N4)?
2. Should Stop say that jobs already accepted may still be charged, or should Stop try to cancel
   them (N6)?
3. Should a Round Robin row keep its voice when other rows are removed (N7)?
4. Is the app meant to stay French-only and for desktops, or to grow (other languages, phones,
   keeping the queue after the tab closes)?

## Keeping these docs useful

- Update CURRENT_STATE.md, with its date, whenever something starts or stops working.
- Add a DECISIONS.md entry for each new design choice, using the same fields.
- Tick off or add NEXT_STEPS.md tasks as work happens.
- Add a short new session summary at the end of each significant session.
