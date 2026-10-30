# Agent Context

## TL;DR

- **Credits are real money.** Never make real TTS.ai calls without the owner's explicit go-ahead
  for that run. Tests must never reach the network (MSW fails unhandled requests).
- **Never expose the key.** Don't print, log or commit `.env`. Never set `VITE_TTS_API_KEY` in a
  build meant for others. CI is the only way to deploy.
- **A push to `main` deploys the live site** (GitHub Pages). Commit or push only when the owner
  asks.
- **Keep the "never pay twice" rules:**
  - submits retry only on 429;
  - rows already up to date are skipped;
  - interrupted jobs are resumed by job ID;
  - the `expire` and `downloaded` reducer actions check the link first.
- **Only `src/services/ttsApi.ts` talks to TTS.ai,** and **only `App.tsx` and hooks start side
  effects.** Components render props.
- **Keep lamejs (LGPL) out of the main bundle:** `wavToMp3.ts` is loaded only by the worker or
  through `import()`.
- **The README is user documentation** and changes in the same commit as the behavior. The
  README **TODO section belongs to the owner**, who also edits files during sessions. If
  something you didn't remove disappears, check `git diff` and ask before putting it back.
- **Conventions:**
  - strict TypeScript with `noUncheckedIndexedAccess`, `import type`, named exports;
  - plain-English comments that explain why;
  - friendly, actionable UI text;
  - tests next to the code, named as behavior sentences, with jsdom opted into per file.
- **Top gotchas:** the icon tests read `App.tsx`, `favicon.svg` and `index.html` as text;
  `App.test.tsx` wraps three functions with `vi.mock`; Vite inlines `VITE_*` at build time;
  TTS.ai answers identical requests from its cache, instantly and for free.
- **Before you finish:** `npm test` and `npm run typecheck` (plus `npm run build` if the build
  changed), and update the README, CURRENT_STATE.md, DECISIONS.md and NEXT_STEPS.md.

---

## About this document

What any agent or engineer should know **before changing anything** in this repository. It
covers the rules, how the owner works, coding conventions, constraints and gotchas. Last
reviewed 2026-10-29 at commit `b71afb5`.

[AGENTS.md](AGENTS.md) at the repository root points here. Claude Code and other coding agents
load that file on their own at the start of a session (see Gotcha 21).

## 1. Rules

1. **Don't spend credits on your own initiative.** Real TTS.ai requests (Generate All or Sample
   with a real key, `npm run benchmark:voices` without `--dry-run`, any new check script) need
   the owner's explicit approval each time. `--dry-run` is free.
2. **Protect the key.**
   - The local `.env` holds a real TTS.ai key. Don't `cat` it, and don't paste its value
     anywhere. To check whether it's set, print only the variable names (for example
     `sed -E 's/=.+/=<set>/' .env`).
   - `.env` is git-ignored; keep it that way.
   - A local `npm run build` with `.env` present compiles the key into `dist/`. Never upload or
     share a locally built `dist/`.
3. **Deploys happen through CI only.** `.github/workflows/deploy-pages.yml` builds with
   `VITE_TTS_API_KEY=""` and publishes on every push to `main`. The history shows work committed
   straight to `main`, so ask before committing or pushing.
4. **Keep the billing rules** (DECISIONS.md D-05, D-07, D-13, D-16):
   - never resubmit a job after a network or server error;
   - skip rows that are up to date;
   - resume interrupted jobs by `jobId`;
   - apply `expire`/`downloaded` only while the row still has the same link.
5. **Respect the module boundaries:** HTTP to TTS.ai only in `src/services/ttsApi.ts`; side
   effects only from `src/App.tsx` and `src/hooks/`; components stay presentational.
6. **Keep lamejs (LGPL-3.0) isolated** (D-17). Don't import `src/services/wavToMp3.ts`
   statically from anything in the main bundle. After a dependency or import change, check that
   `npm run build` still produces separate `mp3Worker-*.js` and `wavToMp3-*.js` files.
7. **Keep the docs true.**
   - The README describes behavior feature by feature, and the owner keeps it current in the
     same commit as the code.
   - Update CURRENT_STATE.md (with the date), DECISIONS.md (new decisions, same fields) and
     NEXT_STEPS.md (done or new tasks) when they change.
8. **The owner edits files too.** On 2026-10-26 the owner deleted a README TODO themselves, and
   an agent wrongly put it back. If a line is missing and you didn't remove it on purpose, check
   `git diff` and ask, or mention it, before restoring it.

## 2. Where to start reading

1. README.md (TL;DR, then "How it works": the feature-level behavior).
2. ARCHITECTURE.md §2 (module map), §5 (domain model), §6.3 (Generate All), §7 (TTS.ai API).
3. `src/types/queue.ts`, the domain types.
4. `src/App.tsx`, where every piece is wired together.
5. `src/hooks/useGeneration.ts` and `src/services/assignment.ts`, where credits are spent.
6. `src/services/ttsApi.ts`, the API client.
7. `src/utils/voices.ts`, the catalog data with its evidence comments.
8. CURRENT_STATE.md (limitations, debt, open questions) and NEXT_STEPS.md (what to do).

## 3. How the owner works

The evidence is `git log` (13 commits, 2026-10-23 → 2026-10-26) and notes from earlier sessions.

- **Sessions with an AI assistant.** Every commit ends with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Build, then review.** Features land in one commit, followed by code-review passes:
  "Fix code review findings…", "Fix the second code review's findings", "Fix the third…".
- **Commit messages:**
  - an imperative summary line ("Add …", "Fix …", "Hide …", "Replace …");
  - a body of short bullets grouped by theme, each saying what changed and why, including
    README changes;
  - the trailer line at the end.
- **The README is the product's documentation.** Each behavior change updates it in the same
  commit. Known issues and TODOs live there, and finished TODOs are removed. On 2026-10-29 the
  TODO list was empty.
- **Facts from the outside world are dated** in code comments and the README ("checked
  2026-10-25"), with the evidence ("Said the word 5 times, heard as English"). Keep doing this.
- **Environment:** Windows 11 with PowerShell and Git Bash, Node 25, `core.autocrlf=true`, so
  Git's "LF will be replaced by CRLF" warnings are normal. CI runs Ubuntu with Node 24.

## 4. Coding standards and conventions

There's no linter or formatter (CURRENT_STATE.md T7), so match the surrounding code exactly.

### 4.1 TypeScript

- **Strict.** `tsconfig.app.json` also sets `noUncheckedIndexedAccess`, which makes `array[i]`
  `T | undefined`. Handle it with `?? fallback` or a check. Use `as T` only when it's provably
  safe, for example `(channels[channel] as Int16Array)` right after creating the array.
  `noImplicitOverride` (write `override` in classes), `noImplicitReturns`, `noUnusedLocals`,
  `noUnusedParameters` and `noFallthroughCasesInSwitch` are on too.
- **`verbatimModuleSyntax`:** type-only imports need `import type { X }` or
  `import { type X }`.
- **No `any`.** Untrusted data is `unknown`, narrowed with guards (`isRecord`, `readString`,
  `readNumber`, `isSpeed`, `isStatus`, …).
- **Read-only constant data:** `ReadonlySet`, `ReadonlyMap`, `readonly T[]`, `Readonly<Record<…>>`.
- **Discriminated unions for results:** `GenerationPlan` (`{ ok: true, jobs } | { ok: false,
  errors }`), `JobStatusResult`.
- **Named exports only.** `App` is the single default export.
- **Constants** are `UPPER_SNAKE_CASE` at the top of the module, each with a comment saying why
  the value is what it is (`/** About 3 minutes: some voices wait that long in TTS.ai's queue. */`).
- **Long modules are split** by separator comments: `// ----…` / `// Title` / `// ----…`.

### 4.2 React

- Function components with an `XProps` interface, destructured in the signature. Use `useId()`
  for label and input pairs.
- **Memoized components:** `function XComponent(...)` plus `export const X = memo(XComponent);`
  with a comment saying why (see `SpeakerSettings`, `QueueTable`, `QueueRow`). Anything passed to
  them must be stable: `useCallback`, `useMemo`, the queue `actions`, state setters.
- **State lives in `App`** (and `useQueue`). There's no state library and no context.
  Components get data and callbacks as props.
- Derived data is computed with `useMemo` in `App` **once** and shared (for example
  `arrangedVoices`).
- Effects that start async work take an `AbortController` and abort it in their cleanup.

### 4.3 Services, async work and errors

- Long-running async functions take an `AbortSignal`. `wait(ms, signal)` **resolves** on abort
  and never rejects, so check `signal.aborted` afterwards.
- Throw or convert to `TtsApiError` (`toTtsApiError`). The UI shows `getErrorMessage(error)`, so
  messages must be user-facing.
- `localStorage` and `sessionStorage` access always goes inside `try/catch`. Browsers can block
  storage, and persistence is best-effort.
- Untrusted input (API replies, saved sessions) is parsed field by field. Drop the broken part,
  not the whole: one bad row, not the whole queue.

### 4.4 User-facing text

- Plain, friendly English, addressed to "you". Say what to do next ("Click Generate All to make
  it again.", "Pick one in the Speaker column, or switch to another assignment mode.").
- **Capitalization follows the neighbors:**
  - Title Case for section titles ("Bulk Import", "Speaker Settings"), mode names ("Single
    Speaker", "Round Robin") and the main action buttons ("Generate All", "Add To Queue",
    "Download All (ZIP)", "Clear Queue", "+ Add File", "Move Up").
  - Sentence case for smaller buttons ("Save key", "Use my own key", "Select all shown",
    "Download again", "Reset to 1.0×"), checkbox labels ("Tested voices only") and all other
    text.
- Counts use `pluralize(count, "file")`. Speeds are formatted `1.0×`. Use the ellipsis
  character `…` ("Saving…", "Choose a speaker…").
- Notices have a tone matching the outcome (`error`, `warning`, `info`, `success`), an optional
  title and short messages.
- Don't blame the user. Include the HTTP status for unexpected server errors ("error 503").

### 4.5 Comments and naming

- Comments explain **why**, in full sentences and plain words. Exported functions, constants and
  non-obvious interface fields get `/** … */` doc comments.
- Facts about TTS.ai or the voices carry a date and the evidence.
- Names are descriptive and domain-based: `planGeneration`, `isUpToDate`, `retainAudio`,
  `forgetHiddenSpeaker`, `resumableJobs`.

### 4.6 Styling

- Tailwind CSS 4 utility classes inline in JSX. The palette is slate for neutrals, blue-600
  primary, emerald for success, amber for warnings and "repeat", red for danger.
- Reuse `Button` (variants and sizes), `FIELD_CLASS` for inputs, `Section` for numbered cards,
  and `Notice` for messages.
- Accessibility: every control has a label or an `aria-label` that names its row ("Speaker,
  row 3"). Use `role="alert"` or `role="status"` for messages and `aria-live` where values
  change. Motion goes behind `motion-safe:`.

### 4.7 Tests

- Tests sit next to the code: `X.ts` → `X.test.ts`. Tests that need a DOM **start with**
  `// @vitest-environment jsdom`.
- **Names are behavior sentences:** "never resubmits after a server error, so a job can't be
  billed twice", "keeps the WAV when it can't be converted, rather than losing the audio".
- **Network:** register MSW handlers in the test itself. They're reset after each test, and
  unhandled requests **fail**. `API` resolves to `https://tts.test/v1`:

  ```ts
  import { http, HttpResponse } from "msw/http";
  import { server } from "../test/server";

  const API = `${import.meta.env.VITE_TTS_API_ORIGIN}/v1`;

  server.use(
    http.get(`${API}/voices/`, () => HttpResponse.json({ voices: [{ id: "FR", model: "melotts", name: "French", language: "fr" }] })),
    http.post(`${API}/tts/`, () => HttpResponse.json({ uuid: "job-1", status: "queued", credits_used: 11 })),
    http.get(`${API}/speech/results/`, () => HttpResponse.json({ status: "completed", result_url: "https://cdn.tts.ai/job-1/tts_output.mp3" })),
  );
  ```
- **Reset module-level state** in `beforeEach`: `sessionStorage.clear()`,
  `localStorage.clear()`, `clearAudioCache()`, `clearVoiceSamples()`.
- **jsdom can't play audio, create object URLs or follow downloads.** Stub
  `HTMLMediaElement.prototype.play`/`pause`, `URL.createObjectURL`/`revokeObjectURL` and
  `HTMLAnchorElement.prototype.click`, and spy on `window.confirm`, as `src/App.test.tsx` does.
- **No jest-dom.** Use `toHaveProperty("value", …)`, `toHaveProperty("checked", true)`,
  `not.toBeNull()`, and Testing Library queries by role and label.
- Fake timers are fine where timing matters (`useSessionSaver.test.ts`). Combined with MSW they
  need care (`advanceTimersByTimeAsync`).

### 4.8 Scripts (`scripts/`)

- Node runs them as TypeScript directly (type stripping). So import with **`.ts` extensions**,
  use only syntax that can simply be erased (**no `enum`, `namespace` or parameter
  properties**), and use `node:` imports.
- Run `main()` only behind `if (startedAsScript(import.meta.url))`, so tests can import the
  module.
- A script that spends credits must print an estimate and ask, and support `--dry-run` and
  `--yes`. It writes its output to a git-ignored folder.

### 4.9 Formatting

2-space indentation, double quotes, semicolons, trailing commas in multi-line literals and
calls. About 97% of lines are under 110 characters; long Tailwind class strings and SVG paths
are the exceptions.

## 5. Constraints

- **No backend.** Everything runs in the browser and the site is static files. It must work from
  a subfolder (`base: "./"` in `vite.config.ts`, relative links).
- **No secrets in the bundle.** `VITE_*` values are public once built.
- **TTS.ai is the only service,** reached at `https://api.tts.ai` (hosted) or through `/tts-api`
  (development and preview). Browser requests from other sites are allowed (checked 2026-10-25).
- **Cost:** 1, 2 or 4 credits per character by tier. Samples cost a few credits. Identical
  requests are free.
- **Licenses:** the app is MIT; lamejs is LGPL-3.0 and kept in its own files.
- **Node ≥ 22.22.2** (`engines`). CI uses Ubuntu, which is **case-sensitive**, so an import's
  case must match the file's even though Windows doesn't care.
- **Browser features degrade gracefully:** no Worker means converting on the page; no storage
  means no persistence (and the key kept in memory).

## 6. Gotchas

1. **Icon tests read source files as text.** `scripts/make-icons.test.ts` checks that:
   - `src/App.tsx` contains `d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4"` and
     `rounded-lg bg-blue-600`;
   - `public/favicon.svg` has the same path, `fill="#155dfc"` and `rx="9.6"`;
   - `index.html` links exactly `icon /favicon-32.png`, `icon /favicon.svg` and
     `apple-touch-icon /apple-touch-icon.png`, in that order;
   - the committed PNGs match `npm run icons` pixel for pixel.

   To change the header icon: update `ICON_PATH`, `ICON_BLUE` and `ICON_RADIUS` in
   `scripts/make-icons.ts`, then `favicon.svg`, then run `npm run icons` and commit the PNGs.
2. **`src/App.test.tsx` wraps `previewSpeaker`, `arrangeVoiceList` and `retainAudio`** with
   `vi.mock(...)` to count calls ("typing in Bulk Import doesn't re-render…", "audio memory").
   Renaming or moving them breaks those tests.
3. **`src/test/setup.ts` must switch axios to its fetch adapter before `ttsApi.ts` creates its
   instances.** That's why it runs as a `setupFiles` entry.
4. **MSW fails every unhandled request,** including the voice list each App test needs. Register
   handlers for everything a test triggers.
5. **TTS.ai answers identical requests from its cache** (same text, voice, model, speed,
   language): instantly, `credits_used: 0`, flagged `cached`. Don't mistake that for a fast
   voice. It's also why repeated samples are free.
6. **`/tts-api` exists only under `npm run dev` and `npm run preview`.** A production build
   without `VITE_TTS_API_ORIGIN` gets HTML back and shows `PROXY_HINT`.
7. **`VITE_*` values are inlined when building or starting the dev server.** After changing
   `.env`, restart `npm run dev`.
8. **Voice keys contain spaces, slashes and non-Latin text:** `cosyvoice2:French Female`,
   `bark:v2/fr_speaker_0`, `cosyvoice3:法文女`. Encode them before putting them in a URL or a
   filename.
9. **piper, vits and bark-small send WAV labeled `audio/mpeg`.** Look at the bytes
   (`isWavHeader`), not the MIME type.
10. **Settings are locked while generating, and resuming relies on it:** `resumableJobs`
    rebuilds a job's speed from the saved settings. Don't unlock speed or speaker settings
    during a run without changing that.
11. **The resume effect waits for the voice list.** That also keeps it clear of React
    StrictMode's development double mount, whose simulated unmount would abort the run. Don't
    move it to run on mount.
12. **`useSessionSaver` needs a memoized snapshot.** A new object on every render means a save
    on every render.
13. **Generate All clears a regenerated row's old audio link when the run starts,** not when the
    new file arrives. A stopped run leaves those rows without audio.
14. **`wait()` resolves (it doesn't reject) when aborted.** After awaiting it, check
    `signal.aborted`.
15. **The benchmark uses paths relative to the current folder** (`.env`, `benchmark-results/`).
    Run it through npm from the repository root. `make-icons.ts` resolves from the repository
    root itself.
16. **Saved sessions from older versions must keep loading.** Add tolerant parsing and
    migration in `src/services/session.ts` (as `parseVoiceList` does for the old `voiceOrder`)
    rather than bumping `SESSION_KEY` (`…:v1`). Bumping throws away every user's open queue.
17. **`HIDDEN_VOICES` is a map from key to name.** The name is still shown for old rows made with
    that voice, so a new entry needs one. Removing a key makes that voice reappear everywhere.
18. **Dates in comments and commits can be UTC.** The voice check is dated 2026-10-26, but its
    commit `41c06c3` is timed 2026-10-25 19:43 in UTC−5.
19. **`npm run build` overwrites `dist/`.** That's harmless locally, but with `.env` set it
    contains the key. To try a build safely, build into a scratch folder with
    `VITE_TTS_API_KEY=""`.
20. **Stop doesn't cancel TTS.ai jobs** (CURRENT_STATE.md, Known limitations 1), and **Round
    Robin follows row position** (Known limitations 2). Neither is a bug as built, but both cost
    credits.
21. **Don't add a `CLAUDE.md` or `CLAUDE.local.md` without importing `AGENTS.md`.**
    - Claude Code reads `AGENTS.md` only when no `CLAUDE.md`, `.claude/CLAUDE.md` or
      `CLAUDE.local.md` exists in the working directory or any folder above it. It also needs
      Claude Code v2.1.277 or later; the development machine had v2.1.314 on 2026-10-29.
    - To give Claude its own instructions, make a `CLAUDE.md` whose first line is `@AGENTS.md`
      (an import), with the rest below it.
    - Don't make `CLAUDE.md` a symlink: a Windows clone checks a symlink out as a plain text
      file.
    - Source: <https://code.claude.com/docs/en/memory>, read 2026-10-29.

## 7. Change cookbook

| Change | Edit | Also update |
| --- | --- | --- |
| Hide, show or re-test a voice | the sets in `src/utils/voices.ts` (`HIDDEN_VOICES` with a name, `TESTED_VOICES`, `FOLLOWS_SPEED`, `IGNORES_SPEED`), each entry with a dated evidence comment | `src/utils/voices.test.ts`, App tests ("hidden voices", "Follows speed sorting"); README "Voice quality", "Known issues" and the counts ("9 of the 17", "5 of the 8"); ARCHITECTURE.md §9; CURRENT_STATE.md |
| Change a price tier | `MODEL_TIERS` (with its source) in `src/utils/voices.ts` | README "Voice tiers"; ARCHITECTURE.md §9 |
| Add a Sort voices box | `VoiceListOptions`, `DEFAULT_VOICE_LIST`, `VOICE_LIST_CHECKBOXES`, `passesFilters`/`arrangeVoices`/`emptyListMessage` in `src/utils/voices.ts`; the hint list in `SpeakerSettings.tsx` | `parseVoiceList` picks up new keys from `DEFAULT_VOICE_LIST` by itself, so check it; tests; README "Sort voices" |
| Save a new setting in the session | `SessionSettings` and `parseSettings` (with a validator) in `src/services/session.ts`; in `App.tsx` a `useState` started from `saved?.settings.x`, the `snapshot` memo and its dependencies, and `handleReset` | `session.test.ts`, an App reload test; README "Session persistence" and "Reset" |
| Add a field to `QueueItem` | `src/types/queue.ts` (plus `QueueItemEdit` or `QueueItemProgress`), `parseItem` in `session.ts` (optional field with a type check), the reducer (and `RESET_GENERATION` if the field belongs to the audio) | `useQueue.test.ts`, `session.test.ts` |
| Add a speaker mode | `AssignmentMode` (types); `MODES` in `session.ts`; `previewSpeaker`, `resolveSpeaker`, `isUpToDate` and `validateSpeakerConfig` in `assignment.ts`; `MODES` in `SpeakerSettings.tsx`; `assignedSpeakerLabel` and `sampleVoiceFor` in `QueueTable.tsx` | `assignment.test.ts`, the SpeakerSettings tests, README |
| Call a new TTS.ai endpoint | a function in `src/services/ttsApi.ts` using `send(client, config, parseX, { signal, retryOn })` with `READ_RETRY`, or `SUBMIT_RETRY` if it creates anything billable; a `parseX` that checks every field | MSW tests in `ttsApi.test.ts`; ARCHITECTURE.md §7 |
| Change error wording | `fromAxiosError` and the parse messages in `ttsApi.ts`; other messages are next to where they're raised | tests that check messages (`ttsApi.test.ts`, App tests) |
| Change timing | `POLL_INTERVAL_MS`, `JOB_TIMEOUT_MS`, `MAX_CONSECUTIVE_POLL_FAILURES` (`useGeneration.ts`); `MAX_POLLS` (`voiceSample.ts`); `SAVE_DELAY_MS` (`useSessionSaver.ts`); the attempt limits and caps in `ttsApi.ts` | the README ("about every 1.5 s", "250 ms"); ARCHITECTURE.md §6–7 |
| Change the header or tab icon | see Gotcha 1 | the PNGs in `public/` |
| Add a dependency | `package.json` (keep `package-lock.json` in sync with `npm install`) | the bundle size (`npm run build`); the license (keep copyleft code isolated, and update README "License") |

## 8. Before you finish: checklist

- [ ] `npm test` passes (456+ tests on 2026-10-29), with no real network calls.
- [ ] `npm run typecheck` passes.
- [ ] `npm run build` succeeds, if the build, dependencies or imports changed. lamejs is still
      only in `mp3Worker-*.js` and `wavToMp3-*.js`.
- [ ] New behavior has tests next to its code, named as behavior sentences.
- [ ] The README is updated for anything users would notice.
- [ ] CURRENT_STATE.md, DECISIONS.md and NEXT_STEPS.md are updated (with dates).
- [ ] No credits spent without approval, the key isn't exposed, and nothing was committed or
      pushed unless the owner asked.

## 9. Glossary

| Term | Meaning |
| --- | --- |
| Row / queue item | One vocabulary entry: a `QueueItem`. It becomes one MP3. |
| Job | One TTS.ai generation request, identified by its `uuid` (`jobId`). |
| Voice key | `model:id`, the app's unique voice identifier (TTS.ai reuses IDs across models). |
| Offered voice | Present in `voicesByKey`: loaded from TTS.ai and not hidden. The language and Sort voices boxes only change what's displayed. |
| Pool | `SpeakerConfig.selectedVoices`: the voices for Random Assignment, and the rotation order for Round Robin. |
| Assignment mode | `single`, `perFile`, `random` or `roundRobin` (Single Speaker, Per File, Random Assignment, Round Robin). |
| `generatedWith` | The `{ speaker, speed }` that produced a row's current audio. |
| Up to date / outdated | A completed row whose `generatedWith` matches (or doesn't match) what the current settings would produce. |
| Resumed job | A job TTS.ai accepted before a reload, polled again instead of resubmitted. |
| Expired link | A result URL that now answers 404 or 410. The row becomes Failed. |
| Downloaded mark | `downloadedUrl === downloadUrl`: the amber **Download again** button. |
| Sample | A short real job ("Bonjour, ça va ?" at 1.0×) to hear a pending row's voice, cached per voice. |
| Tier | TTS.ai's price class: free (1 credit per character), standard (2), premium (4). |
| Tested / hidden voice | Passed the 2026-10-26 French checks / failed them (left out of the app). |
| Follows / ignores speed | Measured to change length with the speed setting / not. |
| Credits used | The sum of `credits_used` from this tab's submit replies. |
