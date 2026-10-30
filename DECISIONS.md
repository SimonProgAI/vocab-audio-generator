# Decisions

## TL;DR

- **Browser only, no backend** (D-01). Visitors bring their own TTS.ai key, and the site is a
  static GitHub Pages build. That rules out a shared key and server costs, but the app depends on
  TTS.ai allowing browser requests from other sites.
- **Never pay twice** shapes most of the logic. Submits are never retried after network or server
  errors (D-05). Rows already up to date are skipped (D-07). Interrupted jobs are resumed by job
  ID instead of being resubmitted (D-13). Samples are cached (D-18).
- **Replies from TTS.ai and saved data are both untrusted:** every field is checked, with
  fallbacks and plain-language errors (D-04, D-12).
- **Voices are identified by `model:id`** (D-08), because TTS.ai reuses IDs across models.
- **Voice quality, speed behavior and price are hard-coded, dated data** from hands-on checks
  (D-09, D-10). The API doesn't provide them.
- **The Sort voices dropdown became four combinable checkboxes** (D-11). The list is worked out
  once in `App` and shared by every picker (D-26).
- **The session lives in `sessionStorage`** (per tab), saved 250 ms after changes stop and
  immediately on `pagehide` (D-12, D-14).
- **WAV becomes real MP3 in the browser** with lamejs (LGPL), isolated in its own files and run
  in a worker. The original audio is kept if anything fails (D-17).
- **Only 404 or 410 means a link expired**; a 403 might be temporary (D-16).
- **Tests can't reach the network** (MSW fails unhandled requests) and can't use the real key
  (D-23). The benchmark that spends credits asks first (D-19).
- **Global assumptions** about TTS.ai and the users are listed at the end
  ([Assumptions](#assumptions)). Check them when something behaves unexpectedly.

---

## About this document

The architectural and design decisions behind the app, why they were made, what they cost, and
what else was possible. Written on 2026-10-29 from the code, its comments and the commit history
(`git log`, 2026-10-23 → 2026-10-26).

**How to read "Alternatives":** *recorded* alternatives were actually tried or discussed (a
commit or a code comment shows it). *Not recorded* alternatives are listed only to show the
tradeoff; nothing says anyone considered them. When you make a new decision, add an entry here
with the same fields.

## D-01: Browser-only app with no backend; visitors bring their own TTS.ai key

- **Status:** in place. The first version (2026-10-23) used a `.env` key with the dev proxy.
  Public hosting arrived on 2026-10-25 in commit `f3bfb04`.
- **Context:** the app has to call a paid API. A key compiled into a public build would be
  readable by anyone (`VITE_*` variables are inlined).
- **Decision:** a static single-page app on GitHub Pages. Each visitor enters their own TTS.ai
  key. `VITE_TTS_API_KEY` remains only as a convenience for local development, and the workflow
  forces it empty.
- **Why:** no secret to protect, no server to run or pay for, and each visitor pays for their
  own usage.
- **Alternatives:** *not recorded:* a small proxy server holding a shared key (cost and abuse
  risk, plus hosting); a serverless function (same tradeoff).
- **Consequences:** the app depends on TTS.ai's CORS policy (D-03). Without a key, visitors get
  only TTS.ai's limited anonymous access. All state is client-side.
- **Where:** `src/services/apiKey.ts`, `src/components/ApiKeySettings.tsx`,
  `.github/workflows/deploy-pages.yml`, README "Environment" and "Deploying to GitHub Pages".

## D-02: The key stays in the browser, for the tab by default, on the device with Remember

- **Status:** in place (`f3bfb04`).
- **Decision:**
  - The key goes in `sessionStorage` by default, or `localStorage` when **Remember on this
    device** is ticked, and always in exactly one of the two: saving first forgets it everywhere,
    so unticking Remember removes it from the device.
  - If storage is blocked, it's kept in memory for the page's lifetime.
  - An axios interceptor reads it on every request, so a change applies at once.
  - **Reset** leaves the key alone ("the key isn't part of the work"); **Forget** removes it.
  - The UI shows only the last four characters.
- **Why:** visitors shouldn't have to re-enter the key all the time, but a remembered key should
  be a deliberate choice.
- **Alternatives:** *not recorded:* always `localStorage` (riskier on shared machines); never
  storing it (tedious).
- **Consequences:** a remembered key lives in `localStorage` for `<user>.github.io`, which every
  GitHub Pages site of the same account shares. The README says so.
- **Where:** `src/services/apiKey.ts`, `src/App.tsx` (`handleSaveKey`, `handleForgetKey`,
  `handleReset`).

## D-03: The Vite proxy in development; TTS.ai called directly when hosted

- **Status:** in place. Hosted direct calls since `f3bfb04`, after a check on 2026-10-25 that
  TTS.ai accepts browser requests from any site.
- **Decision:** `VITE_TTS_API_ORIGIN` decides where requests go. The default, `/tts-api`, is a
  same-origin proxy in `vite.config.ts` for `npm run dev` and `npm run preview`. The Pages build
  sets `https://api.tts.ai`. Result links on `https://api.tts.ai/` (and relative ones) are
  rerouted through the same origin (`routeThroughApiOrigin`).
- **Why:** the proxy avoids any CORS trouble in development, including for audio downloads.
  Hosted builds need no server because TTS.ai allows cross-origin requests.
- **Consequences:** a production build made *without* the variable calls `/tts-api`, gets an
  HTML page back, and shows `PROXY_HINT` ("set VITE_TTS_API_ORIGIN"). If TTS.ai ever drops
  CORS, the hosted site needs a proxy.
- **Where:** `vite.config.ts` (`ttsProxy`), `src/services/ttsApi.ts` (`API_ORIGIN`,
  `routeThroughApiOrigin`, `PROXY_HINT`), `.env.example`.

## D-04: One module talks to TTS.ai; its replies are untrusted

- **Status:** in place since the first commit.
- **Decision:**
  - `src/services/ttsApi.ts` is the only code that sends requests to TTS.ai (`getVoices`,
    `submitJob`, `getJobStatus`, `downloadAudio`).
  - Every reply is checked field by field, accepting several names where TTS.ai's replies vary
    (`uuid`/`job_id`, `result_url`/`url`/`audio_url`, `language`/`lang`, `id`/`voice_id`) and
    mapping many status words onto five statuses.
  - Errors become a `TtsApiError` with a `kind` (`auth`, `rateLimit`, `network`, `server`,
    `request`, `invalidResponse`, `aborted`, `unknown`), the HTTP `status`, and a plain-language
    message that says what to do next.
- **Why:** one place for retries, the key, the base URL and error wording. TTS.ai's replies
  aren't formally specified, and the app should degrade gracefully when they change.
- **Consequences:** new endpoints belong in this module. The UI shows `getErrorMessage(error)`
  directly, so messages must stay user-facing.
- **Where:** `src/services/ttsApi.ts`, `src/services/ttsApi.test.ts`.

## D-05: Submits are never retried after a network or server error

- **Status:** in place since the first commit; the benchmark follows it too.
- **Decision:** reads (voices, status, audio) retry `rateLimit`, `network` and `server` errors:
  up to 8 attempts for 429, 3 for the others. The wait is exponential from 1 s, capped at 60 s,
  and honors `Retry-After` / `X-RateLimit-Reset`. **Submits retry only 429.**
- **Why:** after a timeout or a 5xx, TTS.ai may already have created the job, and resending it
  could create and bill a duplicate. A 429 means the job wasn't created.
- **Alternatives:** *not recorded:* idempotency keys (TTS.ai isn't known to support them).
- **Consequences:** a temporary network glitch during a submit fails that row ("Couldn't reach
  TTS.ai…"), and the user has to click Generate All again.
- **Where:** `READ_RETRY`, `SUBMIT_RETRY`, `send`, `retryDelayMs` in `src/services/ttsApi.ts`;
  `send` in `scripts/benchmark-voices.ts`.

## D-06: Submit one job at a time while polling all of them

- **Status:** in place since the first commit. Resuming was added in `7e30e88`.
- **Decision:** `useGeneration.run` runs two loops side by side.
  - `submitAll` sends one job at a time.
  - `pollUntilDone` checks every active job, one after another, then waits 1.5 s.
  - A 401 anywhere aborts the whole run, because every other request would fail too.
  - Three failed status checks in a row fail a row. So does still running after 10 minutes.
  - Stop aborts everything and puts unfinished rows back to pending.
- **Why:** early files finish while later ones are still being submitted. Submitting one at a
  time stays gentle on rate limits.
- **Alternatives:** *not recorded:* submitting everything first, then polling (slower first
  results); parallel submits (more 429s); TTS.ai webhooks or batch endpoints (unknown whether
  they exist).
- **Consequences:** status checks are sequential, and the number of jobs in flight isn't capped,
  so large batches are untested (CURRENT_STATE.md, Known limitations 4). Stop can't cancel jobs
  on TTS.ai's side (Known limitations 1).
- **Where:** `src/hooks/useGeneration.ts`, `summarizeRun` in `src/App.tsx`.

## D-07: Generate only what isn't up to date

- **Status:** in place since the first commit.
- **Decision:**
  - A completed row stores `generatedWith = { speaker, speed }`. `isUpToDate` compares it with
    what the current settings would give (§5.4 of ARCHITECTURE.md), and `planGeneration` skips
    rows that match.
  - Completed rows that don't match are shown as "Settings changed — Generate All will redo it."
  - Editing a row's text resets it right away, because its audio now says the wrong thing.
    Speaker and speed changes are only detected; they don't reset anything.
- **Why:** Generate All can always be pressed safely. It does the minimum, and retries failed
  rows.
- **Consequences:** Random Assignment counts a row as up to date while its voice is still in the
  pool. Round Robin goes by row position, so removing a row shifts the voice of the rows after
  it (CURRENT_STATE.md, Known limitations 2).
- **Where:** `src/services/assignment.ts`, `applyEdit` in `src/hooks/useQueue.ts`, `outdatedIds`
  in `src/App.tsx`.

## D-08: A voice is identified by `model:id`

- **Status:** in place since the first commit.
- **Context:** TTS.ai reuses voice IDs across models (for example `FR` for both melotts and
  openvoice).
- **Decision:** `Voice.key = "model:id"`, or the bare id when a voice has no model. It's used
  everywhere inside the app (settings, rows, catalog lists). Only the raw `id` and `model` are
  sent to TTS.ai.
- **Consequences:** keys can contain spaces, slashes and non-Latin text
  (`cosyvoice2:French Female`, `bark:v2/fr_speaker_0`, `cosyvoice3:法文女`). Saved sessions refer
  to voices by key.
- **Where:** `parseVoices` in `src/services/ttsApi.ts`, `src/types/queue.ts`.

## D-09: A hard-coded, dated catalog of voice quality and speed behavior

- **Status:** in place. Hidden and speed lists since `41c06c3`; bark-small hidden in `3d5edd8`;
  the tested list made explicit in `c774fb0`.
- **Context:** the voice list says nothing about whether a voice speaks French well or follows
  the speed setting. Some French voices added words, repeated or garbled the text, or always
  failed. Most ignored speed.
- **Decision:** constant sets in `src/utils/voices.ts`: `HIDDEN_VOICES` (9, with names kept for
  old rows), `TESTED_VOICES` (8), `FOLLOWS_SPEED` (3), `IGNORES_SPEED` (5). Each entry has a
  comment recording what was observed.
  - Checks on 2026-10-26: speech-to-text (Whisper on TTS.ai) of a word and a sentence;
    "une rivière" timed at 0.5×, 1× and 2×.
  - Voices nobody has checked aren't assumed to follow speed.
- **Why:** it's the only reliable information available, and dating it shows when it may be
  stale.
- **Alternatives:**
  - *recorded:* vits was kept even though speech-to-text detected its word as Turkish, because
    the transcription was right once French was specified. bark-small passed the speech check
    but was hidden later (abrupt endings, ignores speed, slow).
  - *recorded:* "tested" used to be inferred from the speed results; it became its own list in
    `c774fb0` so the two meanings can't drift apart.
  - *not recorded:* checking automatically at runtime (it would cost credits on every visit).
- **Consequences:** the lists need re-checking by hand as TTS.ai changes its models (README,
  Known issues). The checks aren't scripted (CURRENT_STATE.md T3). A renamed voice silently
  drops out of the lists (T5).
- **Where:** `src/utils/voices.ts`, `forgetHiddenSpeaker` and `parseConfig` in
  `src/services/session.ts`, `useVoices`.

## D-10: Price tiers are mapped per model and measured, not taken from the docs

- **Status:** in place (`47f907b`).
- **Decision:** `MODEL_TIERS` maps a model to free (1 credit per character), standard (2) or
  premium (4). The values come from `credits_used` ÷ text length in the 2026-10-25 benchmark,
  plus TTS.ai's docs for vits, tortoise and chatterbox. Any other model is "Price not known yet".
- **Why:** the voice list has no price field.
- **Alternatives:** *recorded:* the docs list kokoro as standard, but it was charged 1 credit
  per character, so the measured value won.
- **Where:** `MODEL_TIERS`, `voiceTier`, `TIER_LABELS` in `src/utils/voices.ts`.

## D-11: "Sort voices" is four combinable checkboxes

- **Status:** in place since `4e197fe` (2026-10-25). It replaced a dropdown.
- **Decision:** **Tested voices only**, **Price, low to high**, **Responds to speed control** and
  **By name (A–Z)** combine and apply to every speaker list. Defaults (a first visit and Reset):
  Tested voices only + By name. With By name off, voices keep TTS.ai's order; the list is no
  longer sorted beforehand.
- **Why:** the dropdown couldn't combine choices (for example "speed-following voices by price",
  which had been a separate dropdown option).
- **Alternatives:** *recorded:* the dropdown with `name`, `tier` and `followsSpeed` options.
  Saved sessions that still have `voiceOrder` are converted, through a `Map` lookup so values
  like `constructor` can't sneak in (`c774fb0`).
- **Consequences:**
  - A list can end up empty, so it explains which box emptied it.
  - Voices picked before a box hid them must stay visible, so they can be unticked ("Selected,
    but hidden…" in the pool; the chosen voice first in a select).
  - Language counts follow the boxes ("English (0 of 40)").
- **Where:** `src/utils/voices.ts` (`VoiceListOptions`, `arrangeVoices`, `arrangeVoiceList`,
  `emptyListMessage`), `src/components/SpeakerSettings.tsx`, `src/components/VoiceSelect.tsx`,
  `parseVoiceList` in `src/services/session.ts`.

## D-12: Persist the session in `sessionStorage`, and check it field by field

- **Status:** in place (`47f907b`, refined in `7e30e88` and `c774fb0`).
- **Decision:**
  - One JSON snapshot under `french-vocab-audio:session:v1`: rows, the Bulk Import text (even
    before it's added), the settings and the credit count.
  - On load, `parseSession` drops invalid rows and duplicate IDs, drops broken optional fields
    rather than whole rows, leaves out invalid settings (so they fall back to defaults), removes
    voices hidden since the save, and converts old fields.
  - Storage errors never break the app. A failed save deletes the previous copy, so a reload
    can't bring back a stale queue.
  - Bump the version in the key only for incompatible changes. Prefer tolerant parsing and
    migration, as with `voiceOrder` → `voiceList`.
- **Why:** a refresh or an accidental back navigation shouldn't lose a long word list. The data
  belongs to the tab's work, not the device.
- **Alternatives:** *not recorded:* `localStorage` (would survive closing the tab but leak
  between tabs); IndexedDB (more work, but could hold audio).
- **Consequences:** closing the tab loses the queue. Audio isn't stored (links are refetched).
- **Where:** `src/services/session.ts`, `src/App.tsx` (`useState(loadSession)`, `snapshot`).

## D-13: Resume interrupted jobs by job ID instead of restarting them

- **Status:** in place since `7e30e88`. Before that, rows that were generating during a reload
  went back to Pending.
- **Decision:**
  - Rows saved as queued or processing keep their `jobId` and `speaker`. After the reload, once
    the voice list has answered, `generation.run([], resumable)` polls those jobs without
    submitting them again.
  - Their speed is taken from the saved global speed or the row's own speed. Settings are locked
    while generating, so that's the speed the job was sent with.
  - A row without a job ID or speaker restarts as pending.
- **Why:** restarting meant paying again for jobs that might still finish.
- **Alternatives:** *recorded:* restarting as pending (the earlier behavior).
- **Consequences:**
  - The 10-minute limit restarts at the reload.
  - The resume waits for the voice list, which also keeps it out of React StrictMode's
    development double mount (that mount's simulated unmount would abort the run).
- **Where:** `restoreInterrupted` in `src/services/session.ts`; `resumableJobs` and the resume
  effect in `src/App.tsx`; `ResumedJob` in `src/hooks/useGeneration.ts`.

## D-14: Save 250 ms after changes stop, and at once when the page goes away

- **Status:** in place since `7e30e88`. Before that, `App` saved the whole session in an effect
  after every change.
- **Decision:** `useSessionSaver` waits 250 ms after the last change. `pagehide` (which a refresh
  fires) and unmounting save anything still unsaved right away.
- **Why:** serializing the whole queue on every keystroke or progress update was wasteful. 250 ms
  covers a burst of typing and loses little if the tab crashes.
- **Alternatives:** *recorded:* saving on every change (the earlier behavior). *Not recorded:*
  `beforeunload` (less reliable on mobile than `pagehide`).
- **Consequences:** the snapshot passed in must be memoized, because a new object counts as a
  change.
- **Where:** `src/hooks/useSessionSaver.ts`, `snapshot` in `src/App.tsx`.

## D-15: One in-memory audio cache per URL, shared by Play, Download and the ZIP

- **Status:** in place (`47f907b`; pruning added in `7e30e88`).
- **Decision:** `loadAudio(url)` caches the *promise* of the converted file, so overlapping loads
  share one request. Failures are dropped from the cache, so trying again refetches. An `App`
  effect calls `retainAudio` with the links rows still have, which frees removed, cleared or
  regenerated files.
- **Why:** each file is fetched and converted at most once, and memory follows the queue.
- **Where:** `src/services/audio.ts`, the `retainAudio` effect in `src/App.tsx`.

## D-16: Only 404 or 410 means a link expired, and expiring is guarded

- **Status:** in place since `7e30e88`.
- **Decision:** `isExpiredAudioError` is true only for 404 and 410. An expired link, found by
  Play, Download or the ZIP, turns the row Failed with `EXPIRED_AUDIO_MESSAGE`, but only if the
  row still has that link (the `expire` action). A 403 is only reported.
- **Why:** TTS.ai doesn't say how long links last. A 403 can be temporary, and treating it as
  expired would throw away a working file and pay to make it again. The guard stops a late
  failure from wiping a row that was regenerated in the meantime.
- **Alternatives:** *recorded:* counting 403 as expired too (changed in `7e30e88`).
- **Where:** `src/services/audio.ts`, `expire` in `src/hooks/useQueue.ts`, `reportAudioError`
  and `handleDownloadAll` in `src/App.tsx`.

## D-17: Convert WAV to MP3 in the browser, with the encoder isolated

- **Status:** in place since `f2861b7`; the worker was added in `c774fb0`.
- **Context:** piper, vits and bark-small return WAV labeled `audio/mpeg` even when MP3 is
  requested, so files saved as `.mp3` weren't really MP3.
- **Decision:**
  - Detect WAV by its header. Convert it to 64 kbps MP3 with `@breezystack/lamejs`, in a Web
    Worker (`mp3Worker.ts`), or on the page through a dynamic `import()` where workers aren't
    available. If anything fails, keep the original.
  - Float audio above full scale is turned down to fit rather than clipped (bark-small peaks
    around 1.7×). NaN or infinite samples count as silence. A declared data size of 0 means
    "read to the end". A WAV without samples fails instead of becoming silent.
- **Why:** every saved `.mp3` should really be MP3. The worker keeps a big ZIP from freezing the
  page. lamejs is LGPL-3.0: keeping it in separate files (`assets/mp3Worker-*.js`,
  `assets/wavToMp3-*.js`) means it can be replaced without touching the rest of the app.
- **Alternatives:** *recorded:* converting on the page only (before `c774fb0`); converting voice
  samples too (dropped in `c774fb0`, since samples are only played). *Not recorded:* WebCodecs or
  `MediaRecorder` (uneven browser support); requesting another format from TTS.ai (it ignored
  the format for these models).
- **Consequences:** about 165 KB of encoder per copy, loaded only when a WAV appears. If
  conversion fails, the saved `.mp3` is really WAV (CURRENT_STATE.md, Known limitations 8).
  Don't import `wavToMp3.ts` statically from main-bundle code.
- **Where:** `src/services/audio.ts`, `src/services/wavToMp3.ts`, `src/services/mp3Worker.ts`,
  `src/services/wavHeader.ts`; README "License".

## D-18: Voice samples are short real jobs, cached for the session

- **Status:** in place (`47f907b`, refined in `7e30e88` and `c774fb0`).
- **Decision:** TTS.ai has no preview clips, so **Sample** submits "Bonjour, ça va ?" at 1.0×
  (a few credits), polls for about 3 minutes at most, and caches the audio per voice key.
  Stopping stops the polling but keeps the job ID, so asking again checks on the same job.
  Samples are only played, so they aren't converted to MP3. Reset clears them.
- **Why:** hearing a voice before committing a whole batch to it is worth a few credits, and
  TTS.ai answers identical requests again for free.
- **Consequences:** there's no Sample in Random Assignment mode, where the voice is picked at
  generation, and none for rows that aren't pending.
- **Where:** `src/services/voiceSample.ts`, `handleSample` in `src/App.tsx`, `QueueRow`.

## D-19: The benchmark is a standalone script that asks before spending

- **Status:** in place (`47f907b`, fixed in `7e30e88`).
- **Decision:**
  - `scripts/benchmark-voices.ts` has its own small `fetch` client rather than using
    `src/services/ttsApi.ts`.
  - It prints the voices and a cost estimate and asks; `--yes` skips the question, and
    `--dry-run` stops after the estimate.
  - Each run uses the voice's next phrase from 16 of 11 characters, and replies TTS.ai reused
    aren't timed.
  - Jobs run one at a time in a new random order each round. Timeouts count as the timeout in
    the median ("≥").
  - Results are appended to `benchmark-results/` (git-ignored) as they come in.
- **Why:** `ttsApi.ts` depends on Vite (`import.meta.env`), and its retries would skew timings.
  Credits are real money. TTS.ai returns cached audio instantly for identical requests, which
  made the first version's later rounds meaningless.
- **Alternatives:** *recorded:* one phrase reused in every round (the first version, fixed in
  `7e30e88`); `import.meta.main` to detect being run as a script (replaced by `startedAsScript`,
  which works on older Node and through folder junctions, `b71afb5`).
- **Consequences:** some logic is duplicated (`primaryLanguage`, parsing helpers). It must be run
  from the repository root, because `.env` and `benchmark-results/` are relative paths.
- **Where:** `scripts/benchmark-voices.ts`, `scripts/startedAsScript.ts`.

## D-20: Credits are counted in the app

- **Status:** in place (`47f907b`).
- **Decision:** add up `credits_used` from every submit reply in this tab (generation and
  samples). Show the latest `credits_remaining` separately, labeled as TTS.ai's own figure. The
  count is saved with the session and cleared by Reset.
- **Why:** TTS.ai has no balance endpoint, its `credits_remaining` didn't drop while jobs were
  charged, and it sends no `X-RateLimit-*` headers (all checked 2026-10-25).
- **Where:** `src/utils/credits.ts`, `recordSubmitted` in `src/App.tsx`,
  `src/components/CreditCounter.tsx`.

## D-21: "Downloaded" is tied to the exact link that was saved

- **Status:** in place since `9f3a923` (2026-10-26).
- **Decision:** saving a file sets `downloadedUrl = downloadUrl`. The row counts as downloaded
  only while the two are equal. The button becomes the amber `repeat` variant and reads
  **Download again**.
- **Why:** regenerating gives a new link, which clears the mark without any extra bookkeeping.
  Rows left out of the ZIP, and failed downloads, aren't marked.
- **Where:** `wasDownloaded` in `src/services/download.ts`, `downloaded` in
  `src/hooks/useQueue.ts`, `QueueRow`, the `repeat` variant in `Button`.

## D-22: Filenames and the ZIP

- **Status:** in place since the first commit.
- **Decision:**
  - `slugify` lowercases the text and strips accents (NFD, then removes combining marks). It
    expands œ, æ and ß, removes characters illegal on Windows, macOS or Linux and control
    characters, caps the length at 100, turns everything that isn't a letter, digit or hyphen
    into `_`, and trims `_` and `-` from the ends.
  - Typed filenames are only sanitized.
  - In the ZIP, duplicate names get `_2`, `_3`, … (compared without regard to case).
  - The ZIP uses JSZip's STORE mode, with 4 downloads at a time.
- **Why:** filenames must be safe on every OS and readable for French. Case-insensitive
  filesystems would otherwise overwrite files. MP3 doesn't compress further.
- **Where:** `src/utils/slugify.ts`, `toMp3Name`, `uniqueName` and `downloadAllCompleted` in
  `src/services/download.ts`.

## D-23: Tests never touch the network or the real key

- **Status:** in place since `f0c92f6` (2026-10-25).
- **Decision:**
  - Vitest, with MSW answering requests. `onUnhandledFrame: "error"` fails any request that has
    no handler.
  - `vite.config.ts` overrides the key and origin with `test-key` and `https://tts.test`, a
    reserved domain that never resolves.
  - axios is switched to its fetch adapter, so blob responses work under Node.
  - Tests sit next to their code. DOM tests opt into jsdom with a first-line comment.
  - Test names are plain-English sentences about behavior.
- **Why:** running the tests must never spend credits or leak the developer's key, and the suite
  has to pass in CI.
- **Where:** `vite.config.ts`, `src/test/setup.ts`, `src/test/server.ts`.

## D-24: Icons are drawn by a script and tested against the header

- **Status:** in place since `49d9146`, hardened in `b71afb5`.
- **Decision:** `public/favicon.svg` repeats the header icon's shapes. `npm run icons` draws the
  PNGs (32 px rounded, 180 px square) with a small rasterizer and PNG encoder. The tests check
  that:
  - the committed PNGs' **pixels** match what the script draws;
  - `App.tsx`, `favicon.svg` and the script share the same path, blue and corner radius;
  - `index.html` links the icons in the right order.
- **Why:** the tab icon has to match the header without anyone remembering to redraw it.
- **Alternatives:** *recorded:* comparing file bytes. The third code review pointed out that
  another Node's zlib (CI runs 24) can compress identical pixels differently and fail the build,
  so `b71afb5` switched to comparing pixels. It hadn't actually failed: Actions run #5 passed.
- **Where:** `scripts/make-icons.ts`, `scripts/make-icons.test.ts`, `public/`, `index.html`, the
  header in `src/App.tsx`.

## D-25: Node 22.22.2+; scripts run as TypeScript with no build step

- **Status:** in place (`engines` added in `b71afb5`).
- **Decision:** `engines.node >= 22.22.2`, the minimum for Vitest and jsdom. CI uses Node 24.
  Scripts run with Node's built-in type stripping, so they import with `.ts` extensions and use
  only syntax that can simply be erased (no `enum`, `namespace` or parameter properties).
- **Why:** no extra tooling (ts-node, tsx or a build step) for two small scripts.
- **Where:** `package.json`, `tsconfig.node.json`, `scripts/`.

## D-26: Render performance: memoize the heavy parts, arrange voice lists once

- **Status:** in place since `7e30e88` and `c774fb0`.
- **Decision:** `SpeakerSettings`, `QueueTable` and `QueueRow` are `memo` components with stable
  callbacks. `arrangeVoiceList` runs once in `App` (with one shared `Intl.Collator`) and every
  picker gets the result.
- **Why:** typing in Bulk Import re-renders `App` (the draft is App state so it can be saved), and
  long voice lists in every row made that slow.
- **Where:** `src/App.tsx`, `src/components/SpeakerSettings.tsx`,
  `src/components/QueueTable.tsx`, `src/components/QueueRow.tsx`. Protected by the App test
  "typing in Bulk Import".

## D-27: UI conventions: Tailwind utilities and accessible controls

- **Status:** in place.
- **Decision:**
  - Tailwind CSS 4 utility classes directly in the JSX, plus shared pieces: `Button` with
    variants, `FIELD_CLASS`, `Section`, `Notice`.
  - Buttons react on hover and press only when enabled. The press-down is left out for people
    who ask their system for less motion (`motion-safe`), and is in place since `9f3a923`.
  - Inputs have labels or `aria-label`s that name their row ("Speech text, row 3"). Notices use
    `role="alert"` or `role="status"`. The progress bar has `role="progressbar"`.
  - Destructive actions ask with `window.confirm`.
- **Why:** consistency with little code, and it keeps the app usable by keyboard and screen
  readers (the tests find elements by label and role).
- **Where:** `src/components/`, `src/index.css`.

## D-28: `AGENTS.md` is the single entry point for coding agents

- **Status:** in place since 2026-10-29 (added at the owner's request, after the documentation
  session).
- **Decision:** a short `AGENTS.md` at the repository root sends agents to AGENT_CONTEXT.md,
  CURRENT_STATE.md and NEXT_STEPS.md, and names the three most important rules. There's no
  `CLAUDE.md`.
- **Why:**
  - One file serves Claude Code, which reads `AGENTS.md` on its own from v2.1.277 when there's
    no `CLAUDE.md` (per <https://code.claude.com/docs/en/memory>, read 2026-10-29). It also
    serves other tools that follow the `AGENTS.md` convention.
  - It's a pointer rather than an `@AGENT_CONTEXT.md` import because an import would load all of
    AGENT_CONTEXT.md (≈ 370 lines) into every Claude session (Claude's guidance is under 200
    lines), other tools don't expand imports, and repeating the content would let two copies
    drift.
- **Alternatives** (*considered in the 2026-10-29 session*, when the owner asked for one file):
  - only a `CLAUDE.md` (Claude-only);
  - both files, with a `CLAUDE.md` that imports `@AGENTS.md`. That's only needed for
    Claude-specific instructions or older Claude Code versions;
  - a `CLAUDE.md` symlink (breaks on Windows clones).
- **Consequences:** adding any `CLAUDE.md` or `CLAUDE.local.md` would stop Claude Code from
  reading `AGENTS.md`, unless it imports it (AGENT_CONTEXT.md, Gotcha 21). Agents must follow
  the pointer to get the full rules.
- **Where:** `AGENTS.md`, AGENT_CONTEXT.md.

---

## Superseded approaches (history)

| Then | Now | Changed in |
| --- | --- | --- |
| Rows generating during a reload restarted as Pending | Their jobs are resumed by job ID (D-13) | `7e30e88` |
| The session was saved after every change | Saved 250 ms after changes stop, at once on `pagehide` (D-14) | `7e30e88` |
| A 403 counted as an expired link | Only 404 and 410 (D-16) | `7e30e88` |
| The benchmark reused one phrase in every round | It rotates through 16 phrases and skips reused replies (D-19) | `7e30e88` |
| The benchmark used `import.meta.main` | `startedAsScript`, shared and junction-safe (D-19, D-25) | `7e30e88`, `b71afb5` |
| A "Sort voices" dropdown | Four checkboxes (D-11) | `4e197fe` |
| "Tested" was inferred from the speed results | Its own `TESTED_VOICES` list (D-09) | `c774fb0` |
| WAV was converted on the page only; samples were converted too | A worker first, the page as a fallback; samples aren't converted (D-17) | `c774fb0` |
| bark-small's French voice was offered | Hidden (D-09) | `3d5edd8` |
| Icon tests compared PNG bytes | They compare decoded pixels (D-24) | `b71afb5` |

---

## Assumptions

Facts the code relies on that aren't guaranteed. If one turns out false, the decisions listed
need revisiting.

| # | Assumption | Basis | Affects |
| --- | --- | --- | --- |
| A1 | TTS.ai accepts browser requests from any site (CORS), for the API and for result links | checked 2026-10-25 | D-01, D-03 |
| A2 | A 429 means the job wasn't created; a timeout or 5xx might mean it was | general HTTP semantics, not confirmed by TTS.ai | D-05 |
| A3 | Identical requests (text, voice, model, speed, language) are answered from TTS.ai's cache for free | seen in the benchmark, 2026-10-25 | D-18, D-19, the cost of Stop |
| A4 | A job's `uuid` stays valid for status checks after a reload | the resume test uses MSW; real behavior over long gaps is unconfirmed | D-13 |
| A5 | Result links eventually expire with 404 or 410, and a 403 is temporary | assumption; TTS.ai documents neither | D-16 |
| A6 | Voice keys (`model:id`) stay stable over time | observed over 2026-10-23 to 2026-10-26 | D-08, D-09, saved sessions |
| A7 | The tiers are 1, 2 and 4 credits per character, and model-to-tier mapping is stable | benchmark and docs, 2026-10-25 | D-10 |
| A8 | Users work on a desktop browser, in one tab, with lists of tens to a few hundred items | inferred from the layout and the features; not stated | the layout, D-06, D-12 |
| A9 | Users are mostly making **French** vocabulary audio | the app's name and defaults | D-09 (only French checked), `defaultLanguage` |
| A10 | Visitors are fine with their key being kept in their browser's storage | the design of the key box; not user-tested | D-02 |
| A11 | Dates in code comments and commits may be UTC: the voice check is dated 2026-10-26, but its commit `41c06c3` is 2026-10-25 19:43 in UTC−5 (00:43 UTC on the 26th) | `git log` | reading the history |
