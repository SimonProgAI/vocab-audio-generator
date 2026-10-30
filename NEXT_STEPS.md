# Next Steps

## TL;DR

- **Do first, no credits or decisions needed:** add direct tests for the billing-sensitive
  generation loop, `src/hooks/useGeneration.ts` (N1), then for `useVoices` (N2).
- **Then, with the owner's approval:** re-run the voice benchmark with the fixed script (N3, about
  460 credits). The only saved results are flawed. The data then decides how to handle slow
  voices (N4).
- **Make the voice checks repeatable** (N5). The French-speech and speed checks behind
  `src/utils/voices.ts` were done by hand, and TTS.ai changes its models.
- **Questions for the owner, before touching the code:** should the UI warn that Stop doesn't
  cancel jobs already accepted (N6)? Should Round Robin keep a row's voice when other rows are
  removed (N7)?
- **Scale** (N8): measure large batches, then consider polling in parallel with a limit and
  capping jobs in flight. Do N1 first.
- **Optional cleanups:** Prettier/ESLint (N9, owner decision), load JSZip lazily (N10), drop
  `uuid` (N11), small tidy-ups (N12). Also a cross-browser check (N13).
- **Ideas that need the owner's input:** other languages, keeping the queue after the tab
  closes, export/import, samples using the row's own text and speed, phones, a French UI.
- **Every task ends with** tests, `npm test`, `npm run typecheck`, the README (if users would
  notice) and these docs updated. **Pushing to `main` deploys the live site.**

---

## About this document

A prioritized plan as of **2026-10-29**. The owner's own TODO list (README → TODO) is **empty**,
so no work was requested at that date. Everything below is a **recommendation** from the
2026-10-29 analysis (see SESSION_SUMMARY.md). The owner hasn't prioritized it.

Markers: **(owner decision)** means the owner chooses before anyone writes code. **(spends
credits)** means it makes real TTS.ai calls, which need the owner's explicit go-ahead every time.
Effort: XS < 30 min · S ≤ 2 h · M ≈ half a day · L ≥ a day.

## Prioritized task list

| ID | Task | Why | Effort | Depends on | Needs |
| --- | --- | --- | --- | --- | --- |
| N0 | Review and commit the documentation from 2026-10-29 | They're uncommitted until the owner reviews them | XS | — | the owner |
| N1 | Direct tests for `useGeneration` | Billing-sensitive paths are untested (CURRENT_STATE.md T1) | M | — | — |
| N2 | Tests for `useVoices` (and optionally `ProgressPanel`/`Toolbar`) | Coverage gaps (T2) | S | — | — |
| N3 | Re-run `npm run benchmark:voices` for the visible French voices | The saved results predate the reuse fix (T4); "Slow speakers" is still open | S (mostly waiting) | — | **spends credits** (~460), owner approval |
| N4 | Decide on and build slow-voice handling | README Known issues: "Slow speakers" | S–M | N3 | **owner decision** |
| N5 | A script to re-run the French-speech and speed checks; refresh the catalog | Checks aren't repeatable (T3); renamed voices drop out silently (T5) | M–L | finding TTS.ai's speech-to-text endpoint | **spends credits** when run |
| N6 | Make Stop's cost visible; find out whether TTS.ai can cancel jobs | Known limitations 1 | S | N1 | **owner decision** |
| N7 | Stable Round Robin when rows are removed | Known limitations 2 | S–M | N1 | **owner decision** |
| N8 | Large batches: measure, then poll in parallel with a limit and/or cap jobs in flight | Known limitations 4, risk R7 | M | N1 | — |
| N9 | Prettier + ESLint matching today's style | No tooling (T7) | S | do it **before** big refactors, in its own commit | **owner decision** |
| N10 | Load JSZip only when Download All is first used | Main bundle ≈ 430 KB (T8) | S | — | — |
| N11 | Replace `uuid` with `crypto.randomUUID()` | One dependency fewer (T9) | XS | — | optional |
| N12 | Small cleanups: shared `isRecord`/`readString`, the overlong comment in `session.ts`, benchmark paths from the repository root | T6, T11, T12 | XS–S | — | optional |
| N13 | Manual check in Chrome, Firefox and Safari (and a phone) against the real API | No record of browser testing; real behavior last checked 2026-10-26 | S–M | — | a few credits |

## Recommended order

```
N0 ──► N1 ──► N2                          (next session: no credits, no decisions)
        │
        ├──► N6, N7   once the owner has answered the questions
        └──► N8

N3 ──► N4                                 (approve credits → data → decision)
N5   (can share a session and a budget with N3)

N9   if accepted: alone, before large refactors
N10, N11, N12, N13   any time
```

Why this order:

1. **N1 before touching generation.** N6, N7 and N8 all change `useGeneration.ts` or
   `assignment.ts`, which spend credits. Tests first keep a regression from billing twice.
2. **N3 before N4.** The only timings are a single sample per voice from a flawed run
   (CURRENT_STATE.md, Benchmark data on record), not enough to decide anything.
3. **N9 alone, early or never.** A formatter run touches every file. In its own commit it doesn't
   bury real changes.

---

## Short term (the next one to three sessions)

### N0: Review and commit the docs

- The files: `README.md` (restructured: TL;DR, Overview, Goals, Requirements, High-level
  architecture, Directory structure, Project documentation), `ARCHITECTURE.md`,
  `CURRENT_STATE.md`, `DECISIONS.md`, `NEXT_STEPS.md`, `AGENT_CONTEXT.md`, `AGENTS.md`,
  `SESSION_SUMMARY.md`.
- The owner may want to edit the inferred **Goals** (README) and the **Open questions**
  (CURRENT_STATE.md) first.
- Commit only when asked. A push to `main` redeploys the site; only docs change, so the app
  stays the same.

### N1: Test the generation loop directly

Create `src/hooks/useGeneration.test.ts`:

- Start it with `// @vitest-environment jsdom`. `wait()` uses `window.setTimeout`, which doesn't
  exist in the Node environment.
- Use `renderHook(() => useGeneration(applyProgress, onSubmitted))` with `vi.fn()` spies, and
  MSW handlers for `POST ${API}/tts/` and `GET ${API}/speech/results/`, where
  `API = ${import.meta.env.VITE_TTS_API_ORIGIN}/v1`.
- Use errors that aren't retried (for example HTTP 400 → `kind: "request"`) wherever retry
  delays would slow the test. 5xx errors make `send()` wait 1 s and 2 s between attempts.

Cases to cover:

1. Happy path: jobs are submitted one at a time. `onSubmitted` is called once per accepted job.
   Rows end `completed` with `downloadUrl` and `generatedWith: { speaker: voice.key, speed }`. The
   summary counts are right.
2. A submit reply with `status: "failed"` → that row is `failed` with "TTS.ai rejected this job."
   The others continue.
3. A 401 on submit → `fatalError` is set, there are no further submits, and unfinished rows go
   back to `pending` with `jobId` cleared.
4. A 401 while polling → the same.
5. A network error on submit → that row fails, **with exactly one POST for it** (no resubmit),
   and the next job continues.
6. Three failed status checks in a row → the row fails. A success in between resets the count.
7. A job older than 10 minutes → "TTS.ai took too long…". Spy on `Date.now` to jump forward, or
   use fake timers carefully: MSW plus fake timers needs `advanceTimersByTimeAsync` or
   `shouldAdvanceTime`.
8. `stop()` during a run → `stoppedByUser: true`, unfinished rows back to `pending`.
9. Resumed jobs (`run([], resumed)`) are polled but **never** submitted, and finish with the
   `generatedWith` they were given.
10. A status change from queued to processing is passed on through `applyProgress`.

### N2: Test `useVoices`

Cases: hidden voices are filtered out; an empty list gives "TTS.ai returned an empty voice
list."; an error gives "Couldn't load voices. …"; `reload` goes back to `loading` and refetches;
unmounting aborts the request. Optionally add small tests for `ProgressPanel` (percentages,
"waiting in TTS.ai's queue") and `Toolbar` (Generate All/Stop, ZIP progress text).

### N3: Re-run the voice benchmark (spends credits)

- Always start with the estimate, which costs nothing:
  `npm run benchmark:voices -- --dry-run --model kokoro,melotts,piper,openvoice,pocket-tts,qwen3-tts,vits`
- Those models cover the 8 visible French voices, plus `pocket-tts:jean_fr`, which is hidden.
  That makes 9 voices × 3 runs = 27 jobs × 11 characters. By the measured tiers (6 free voices,
  openvoice premium, the 2 qwen3-tts voices standard) that's about **460 credits**. The script
  prints its own estimate and asks before spending anything.
- Consider `--timeout 300` so that slow voices (qwen3-tts timed out at 120 s) get a real number.
  It makes the run longer, since jobs run one at a time.
- Run it **from the repository root** through npm, because `.env` and `benchmark-results/` are
  relative paths.
- Record the results in CURRENT_STATE.md (Benchmark data on record), replacing the 2026-10-25
  table, and refresh `MODEL_TIERS` comments if any tier has changed.

### N4: Handle slow voices (owner decision, after N3)

Options to put to the owner:

- (a) A label such as " · slow", like " · ignores speed", from a `SLOW_VOICES` set in
  `src/utils/voices.ts`.
- (b) A fifth Sort voices box, "Fast voices only".
- (c) A notice when a slow voice is chosen.
- (d) Hide voices that are very slow.

Whatever is chosen: add it to `VoiceListOptions` and `DEFAULT_VOICE_LIST` (for a box), to
`parseVoiceList` in `src/services/session.ts` (saved sessions must keep loading), and to the
README (Sort voices / Voice quality), with tests next to the existing ones in
`src/utils/voices.test.ts` and `SpeakerSettings.test.tsx`.

## Medium term

### N5: Make the voice checks repeatable (spends credits when run)

- A script, for example `scripts/check-voices.ts`, following `benchmark-voices.ts`: standalone,
  asks before spending, writes to a git-ignored folder. For each French voice it would:
  1. generate a word and a sentence, transcribe them with TTS.ai's speech-to-text (Whisper), and
     compare with the text;
  2. time "une rivière" at 0.5×, 1× and 2× (following means about 2× as long at 0.5× and about
     half as long at 2×).
- **Unknown:** TTS.ai's speech-to-text endpoint and how its replies look. Nothing in the
  repository records them, so check <https://tts.ai/api>.
- Output: proposed `HIDDEN_VOICES`, `TESTED_VOICES`, `FOLLOWS_SPEED` and `IGNORES_SPEED` with
  evidence, for a person to review. Don't rewrite the lists automatically.
- It would also catch renamed voices (T5) by reporting catalog keys that are missing from the
  live list.

### N6: Stop and its cost (owner decision)

- Today, jobs TTS.ai has already accepted keep running and stay charged.
- Option A (S): one line in the Stop notice ("Files TTS.ai had already started may still be
  charged.").
- Option B: find out whether TTS.ai has a cancel endpoint (`https://tts.ai/api`), and call it from
  `stop`. That needs a new function in `ttsApi.ts` and tests.
- Option C: keep the `jobId` of rows that were stopped and resume them on the next Generate All
  instead of resubmitting. Careful: this changes the "Unfinished files are back to Pending"
  behavior and its message.

### N7: Round Robin stability (owner decision)

- Today a row's voice is `selectedVoices[index % n]`, so removing row 1 changes every later
  row's voice and makes completed rows outdated.
- One option: count a completed row as up to date while its `generatedWith.speaker` is still in
  the pool (as Random Assignment does), and assign by position only to rows that need generating.
- That changes what "the rotation" guarantees, so it needs the owner's call. Update `isUpToDate`
  in `src/services/assignment.ts`, its tests, and the README.

### N8: Large batches

1. Measure first, with no credits: an MSW test or a local mock with 200+ rows, where status
   checks take simulated time.
2. If needed, check jobs in parallel with a limit (for example 4, like the ZIP), and/or cap the
   jobs in flight (submit more only as earlier ones finish).
3. Keep the rule: submits are never retried after network or server errors.
4. Find out TTS.ai's concurrency and rate limits per plan (CURRENT_STATE.md, Open question 6).

## Optional cleanups (any time)

- **N9 (owner decision):** Prettier with double quotes, semicolons and trailing commas, plus
  ESLint with `typescript-eslint` and the React Hooks rules. Add `npm run lint` and
  `npm run format`, and maybe a CI step. Reformat in a commit of its own. Line lengths vary today:
  most lines are under 110 characters, but 124 lines in `src/` and `scripts/` are longer than
  120, up to 542 (long Tailwind class strings and SVG paths). So pick a print width on purpose and
  expect some rewrapping.
- **N10:** load JSZip inside `downloadAllCompleted` with `await import("jszip")`. Check the build
  output (§10 of ARCHITECTURE.md) and that the ZIP tests still pass.
- **N11:** in `createItem` (`src/hooks/useQueue.ts`), use `crypto.randomUUID()` and remove `uuid`
  from `package.json`. It needs a secure context: HTTPS and `localhost` are fine. Node 22+ has
  it; check that it's also available in the jsdom test environment (run `npm test`) before
  removing the dependency.
- **N12:** move the duplicated `isRecord`/`readString` from `ttsApi.ts` and `session.ts` into
  `src/utils/`. Re-wrap the overlong line in the `SESSION_KEY` doc comment
  (`src/services/session.ts`). Resolve `.env` and `benchmark-results/` from the repository root in
  the benchmark, the way `make-icons.ts` uses `REPO_ROOT`.
- **N13:** a manual pass in a real browser with a real key: Play, Sample, Download, ZIP with a
  WAV voice (piper), Reset, a reload during generation, Stop, and a narrow window. Record what was
  checked, and when, in CURRENT_STATE.md.

## Long term: ideas that need the owner's input

1. **Other languages:** vet voices beyond French, or decide the app stays French-only and say so.
2. **Keeping work:** let the queue survive closing the tab (`localStorage` or IndexedDB), or add
   export/import of the word list and settings (CSV or JSON).
3. **Better samples:** say the row's own text at the row's speed. It would cost more per sample,
   and the cache would hit less often.
4. **Phones and tablets:** a layout for narrow screens instead of the 1,100 px table.
5. **A French interface,** for teachers and learners who prefer it.
6. **Audio options:** bitrate, normalizing loudness, trimming silence. None exists today, and
   none was requested.

## Definition of done (every task)

1. Behavior covered by tests that sit next to the code. Tests never call TTS.ai (MSW).
2. `npm test` and `npm run typecheck` pass. Run `npm run build` too if the build, dependencies or
   imports changed.
3. The README updated for anything users would notice (it's kept current, feature by feature).
4. These docs updated: CURRENT_STATE.md (state and date), DECISIONS.md (new decisions), NEXT_STEPS.md
   (mark the task done or remove it), and AGENT_CONTEXT.md if a convention changed.
5. Commit only when the owner asks. **Pushing to `main` deploys the live site.**
