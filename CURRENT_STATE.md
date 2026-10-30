# Current State

## TL;DR

- **Nothing is known to be broken.** On 2026-10-29: 456/456 tests passed (26 files), the type
  check passed, the production build succeeded, and the live site was up. The latest GitHub
  Pages deploy (run #6) succeeded.
- **Every planned feature exists:** Bulk Import, four speaker modes, Generate All with Stop,
  resuming after a reload, Play, Sample, Download, ZIP, the downloaded mark, WAV → MP3, the
  credit counter, the API key box, the Sort voices boxes and Reset. The README's TODO list is
  empty.
- **No real TTS.ai calls were made on 2026-10-29** (they cost credits). TTS.ai's real behavior
  was last checked by hand on 2026-10-25 and 2026-10-26.
- **Partial:** only French voices have been checked, and slow voices have been measured once but
  nothing in the app warns about them.
- **The only saved benchmark is misleading:** it was made before the fix for TTS.ai's reuse of
  identical requests, so only its first round is real. In that round the visible voices
  `qwen3-tts` (both) and `openvoice` were slow (more than 120 s and 49 s).
- **Biggest limitations:** Stop doesn't cancel jobs TTS.ai has already accepted (they may still
  be charged); removing a row in Round Robin makes later rows regenerate; status checks are
  sequential, so large batches are untested.
- **Biggest technical debt:** the billing-sensitive generation loop (`src/hooks/useGeneration.ts`)
  has no direct tests, and the voice checks behind `src/utils/voices.ts` can't be re-run from
  the repository.
- **Biggest external risk:** the hosted site works only while TTS.ai keeps allowing browser
  requests from other sites (CORS), keeps its API shape, and keeps its voice IDs.

---

## About this document

Status of the project as of **2026-10-29**, at commit `b71afb5` ("Fix the third code review's
findings") on `main`. That commit is in sync with `origin/main`; the documentation files from
the 2026-10-29 session were added on top. Update this file whenever the state changes, and keep
the date current.

## Snapshot

| Item | Value |
| --- | --- |
| Version | `0.1.0` (`package.json`, `"private": true`) |
| Branch | `main`, tracking `origin/main` (`https://github.com/SimonProgAI/vocab-audio-generator.git`) |
| Live site | <https://simonprogai.github.io/vocab-audio-generator/>, served on 2026-10-29 |
| Last deploy | GitHub Actions "Deploy to GitHub Pages" #6 for `b71afb5`, succeeded (2026-10-27 UTC). The first run (#1, 2026-10-25) failed; its cause isn't recorded. A manual run (#2) and every run since then succeeded. |
| History | 13 commits, 2026-10-23 → 2026-10-26, all with a Claude co-author. Three rounds of "code review findings" fixes. |
| Tests | 26 files, 456 tests, about 33 s (`npm test`, 2026-10-29) |
| Machine used for development | Windows 11, Node v25.2.1, npm 11.6.2. CI uses Ubuntu and Node 24. |
| Local-only files (git-ignored) | `.env` (holds a TTS.ai key for development; never print or commit it), `dist/`, `node_modules/`, `benchmark-results/` (one run, 2026-10-25) |

## How this was checked (2026-10-29)

| Check | Result |
| --- | --- |
| `npm test` | 26 files, 456 tests passed |
| `npm run typecheck` (`tsc -b`) | passed, no errors |
| `vite build` with CI's variables (`VITE_TTS_API_ORIGIN=https://api.tts.ai`, empty key), into a scratch folder | succeeded: `index-*.js` ≈ 430 KB (137 KB gzipped), `index-*.css` ≈ 30 KB, `mp3Worker-*.js` ≈ 165 KB, `wavToMp3-*.js` ≈ 164 KB |
| Built `index.html` | icon links rewritten to `./favicon-32.png` and so on, so they work under `/vocab-audio-generator/` |
| Local `dist/` (built 2026-10-26) | contains no copy of the `.env` key (searched for the key's value; only a count was printed) |
| Live site and the Actions page | the site answered; runs #2–#6 succeeded |
| Real TTS.ai requests | **not made** (they cost credits) |
| Manual testing in a browser | **not done** in this session |

---

## What is working

"Tests" means automated tests that use the MSW mock of TTS.ai. TTS.ai itself was checked by the
owner's sessions of 2026-10-25 and 2026-10-26.

| Feature | Main code | Evidence |
| --- | --- | --- |
| Bulk Import: one item per line, first spreadsheet column kept, Ctrl/Cmd+Enter; the text survives a reload | `src/components/BulkImport.tsx`, `src/App.tsx` | `BulkImport.test.tsx`, `App.test.tsx` "session persistence" |
| Queue editing: text, automatic or typed filename, per-row speed (Custom), per-row speaker, remove, **+ Add File** | `src/components/QueueRow.tsx`, `src/hooks/useQueue.ts` | `useQueue.test.ts`, `QueueRow.test.tsx` |
| The four speaker modes, their validation, the speaker preview in each row | `src/services/assignment.ts`, `src/components/SpeakerSettings.tsx`, `src/components/QueueTable.tsx` | `assignment.test.ts`, `SpeakerSettings.test.tsx` |
| Generate All: submit and poll, skipping up-to-date rows, flagging outdated ones | `src/hooks/useGeneration.ts`, `src/services/assignment.ts` | App tests run whole batches; **Stop, a 401 mid-run, the poll-failure limit and the 10-minute limit have no direct tests** |
| Errors, retries, parsing untrusted replies | `src/services/ttsApi.ts` | `ttsApi.test.ts` (30 tests) |
| Picking up interrupted jobs after a reload, without resubmitting | `src/services/session.ts`, `src/App.tsx` | `App.test.tsx` "checks on a generating row's job again after a reload…", `session.test.ts` |
| Session persistence: debounced saving, field-by-field checking, converting the old Sort voices value | `src/services/session.ts`, `src/hooks/useSessionSaver.ts` | `session.test.ts` (21), `useSessionSaver.test.ts`, App tests |
| Reset and Clear Queue | `src/App.tsx` | App tests "Reset", "Clear Queue" |
| Voice catalog: hidden, tested, speed labels, price tiers; the Sort voices boxes; language counts | `src/utils/voices.ts` | `voices.test.ts` (33), `SpeakerSettings.test.tsx`, `VoiceSelect.test.tsx`, App tests |
| Play, Sample, one clip at a time, media-key pauses | `src/hooks/useAudioPlayer.ts`, `src/services/voiceSample.ts` | `useAudioPlayer.test.ts`, `voiceSample.test.ts`, App tests "audio preview" |
| Download, Download All (ZIP), the downloaded mark, expired links (404/410) | `src/services/download.ts`, `src/services/audio.ts`, `src/App.tsx` | `download.test.ts`, `audio.test.ts`, App tests |
| WAV → MP3: worker, then on the page, else the original is kept | `src/services/audio.ts`, `src/services/wavToMp3.ts`, `src/services/mp3Worker.ts` | `wavToMp3.test.ts`, `audio.test.ts`, `mp3Worker.test.ts` |
| Credit counter, including samples | `src/utils/credits.ts`, `src/components/CreditCounter.tsx` | `credits.test.ts`, `CreditCounter.test.tsx`, App tests |
| API key box (this tab / Remember / Forget; falls back to the `.env` key) | `src/services/apiKey.ts`, `src/components/ApiKeySettings.tsx` | `apiKey.test.ts`, `ApiKeySettings.test.tsx`, App tests |
| Favicons that match the header icon | `scripts/make-icons.ts`, `public/` | `make-icons.test.ts` |
| Voice benchmark script | `scripts/benchmark-voices.ts` | `benchmark-voices.test.ts` (against MSW) |
| Deploying to GitHub Pages | `.github/workflows/deploy-pages.yml` | runs #2–#6 succeeded; the site is live |

---

## What is partially implemented

1. **Voice checks cover French only.** The hidden, tested and speed lists in
   `src/utils/voices.ts` contain only French voices. Every other language is untested: it's
   hidden while **Tested voices only** is ticked (the default), and has no speed labels. Price
   tiers are known for 14 models; any other model shows under "Price not known yet".
2. **Slow voices are measured but not handled.** The README's "Slow speakers" known issue is
   still open. The only measurement is round 1 of the 2026-10-25 benchmark (see [Benchmark data
   on record](#benchmark-data-on-record)). Nothing in the app labels or filters slow voices. A job
   fails only after 10 minutes (`JOB_TIMEOUT_MS` in `src/hooks/useGeneration.ts`).
3. **Speed control:** 5 of the 8 visible French voices ignore the speed setting. That's TTS.ai's
   behavior; the app labels them " · ignores speed". It's done as far as this app can go, but
   it limits the "slower speech for beginners" goal.

## What is currently broken

**Nothing is known to be broken** (2026-10-29). That rests on the checks above. Two things are
**unverified**:

- the app in a real browser against the real TTS.ai, since 2026-10-26;
- whether TTS.ai's voices, prices or CORS policy have changed since the checks of 2026-10-25 and
  2026-10-26. The README asks for periodic re-checks.

## Known limitations

Each of these was confirmed by reading the code on 2026-10-29. Most are deliberate or
unavoidable. The ones that may need a decision are in [Open questions](#open-questions) and
NEXT_STEPS.md.

1. **Stop doesn't cancel TTS.ai jobs.** `useGeneration`'s `stop` aborts the app's requests and
   puts unfinished rows back to pending without their `jobId`. Jobs TTS.ai has already accepted
   keep running and were already charged (`credits_used` comes back with the submit reply). The
   next Generate All submits those rows again. If TTS.ai has finished the identical job by then,
   it may answer from its cache for free; if not, it's unknown whether it charges again. The code
   has no cancel call, and whether TTS.ai offers one isn't recorded.
2. **Round Robin follows row position.** `previewSpeaker` uses `selectedVoices[index % n]`.
   Removing a row shifts the voice of every later row. Their completed audio becomes "outdated",
   and Generate All pays to make it again. Changing the pool or its order has the same effect.
3. **Changing any setting makes the affected completed rows outdated** (a new single speaker,
   global speed, pool or Per File speaker), and Generate All regenerates them. That's by design,
   but it costs credits. The old audio link is cleared as soon as the run *starts*, so a stopped
   run leaves those rows without audio.
4. **Status checks are sequential, and the number of jobs in flight isn't capped.**
   `pollUntilDone` checks every active job one after another, then waits 1.5 s. With N active
   jobs, a cycle takes N round trips plus 1.5 s. All rows are submitted as fast as replies come
   back. Behavior with hundreds of rows (speed, rate limits, TTS.ai's concurrency limits) hasn't
   been tested.
5. **A resumed job's 10-minute limit restarts at the reload** (`submittedAt: Date.now()` when it's
   picked up again).
6. **The session belongs to one tab** (`sessionStorage`). Closing the tab loses the queue, and a
   new tab starts empty. If storage is full or blocked, nothing persists, and the previous copy
   is deleted on purpose.
7. **Samples always say "Bonjour, ça va ?" at 1.0×,** whatever the row's text or speed. They're
   offered only for pending rows, and not in Random Assignment mode.
8. **If WAV conversion fails, the WAV is saved under a `.mp3` name.** `toMp3` keeps the original
   rather than lose the audio. Only a `console.warn` mentions it. Most players still play the
   file.
9. **How long result links last is unknown.** A link answering 404 or 410 marks the row Failed
   with "This file's audio link has expired…". Regenerating costs credits, unless TTS.ai answers
   from its cache.
10. **The credit counter counts only this tab's submissions.** TTS.ai's own balance
    (`credits_remaining`) lags behind, and the UI labels it as TTS.ai's figure.
11. **The ZIP includes outdated rows,** with whatever audio they currently have.
12. **The interface is in English only, and laid out for desktops.** The queue table has a
    minimum width of 1,100 px and scrolls sideways.
13. **Without a key, TTS.ai allows only limited anonymous use** of free voices. The exact limits
    aren't recorded here.

## Technical debt

| # | Debt | Where | Impact | Fix (NEXT_STEPS.md) |
| --- | --- | --- | --- | --- |
| T1 | No direct tests for the generation loop: Stop, a 401 ending the run, the 3-failure limit, the 10-minute limit, a rejected submit, resumed jobs never being resubmitted. This is the code that spends credits. | `src/hooks/useGeneration.ts` | Medium: a regression could double-bill or hang a run, unnoticed | N1 |
| T2 | No tests for `useVoices`; no test files for `ProgressPanel`, `Toolbar`, `QueueTable`, `StatusBadge`, `Notice`, `Section`, `Spinner`, `ErrorBoundary` (covered only through App tests) | `src/hooks/useVoices.ts`, `src/components/` | Low | N2 |
| T3 | The French-speech check (speech-to-text) and the speed check behind `HIDDEN_VOICES`, `TESTED_VOICES`, `FOLLOWS_SPEED` and `IGNORES_SPEED` were run by hand. No script in the repository can repeat them, and the speech-to-text endpoint isn't recorded. | `src/utils/voices.ts` comments | Medium: re-checking means redoing the work from scratch | N5 |
| T4 | The only saved benchmark was made by an older script that reused one phrase, so rounds 2–3 were TTS.ai cache hits | `benchmark-results/voices-2026-10-25T18-48-38.*` (git-ignored) | Low–medium: misleading data | N3 |
| T5 | Hard-coded catalog keyed by `model:id`. If TTS.ai renames a voice or model, its entry silently stops matching: a hidden voice reappears, or a tested one vanishes from the default view. | `src/utils/voices.ts` | Medium | N5 |
| T6 | Duplicated logic. The benchmark has its own HTTP and parsing code (on purpose, see DECISIONS.md D-19). `isRecord` and `readString` exist in both `ttsApi.ts` and `session.ts`. | `scripts/benchmark-voices.ts`, `src/services/` | Low | N12 (optional) |
| T7 | No ESLint or Prettier configuration; the style is kept by hand | repository root | Low: style drift | N9 (owner decision) |
| T8 | The main bundle is ≈ 430 KB (137 KB gzipped). JSZip loads even if Download All is never used. | `src/services/download.ts` | Low | N10 |
| T9 | The `uuid` dependency could be `crypto.randomUUID()` | `src/hooks/useQueue.ts` | Very low | N11 (optional) |
| T10 | `App.tsx` holds every handler (412 lines) | `src/App.tsx` | Low; split it if it keeps growing | — |
| T11 | The benchmark reads `.env` and writes `benchmark-results/` relative to the current folder, unlike `make-icons.ts`, which uses `REPO_ROOT` | `scripts/benchmark-voices.ts` | Very low: run it through npm from the repository root | N12 (optional) |
| T12 | One comment line in the `SESSION_KEY` doc comment is far longer than the rest | `src/services/session.ts` | Cosmetic | N12 (optional) |

## Known risks

| # | Risk | Likelihood / impact | What limits it today |
| --- | --- | --- | --- |
| R1 | **TTS.ai changes something:** CORS (the hosted build would need a proxy), the API's shape, voice or model IDs, prices, or its caching of identical requests | Medium / high | Replies are checked field by field and accept several field names; errors become plain-language notices; voice IDs are dated in comments |
| R2 | **Wasted credits:** Stop not cancelling (limitation 1), Round Robin shifting (2), regenerating after a setting change (3), a reload when storage failed (the job IDs are lost, so rows are submitted again) | Medium / medium | Submits are never retried after network or server errors; up-to-date rows are skipped; interrupted jobs are resumed; TTS.ai's cache makes identical repeats free |
| R3 | **The API key leaks:** a local `npm run build` with `.env` set compiles the key into `dist/`; a remembered key sits in `localStorage` on `<user>.github.io`, which every Pages site of the account shares; any script injected into the page could read it | Low / high | CI forces the key empty; the README warns; the app loads no third-party scripts and React escapes server text |
| R4 | **LGPL-3.0 obligations** if `@breezystack/lamejs` ends up in the main bundle (for example, through a static import) | Low / medium | It's imported only by `wavToMp3.ts`, which is loaded by the worker or a dynamic `import()` |
| R5 | **Very new toolchain:** TypeScript 7, Vite 8, Vitest 5, MSW 3, jsdom 30, React 19.3, with `^` ranges. Upgrades may break things. | Medium / low | `package-lock.json`; CI uses `npm ci` |
| R6 | **A push to `main` is a production release** (the Pages workflow) | — / medium | CI runs the tests before building |
| R7 | **Large batches** (hundreds of rows) untested against real limits | Unknown / medium | Rate-limit retries (up to 8 attempts, honoring `Retry-After`) |

## Open questions

These need the owner or more facts from TTS.ai. They're written down rather than assumed.

1. **Audience and goals:** is the app for the owner's own lessons, for other French learners and
   teachers, or both? Should it grow beyond French? (`index.html` and the header say "French
   Vocabulary"; the code supports any TTS.ai language.)
2. **Slow voices:** should they be labeled, filtered (as speed is), or warned about? At what
   threshold? (Needs fresh benchmark data, NEXT_STEPS.md N3.)
3. **Stop:** should the interface say that jobs TTS.ai already accepted may still be charged?
   Does TTS.ai have a cancel endpoint?
4. **Round Robin:** is "by row position" what users expect, or should a row keep its voice once
   generated, so removing rows doesn't regenerate others?
5. **Is the 10-minute job limit right?** In round 1 of the benchmark, cosyvoice2 took 96 s, and
   qwen3-tts and bark didn't finish within 120 s.
6. **TTS.ai's limits:** how many jobs can be in flight at once, what the rate limits are per
   plan, and how long result links stay valid. None of it is documented in the repository.
7. **Persistence:** should the queue survive closing the tab (for example in `localStorage` or
   IndexedDB), or be exportable and importable?
8. **Browser support:** which browsers matter? Nothing records testing in particular browsers or
   on phones.
9. **Formatting and linting:** should the project adopt Prettier and ESLint (which would mean a
   one-time reformat)?
10. **Re-checking voices:** how often, and should it be scripted (NEXT_STEPS.md N5)?

## Benchmark data on record

`benchmark-results/` is git-ignored. On the development machine it holds one run,
`voices-2026-10-25T18-48-38.csv` and `.jsonl` (the timestamp is UTC). That run was made by the
first version of the script, which repeated the same phrase in every round. Rounds 2 and 3 were
answered from TTS.ai's cache (0 credits, about 1.2 s each), so **the CSV's medians and
credits-per-character columns are meaningless**. The script was fixed in commit `7e30e88` and
hasn't been re-run since. Only round 1 measured anything: **one sample per voice, 11-character
French phrases, polled every 1 s, 120 s limit.**

| Voice (key) | Shown in the app? | Round 1 time | Credits (11 chars) | Notes |
| --- | --- | --- | --- | --- |
| `vits:css10_fr` | yes | 1.4 s | 0 | probably a cache hit already, so not a real timing |
| `piper:fr_FR-siwis-medium` | yes | 4.9 s | 11 (free) | |
| `kokoro:ff_siwis` | yes | 12.0 s | 11 (free) | |
| `pocket-tts:fantine_fr` | yes | 15.6 s | 11 (free) | |
| `pocket-tts:jean_fr` | no (hidden) | 16.2 s | 11 (free) | |
| `moss-tts-nano:default_fr` | no | 20.8 s | 22 (standard) | |
| `melotts:FR` | yes | 21.3 s | 11 (free) | |
| `openvoice:FR` | yes | 49.4 s | 44 (premium) | slow and expensive |
| `cosyvoice2:French Female` | no | 95.8 s | 22 (standard) | |
| `qwen3-tts:eric_fr` | yes | > 120 s (timed out) | 22 (standard) | slow |
| `qwen3-tts:vivian_fr` | yes | > 120 s (timed out) | 22 (standard) | slow |
| `cosyvoice3:法文女` | no | > 120 s (timed out) | 22 | |
| `bark-small:v2/fr_speaker_0` | no | > 120 s (timed out) | 22 | |
| `bark:v2/fr_speaker_0`, `bark:v2/fr_speaker_1` | no | > 120 s (timed out) | 22 each | |
| `moss-tts:default_fr` | no | error | — | HTTP 400 `model_disabled` |
| `zonos:french_male` | no | error | — | HTTP 400 `invalid_model` |

With n = 1, these are only a hint: a single slow round can be a busy moment or a cold start.
That's why NEXT_STEPS.md N3 asks for a re-run before any decision about slow voices.
