# Architecture

## TL;DR

- **One static single-page app, no backend.** React 19 + TypeScript, built by Vite 8 and styled
  with Tailwind CSS 4. TTS.ai is the only external service. Hosted on GitHub Pages.
- **`src/App.tsx` is the orchestrator.** It owns the page state, derives the voice lists, defines
  every event handler and lays out the page. Components only render props and call callbacks.
- **Layers:** components → `App.tsx` → hooks → services → utils/types. Only
  `src/services/ttsApi.ts` sends HTTP requests to TTS.ai.
- **Queue rows** (`QueueItem` in `src/types/queue.ts`) go pending → queued/processing →
  completed or failed. They change only through `queueReducer` in `src/hooks/useQueue.ts`.
- **Generating** (`src/hooks/useGeneration.ts`) submits jobs one at a time while a poller checks
  every active job about every 1.5 s. A 401 ends the whole run. **Stop** puts unfinished rows
  back to Pending.
- **"Up to date":** a completed row is skipped only while the speaker and speed recorded in
  `generatedWith` still match the settings (`isUpToDate` in `src/services/assignment.ts`).
- **Retries:** reads retry on 429, network and 5xx errors. Submits retry only on 429, so a job
  is never created (and billed) twice.
- **Audio:** each file is fetched once per URL into a memory cache that Play, Download and the
  ZIP share (`src/services/audio.ts`). WAV is converted to 64 kbps MP3, in a Web Worker if
  possible, else on the page; if that fails, the original file is kept.
- **Persistence:** one JSON snapshot in `sessionStorage` under `french-vocab-audio:session:v1`.
  It's saved 250 ms after changes stop and immediately on `pagehide`, and checked field by field
  when loaded. Interrupted jobs are picked up again by job ID.
- **Voice catalog:** which voices are hidden, tested, speed-following, and their price tiers
  are hard-coded data in `src/utils/voices.ts`, from checks on 2026-10-25 and 2026-10-26.
- **Origins:** `npm run dev` and `npm run preview` send API calls through the Vite proxy
  `/tts-api` → `https://api.tts.ai`. The hosted build calls `https://api.tts.ai` directly.
- **Tests:** Vitest with MSW, where any unhandled request fails. jsdom is opted into per file,
  and tests sit next to their code. 26 files and 456 tests as of 2026-10-29.

---

## About this document

How the French Vocabulary Audio Generator is put together, as of 2026-10-29 (commit `b71afb5`).
References use a file path plus a symbol name (for example `src/hooks/useGeneration.ts` →
`run`), not line numbers, so they stay valid as the code changes.

## 1. System context

```
 Visitor's browser
   │  loads index.html + assets/ (built by Vite with base "./")
   │    hosted: https://simonprogai.github.io/vocab-audio-generator/ (GitHub Pages)
   │    local:  http://localhost:5173 (npm run dev) or the preview server (npm run preview)
   │
   │  JSON over HTTPS, "Authorization: Bearer <key>" when there's a key
   ▼
 TTS.ai API  https://api.tts.ai/v1
   GET /voices/          the voice list
   POST /tts/            submit a job, which replies with a job uuid and the credits charged
   GET /speech/results/  ?uuid=<job id>: job status, plus result_url when done
   │
   │  result_url: a link to the audio file (any host, e.g. a CDN), fetched WITHOUT the key
   ▼
 Audio file: MP3, or WAV labeled audio/mpeg for some models
```

- **Local development:** the browser calls `/tts-api/...` on the Vite server, which forwards to
  `https://api.tts.ai/...` (`ttsProxy` in `vite.config.ts`: `changeOrigin`, `/tts-api` prefix
  removed). This avoids CORS problems and works for `npm run preview` too.
- **Hosted build:** built with `VITE_TTS_API_ORIGIN=https://api.tts.ai`, so the browser calls
  TTS.ai directly. This depends on TTS.ai allowing cross-origin browser requests, which it did
  when checked on 2026-10-25.
- **Result links:** `routeThroughApiOrigin` in `src/services/ttsApi.ts` reroutes links on
  `https://api.tts.ai/` and relative links through the API origin (the proxy in development).
  Links on other hosts are fetched as they are.
- **Nothing else is contacted:** no analytics, no font CDN (Tailwind is compiled in), no login
  provider, no server of the project's own.

---

## 2. Layers and module map

```
components/  ──props, callbacks──►  App.tsx  ──calls──►  hooks/  ──►  services/  ──►  utils/, types/
(render only)                    (state + handlers)    (stateful)    (side effects)   (pure)
```

**Dependency rule:** components import only types, constants and pure helpers from `services/`
and `utils/`. For example, `QueueRow` uses `wasDownloaded` and `SAMPLE_TEXT`, and `QueueTable`
uses `previewSpeaker`. Every side effect (HTTP, storage, playback, saving files) starts in
`App.tsx` or a hook. Inside `services/`, all TTS.ai traffic goes through the four functions
`ttsApi.ts` exports.

| Path | Responsibility | Key exports / notes |
| --- | --- | --- |
| `src/main.tsx` | Entry point. Renders `<App/>` inside `StrictMode` and `ErrorBoundary`. | Throws if `#root` is missing. |
| `src/App.tsx` | The orchestrator: state, derived voice lists, handlers, layout. | The only default export in `src/`. |
| `src/types/queue.ts` | Domain types. | `QueueItem`, `QueueStatus`, `JobStatus`, `Voice`, `SpeakerConfig`, `AssignmentMode`, `GenerationJob`, `GenerationSnapshot`, `QueueItemEdit`, `QueueItemProgress`, `QueueStats` |
| `src/hooks/useQueue.ts` | The queue's state. | `queueReducer` (exported for tests), `computeStats`, `useQueue` |
| `src/hooks/useGeneration.ts` | Runs a batch: submit and poll loops, Stop, resuming. | `useGeneration` → `{ isGenerating, run, stop }`, `GenerationSummary`, `ResumedJob` |
| `src/hooks/useVoices.ts` | Loads the voice list, drops hidden voices, builds `voicesByKey`, Retry. | `useVoices`, `VoiceLoadStatus` |
| `src/hooks/useAudioPlayer.ts` | Plays one clip at a time and frees its object URL. | `useAudioPlayer` → `{ current, play, stop }` |
| `src/hooks/useSessionSaver.ts` | Saves 250 ms after the last change, and at once on `pagehide` or unmount. | `useSessionSaver`, `SAVE_DELAY_MS` |
| `src/services/ttsApi.ts` | The only TTS.ai client: axios instances, key interceptor, retries, error mapping, parsing. | `getVoices`, `submitJob`, `getJobStatus`, `downloadAudio`, `TtsApiError`, `toTtsApiError`, `getErrorMessage`, `hasApiKey` |
| `src/services/assignment.ts` | Who speaks each row, and what Generate All has to do. | `previewSpeaker`, `resolveSpeaker`, `isUpToDate`, `planGeneration` |
| `src/services/session.ts` | sessionStorage persistence and checking saved data. | `SESSION_KEY`, `loadSession`, `saveSession`, `clearSession`, `parseSession` |
| `src/services/apiKey.ts` | Where the visitor's key is kept. | `loadApiKey`, `saveApiKey`, `forgetApiKey`, `currentApiKey`, `BUILT_IN_API_KEY` |
| `src/services/audio.ts` | Audio cache, WAV → MP3 dispatch, expired-link detection. | `loadAudio`, `toMp3`, `isWav`, `retainAudio`, `clearAudioCache`, `isExpiredAudioError`, `EXPIRED_AUDIO_MESSAGE` |
| `src/services/wavToMp3.ts` | WAV parser and MP3 encoder (lamejs). | `readWav`, `encodeMp3`, `wavToMp3` |
| `src/services/mp3Worker.ts` | Web Worker around `wavToMp3`. | Messages: `{id, wav}` in, `{id, mp3}` or `{id, error}` out |
| `src/services/wavHeader.ts` | `isWavHeader`: "RIFF" at byte 0 and "WAVE" at byte 8. | Kept apart so checking a file doesn't load the encoder. |
| `src/services/download.ts` | Saving one file, or a ZIP of every finished file. | `downloadItem`, `downloadAllCompleted`, `toMp3Name`, `isDownloadable`, `wasDownloaded`, `ZIP_FILENAME` |
| `src/services/voiceSample.ts` | The Sample button: a short real job per voice, kept for the session. | `loadVoiceSample`, `clearVoiceSamples`, `SAMPLE_TEXT` |
| `src/utils/voices.ts` | Voice catalog data and list arrangement. | See [§9](#9-voice-catalog-srcutilsvoicests). |
| `src/utils/slugify.ts` | Filenames from speech text. | `slugify`, `sanitizeFilename` |
| `src/utils/speed.ts` | The speed range and each row's actual speed. | `MIN_SPEED` 0.5, `MAX_SPEED` 2.0, `SPEED_STEP` 0.1, `DEFAULT_SPEED` 1.0, `SPEED_OPTIONS` (16 values), `roundSpeed`, `formatSpeed`, `effectiveSpeed` |
| `src/utils/credits.ts` | Credit counting. | `CreditUsage`, `NO_CREDITS_USED`, `recordCredits`, `formatCredits` |
| `src/utils/format.ts` | `pluralize(count, singular, plural?)`. | |
| `src/utils/wait.ts` | `wait(ms, signal)`: resolves after `ms`, or as soon as `signal` aborts. Never rejects. | Callers check `signal.aborted` afterwards. |
| `src/components/*` | UI. | See [§3](#3-component-tree). |
| `src/test/*` | MSW server, Vitest setup, WAV builder. | Used only by tests. |
| `scripts/*` | Node command-line scripts (voice benchmark, icon drawing). | Type-checked by `tsconfig.node.json`. See [§12](#12-scripts). |

---

## 3. Component tree

```
main.tsx
└─ StrictMode
   └─ ErrorBoundary                last resort: "Something went wrong" + Reload page
      └─ App
         ├─ <header>               icon (also the favicon's design), title, Reset
         ├─ ApiKeySettings         key form, or the masked key (••••last4) with Change / Forget
         ├─ BulkImport     step 1  textarea bound to `draft`, Add To Queue, Ctrl/Cmd+Enter
         ├─ SpeakerSettings step 2  memo · assignment mode cards · VoiceSelect (Single Speaker)
         │                          · VoiceChecklist (Random, Round Robin) · SpeakerOrder (Round
         │                          Robin) · Voice language · Sort voices checkboxes · Global speed
         ├─ QueueTable     step 3  memo · "+ Add File" · one QueueRow (memo) per item:
         │                          #, Text, Filename (+ .mp3), Auto, Speed (+ Custom), Speaker
         │                          (VoiceSelect in Per File mode, else a label), Status
         │                          (StatusBadge, "Settings changed…", error), Actions
         │                          (Play / Sample / Stop · Download / Download again · Remove)
         ├─ ProgressPanel  step 4  Total, Pending, Processing (queued + processing), Completed,
         │                          Failed, and a progress bar (green done, red failed)
         └─ Toolbar                sticky at the bottom: Generate All or Stop + "Generating
                                   audio…", CreditCounter, Download All (ZIP) · N, Clear Queue.
                                   The current Notice is rendered above the buttons (children).
```

Shared pieces:

- **`Button`** (`src/components/Button.tsx`): variants `primary`, `secondary` (the default),
  `danger`, `ghost`, and `repeat` (amber, for "done once, fine to repeat", used by **Download
  again**). Sizes `sm` and `md`. Defaults to `type="button"`, so it never submits a form by
  accident. Hover and press styles apply only while enabled. The press-down scale is
  `motion-safe` only.
- **`Section`**: a numbered card with an `h2`, labeled through `aria-labelledby`.
- **`Notice`**: tones `info`, `success`, `warning` and `error`. Warnings and errors use
  `role="alert"`, the others `role="status"`. It takes an optional title, one message or a
  bulleted list, an optional action, and an optional dismiss button.
- **`StatusBadge`**, **`Spinner`**, and **`FIELD_CLASS`** (`fieldStyles.ts`, the shared look of
  inputs, selects and textareas).
- **`VoiceSelect`** is used by the Single Speaker picker and by each row in Per File mode.
- **`CreditCounter`** shows "N credits used this session", plus "TTS.ai reports M left" when
  TTS.ai has sent a balance.

---

## 4. State management

There's no state library. State lives in `App` (`useState`, plus `useReducer` through
`useQueue`), in a few hooks, and in a few module-level variables outside React.

### 4.1 State owned by `App`

| State | Held by | Initial value | Saved in the session? | Changed by |
| --- | --- | --- | --- | --- |
| `items` (queue rows) | `useQueue` (`useReducer`) | restored rows, or `[]` | yes | reducer actions (§5.2) |
| `stats` | `useQueue` (`useMemo`) | derived from `items` | no | — |
| voice library `{ status, voices, error, voicesByKey, reload }` | `useVoices` | `loading` | no | fetch on mount, Retry, saving a key after a failed load |
| `credits` (`CreditUsage`) | `useState` | restored, or `{ used: 0 }` | yes | `recordSubmitted` (generation and samples), Reset |
| `config` (`SpeakerConfig`) | `useState` | restored, or `{ mode: "single", selectedVoices: [] }` | yes | SpeakerSettings, Reset |
| `globalSpeed` | `useState` | restored, or 1.0 | yes | slider, "Reset to 1.0×", Reset |
| `languageChoice` | `useState` | restored, or `null` (French if offered, else all) | yes | Voice language select, Reset |
| `voiceList` (`VoiceListOptions`) | `useState` | restored, or `DEFAULT_VOICE_LIST` | yes | Sort voices checkboxes, Reset |
| `draft` (Bulk Import text) | `useState` | restored, or `""` | yes | typing, Add To Queue (empties it), Reset |
| `notice` | `useState` | "Queue restored" when rows were restored | no | most handlers |
| `zipProgress` | `useState` | `null` | no | Download All |
| `apiKey` (`SavedApiKey`) | `useState`, a copy of what's stored | `loadApiKey()` | stored by `apiKey.ts` (§4.4) | Save key, Forget |
| `resumable` | `useState`, computed once | rows that can be picked up again | — | — |
| `playback` `{ id, state }` | `useAudioPlayer` | `null` | no | `play`, `stop` |
| `isGenerating` | `useGeneration` | `false` | no | `run` |

### 4.2 Derived values (`useMemo` in `App`)

- `languages`: `summarizeLanguages(voices, passesFilters)`, one entry per primary language
  with `count` (voices the Sort voices boxes let through) and `total`.
- `language`: `languageChoice ?? defaultLanguage(languages)`, so French when TTS.ai offers it.
- `visibleVoices`: voices in that language (or all of them).
- `arrangedVoices`: `arrangeVoiceList(visibleVoices, voiceList)`. It's worked out **once** in
  `App` and passed to every picker (Single Speaker, the pool, each row), so long lists aren't
  sorted again by every picker on every render.
- `outdatedIds`: completed rows that are no longer up to date, which the row shows as "Settings
  changed — Generate All will redo it."
- `snapshot`: the `SessionSnapshot` handed to `useSessionSaver`.

### 4.3 State outside React (module-level variables)

These outlive renders and are reset only by explicit calls or a page reload. Tests must reset
them between cases.

| Module | Variables | Cleared by |
| --- | --- | --- |
| `src/services/audio.ts` | `audioByUrl` (URL → `Promise<Blob>`), `worker`, `jobs`, `nextJob` | `retainAudio(urlsStillLinked)`, run by an `App` effect on every queue change; `clearAudioCache()` |
| `src/services/voiceSample.ts` | `samples` (voice key → Blob), `unfinishedJobs` (voice key → job ID) | `clearVoiceSamples()`, called by Reset |
| `src/services/apiKey.ts` | `pageOnlyKey`, used when the browser blocks both storages | `forgetApiKey()` |
| `src/services/ttsApi.ts` | `apiClient`, `downloadClient`, `API_ORIGIN` (read from `import.meta.env` when the module loads) | never |

### 4.4 Persistence

- **Session:** `sessionStorage["french-vocab-audio:session:v1"]` holds JSON of type
  `SessionSnapshot`: `{ items, draft, settings: { config, globalSpeed, languageChoice,
  voiceList }, credits }`. It's per tab and gone when the tab closes. See §6.1 for loading and
  §6.8 for saving.
- **API key:** `"french-vocab-audio:api-key"` in **exactly one** of `localStorage` (when
  **Remember on this device** is ticked) or `sessionStorage`. If the browser blocks both, the
  key is kept in memory for the page's lifetime. `loadApiKey` reads `localStorage` first, then
  `sessionStorage`, then memory.
- **Not stored:** audio. After a reload, Play and Download fetch the file again from the row's
  `downloadUrl`. TTS.ai doesn't say how long those links work (§7.6).

### 4.5 Render performance

- `SpeakerSettings`, `QueueTable` and `QueueRow` are wrapped in `memo`. The queue `actions`
  object is created once (`useMemo` with `[]`). Handlers passed to memoized children use
  `useCallback` (`handleDownload`, `handlePlay`, `handleSample`, `reportAudioError`).
- Typing in Bulk Import re-renders `App`, but not the queue or the speaker lists.
  `src/App.test.tsx` ("typing in Bulk Import") checks this by counting calls to
  `previewSpeaker` and `arrangeVoiceList` through `vi.mock` wrappers.

---

## 5. Domain model

### 5.1 `QueueItem` (`src/types/queue.ts`)

| Field | Meaning |
| --- | --- |
| `id` | UUID v4 (`uuid` package), made in `createItem`. |
| `text` | What the voice says. Trimmed when the job is built. |
| `filename` | The filename stem, without `.mp3`. `slugify(text)` while `autoFilename` is on; `sanitizeFilename(input)` when typed by hand. |
| `autoFilename` | The **Auto** checkbox. Ticking it again re-derives the name from the text. |
| `speed`, `overrideSpeed` | The row's own speed, used only while **Custom** (`overrideSpeed`) is ticked. |
| `speaker` | A voice key. In Per File mode it's the user's choice. In the other modes, Generate All writes the voice it picked, so it records who spoke the audio. |
| `status` | `pending` (app only), `queued`, `processing`, `completed` or `failed`. |
| `jobId` | The TTS.ai job `uuid` while queued or processing. It's saved, so a reload can check on the job again. |
| `downloadUrl` | TTS.ai's `result_url` once completed. |
| `downloadedUrl` | The `downloadUrl` whose file was saved (by Download or in the ZIP). The row counts as downloaded only while the two are equal. |
| `error` | A user-facing failure message. |
| `generatedWith` | `{ speaker, speed }` that produced the current audio. It's the basis of "up to date". |

`QueueItemEdit` lists the fields a user can edit (`text`, `filename`, `autoFilename`, `speed`,
`overrideSpeed`, `speaker`). `QueueItemProgress` lists the fields generation writes (`status`,
`speaker`, `jobId`, `downloadUrl`, `error`, `generatedWith`).

### 5.2 Reducer actions (`queueReducer` in `src/hooks/useQueue.ts`)

| Action | Effect |
| --- | --- |
| `add { texts }` | Appends one pending row per text (`createItem`). Add File adds `[""]`. |
| `edit { id, changes }` | `applyEdit`: a typed filename is sanitized, Auto re-derives the name from the text, and **changed text clears the generation fields** (status back to pending; `jobId`, `downloadUrl`, `error` and `generatedWith` removed). |
| `remove { id }` / `clear` | Removes one row, or all of them. |
| `progress { updates }` | Merges generation changes into the matching rows. |
| `expire { id, url, error }` | Fails the row and clears its audio fields, **only if the row still has `url`** (it may have been regenerated meanwhile). |
| `downloaded { files }` | Sets `downloadedUrl = downloadUrl`, **only for rows whose link is still the one saved**. |

### 5.3 Row status lifecycle

```
                 add / Add File
                       │
                       ▼
     ┌──────────────► pending ◄─────────────────────────────────────────┐
     │                  │                                                │
     │                  │ Generate All (row not up to date)              │ Stop, or the run ended
     │                  ▼                                                │ before this row finished
     │          queued ⇄ processing  ────────────────────────────────────┘ (jobId cleared)
     │            │            │
     │   job done │            │ job failed · TTS.ai rejected it · still not done after 10 min
     │            ▼            │ · 3 status checks in a row failed · submit failed
     │        completed        ▼
     │    (downloadUrl,      failed (error) ◄── link answered 404/410 on Play, Download or ZIP
     │     generatedWith)      │                (expire: audio fields cleared)
     │            │            │
     └────────────┴────────────┘
        text edited (from any status): generation fields cleared, back to pending

 At the start of a run, every row in it is set to pending with its speaker and its audio fields
 cleared, so a completed row that's being regenerated loses its old link right away.

 After a reload: queued/processing rows with a jobId and a speaker are picked up again;
 the others go back to pending (session.ts → restoreInterrupted).
```

### 5.4 Speaker assignment (`src/services/assignment.ts`)

| Mode | Speaker known before generating (`previewSpeaker`) | Picked at Generate All (`resolveSpeaker`) | Completed row is up to date when (`isUpToDate`) | Blocks Generate All (`planGeneration`) |
| --- | --- | --- | --- | --- |
| `single` | `config.singleSpeaker` | the same | `generatedWith.speaker === singleSpeaker` | no speaker chosen, or it's no longer offered |
| `perFile` | `item.speaker` | the same | `generatedWith.speaker === item.speaker` | a row that needs work has no offered speaker |
| `random` | unknown | a random voice from `selectedVoices` (`Math.random`; injectable for tests) | `generatedWith.speaker` is still in the pool | empty pool, or a pool voice no longer offered |
| `roundRobin` | `selectedVoices[index % n]`, **by row position** | the same | `generatedWith.speaker === selectedVoices[index % n]` | empty pool, or a pool voice no longer offered |

- In every mode a row is up to date only if it's `completed`, has `generatedWith`, and
  `generatedWith.speed === effectiveSpeed(item, globalSpeed)`. That's `item.speed` when Custom
  is ticked, else the global speed.
- **"Offered"** means present in `voicesByKey`: loaded from TTS.ai and not hidden. The language
  and the Sort voices boxes only change what's *displayed*. They never make a chosen voice
  invalid.
- `planGeneration` also blocks on an empty queue, voices not loaded yet, rows without text, and
  rows without a filename. It lists up to 8 row numbers per problem ("Rows 1, 2, 3, 4, 5, 6, 7,
  8 and 2 more have no filename. Enter one, or tick Auto.").
- Because Round Robin goes by position, removing a row shifts the voice of every row after it.
  Their completed audio then counts as outdated (see CURRENT_STATE.md, Known limitations).

---

## 6. Data flows

### 6.1 Page load and restoring a session

1. `App` calls `loadSession()` once (`useState(loadSession)`). Anything unreadable gives
   `undefined`, which means a fresh start.
2. `parseSession` (`src/services/session.ts`) checks the data field by field:
   - Invalid rows and repeated IDs are dropped. A broken optional field is dropped, not the
     whole row.
   - Invalid settings are left out, so the app uses its defaults for them.
   - Voices hidden since the save are removed from `config` and from rows still waiting for
     audio (pending or failed). Rows that have audio keep them.
   - The old `voiceOrder` dropdown value (`name`, `tier`, `followsSpeed`) is converted to the
     four `voiceList` booleans, through a `Map` so names like `constructor` aren't accepted.
   - Rows that were queued or processing keep their `jobId` if they also have a `speaker`.
     Otherwise they restart as pending. The number kept is returned as `interrupted`.
3. `useQueue(saved?.items)` seeds the reducer. Each setting takes its saved value or its
   default. `notice` becomes "Queue restored", plus a line about jobs being checked again when
   there are interrupted rows.
4. `resumable` = rows still `queued`/`processing` with `jobId` and `speaker`, turned into
   `ResumedJob`s whose `generatedWith.speed` is `effectiveSpeed(item, savedGlobalSpeed)`.
   Settings are locked while generating, so the saved speed is the one the job was sent with.
5. `useVoices` fetches `GET /voices/` (aborted on unmount) and filters out hidden voices. An
   empty list counts as an error.
6. An effect waits until the voice status is no longer `loading`, then runs
   `generation.run([], resumable)` once (guarded by `resumedRef`). Waiting also keeps the run out
   of React StrictMode's development double mount, whose simulated unmount would abort it. The
   run's summary becomes the notice.
7. An effect calls `retainAudio(urls)` with every `downloadUrl` still in the queue, so files of
   removed, cleared or regenerated rows are freed.

### 6.2 Adding and editing rows

- `BulkImport.parseLines`: one entry per non-blank line, trimmed. A line pasted from a
  spreadsheet keeps only its first tab-separated column. **Add To Queue** or Ctrl/Cmd+Enter
  calls `actions.addTexts(lines)` and empties the box.
- `createItem`: new UUID, `filename = slugify(text)`, `autoFilename: true`, speed 1.0 without
  Custom, status `pending`.
- Edits go through `actions.edit(id, changes)` → `applyEdit` (§5.2).
- While a run is going, every row input, Sample, Remove, Reset, Clear Queue and all of Speaker
  Settings are disabled. Play, Download and Download All stay usable. Rows can still be added
  (Bulk Import, **+ Add File**); they stay pending until the next Generate All.
- Until the voice list has loaded, the speaker pickers, the language select and the Sort voices
  boxes are disabled. The mode cards and the speed slider aren't.

### 6.3 Generate All

```
App.handleGenerate
  planGeneration(items, config, globalSpeed, voicesByKey)              services/assignment.ts
    ├─ problems  → error Notice "Can't start generating yet" + one message per problem
    ├─ no jobs   → info Notice "Every file is already generated with the current settings."
    └─ jobs[]    → one GenerationJob { itemId, text (trimmed), voice, speed } per row
                   that isn't up to date
  generation.run(jobs)                                                 hooks/useGeneration.ts
    1. applyProgress: each job's row → status pending, speaker = the picked voice key,
       jobId / downloadUrl / error / generatedWith cleared
    2. two loops run side by side:
       submitAll   for each job, ONE AT A TIME, until aborted:
                     submitJob → onSubmitted(reply)  (App adds credits_used to the counter)
                       reply.status "failed"  → row failed "TTS.ai rejected this job."
                       else → row queued or processing, with jobId; the job becomes active
                     error: aborted → stop · auth (401) → abort the whole run with that message
                            · anything else → that row failed with the message
       pollUntilDone   while (still submitting or jobs active) and not aborted:
                     for each active job, ONE AFTER ANOTHER: getJobStatus
                       completed → row completed + downloadUrl + generatedWith
                       failed    → row failed (TTS.ai's error, or a default message)
                       queued/processing → status updated if it changed; failed once it's
                                           older than 10 min ("took too long")
                       error: aborted → ignore · auth → abort the run
                              · else count it; the 3rd failed check in a row fails the row
                     then wait 1.5 s (abortable)
    3. finally: rows of this run that didn't finish → pending, jobId cleared
    4. returns { completed, failed, unfinished, stoppedByUser, fatalError? }
  setNotice(summarizeRun(summary))
    fatalError → error "Generation stopped" · stopped by the user → info · failures → warning
    · otherwise → success "N files generated"
```

- Submitting and polling at the same time means early files finish while later ones are still
  being submitted.
- A 10-minute limit (`JOB_TIMEOUT_MS`) applies per job, counted from submission. For a resumed
  job it's counted from when the page picked it up again.
- Because each cycle checks active jobs one after another, a cycle with N active jobs takes N
  request round trips plus 1.5 s. There's no limit on how many jobs can be active at once
  (CURRENT_STATE.md, Known limitations).

### 6.4 Stop

`generation.stop()` aborts the run's `AbortController`. Requests in flight are cancelled
(axios `signal`), waits end early (`wait`), and both loops exit. The `finally` block puts
unfinished rows back to pending with no `jobId`, and the notice says how many files finished.
**The app has no way to cancel a job TTS.ai already accepted** (the code calls no such
endpoint), so it may still be charged and may still finish on TTS.ai's side. The next Generate
All submits those rows again.

### 6.5 Play

`handlePlay(item)` → `useAudioPlayer.play(item.id, () => loadAudio(url))`:

1. `play` stops any current clip, bumps a generation counter, and sets `{ id, state: "loading" }`.
2. `loadAudio(url)` returns the cached promise, or starts `downloadAudio(url).then(toMp3)` and
   caches it. Failed loads are removed from the cache, so trying again refetches.
3. It creates an object URL, `new Audio(url).play()`, and sets `state: "playing"`. `pause`,
   `ended` and `error` all end playback and revoke the URL. That covers media keys and the OS
   media controls too.
4. A load that's been superseded (stopped, or replaced by another clip) is ignored. The browser
   refusing to start sound (`NotAllowedError`) becomes "Your browser blocked playback. Click again
   to play it."
5. Errors go to `reportAudioError`. 404 or 410 → `actions.expire(...)` plus
   `EXPIRED_AUDIO_MESSAGE`. Anything else (including 403) is only reported.

An effect stops playback when the playing row disappears (removed, cleared, Reset).

### 6.6 Sample (pending rows whose voice is known: not in Random Assignment mode)

`handleSample(item, voice)` → `play(item.id, (signal) => loadVoiceSample(voice, { signal,
onSubmitted: recordSubmitted }))`. `loadVoiceSample` (`src/services/voiceSample.ts`):

1. If that voice's sample was made earlier in the session, return it.
2. Otherwise reuse an unfinished job ID for that voice, or submit `"Bonjour, ça va ?"` at 1.0×.
   Submitting adds its credits to the counter. A reply with status `failed` throws.
3. Poll every 1.5 s, up to 120 times (about 3 minutes). Completed → `downloadAudio` (**no MP3
   conversion**: samples are only played) and cache by voice key. Failed → throw with TTS.ai's
   message.
4. Stopping aborts the polling but keeps the job ID, so the next Sample of that voice checks on
   the same job instead of paying again. Reset clears both caches.

### 6.7 Download and Download All (ZIP)

- **Download** (`QueueRow` shows "Saving…" meanwhile): `downloadItem(item)` → `loadAudio` →
  `saveBlob(blob, toMp3Name(filename))`. `saveBlob` clicks a temporary `<a download>` and revokes
  its object URL 60 s later. On success `App` calls `actions.markDownloaded([{ id, url }])`, so
  the button becomes amber **Download again**.
- **Download All (ZIP)** → `downloadAllCompleted(items, setZipProgress)`:
  1. Takes every completed row with a link (outdated ones included). Names come from
     `toMp3Name`, made unique without regard to case (`name_2.mp3`, `name_3.mp3`, …).
  2. Loads up to 4 files at a time through `loadAudio` and reports `{ done, total }` progress.
     A file that fails is skipped. If it failed with 404 or 410, it's also listed as `expired`.
  3. If every file failed, nothing is saved. Otherwise it generates the ZIP in JSZip's default
     STORE mode (no compression, since MP3 is already compressed) and saves
     `vocabulary_audio.zip`.
  4. `App` expires the `expired` rows, marks the `saved` rows downloaded, and shows a notice
     when files were left out.

### 6.8 Saving the session

`snapshot` (memoized) changes → `useSessionSaver` writes it 250 ms later. Each new change
restarts the timer. `pagehide` (which a refresh fires) and unmounting write right away if
anything is unsaved. If `saveSession` fails (storage full or blocked), it removes the previous
copy, so a reload can't bring back an out-of-date queue. The app keeps working without
persistence.

### 6.9 Reset and Clear Queue

| | Reset (header) | Clear Queue (toolbar) |
| --- | --- | --- |
| Confirmation | `window.confirm`, worded after what will be lost | "Remove all N files from the queue?" |
| Queue rows | removed | removed |
| Bulk Import text | emptied | **kept** |
| Settings (mode, pool, single speaker, speed, language, Sort voices) | back to defaults | kept |
| Credit counter | back to 0 | kept |
| Voice samples (memory) | cleared | kept |
| API key | **kept** (Forget removes it) | kept |
| Disabled while | generating, or building a ZIP | generating, or the queue is empty |

### 6.10 API key

- **Save key** → `saveApiKey(key, remember)`: forget it everywhere, then store it in one place
  (or in memory if storage is blocked). `App` refreshes `apiKey`, and retries the voice list if
  it had failed to load.
- **Forget** → `forgetApiKey()` removes it from both storages and memory. Requests then fall back
  to `VITE_TTS_API_KEY` (local development) or no key at all (TTS.ai's limited anonymous access).
- The axios request interceptor in `ttsApi.ts` calls `currentApiKey()` on **every** request, so
  a change applies at once. Audio file downloads use a separate axios instance that never sends
  the key.

---

## 7. TTS.ai API integration (`src/services/ttsApi.ts`)

This describes the API as the code understands it. Some of it was learned by observation; see
§7.6 and DECISIONS.md. The public docs are at <https://tts.ai/api>.

### 7.1 Endpoints

| Function | Request | Reply fields read | Retried on |
| --- | --- | --- | --- |
| `getVoices(signal?)` | `GET {origin}/v1/voices/` | an array, or `{ voices: [...] }`. Per entry: `id` or `voice_id` (required), `model`, `name` (defaults to the id), `language` or `lang`, `gender`. Duplicates (same key) are dropped. **TTS.ai's order is kept.** | 429, network, 5xx |
| `submitJob({ text, voice, speed }, signal?)` | `POST {origin}/v1/tts/`, JSON `{ text, voice: voice.id, model: voice.model, speed, format: "mp3", language: <primary language, e.g. "fr"> or omitted }` | `uuid`, or `job_id` as a fallback (required); `status` (queued if missing); `credits_used`; `credits_remaining` | **429 only** |
| `getJobStatus(jobId, signal?)` | `GET {origin}/v1/speech/results/?uuid=<jobId>` | `status`. When completed: `result_url`, or `url`, or `audio_url` (a completed job without one counts as failed). When failed: `error` or `message`. | 429, network, 5xx |
| `downloadAudio(url, signal?)` | `GET <result link>` (rerouted through the API origin when it's on `https://api.tts.ai/` or relative), `responseType: "blob"`, **no `Authorization` header** | a non-empty `Blob` that isn't `text/html` | 429, network, 5xx |

- `voice.key` is `"model:id"`, or just the id when a voice has no model. Only the raw `id` and
  `model` are sent to TTS.ai.
- The language is sent because short vocabulary items are hard to auto-detect.
- The benchmark script calls the same endpoints with its own `fetch` client (§12).

### 7.2 Status values

`normalizeStatus` maps TTS.ai's words onto the app's job statuses: `queued`/`pending` →
`queued`; `processing`/`running`/`started` → `processing`;
`completed`/`complete`/`done`/`success`/`succeeded` → `completed`;
`failed`/`error`/`cancelled`/`canceled` → `failed`. Anything else is treated as `processing` when
polling, and as `queued` in a submit reply.

### 7.3 Errors (`TtsApiError`, built by `toTtsApiError`)

| Situation | `kind` | Message (shortened) |
| --- | --- | --- |
| No reply: timeout (`ECONNABORTED`, `ETIMEDOUT`) | `network` | "TTS.ai took too long to respond…" |
| No reply: anything else | `network` | "Couldn't reach TTS.ai…" |
| 401 | `auth` | "TTS.ai rejected your API key…", or "…needs an API key…" when there's no key |
| 402 | `request` | "Your TTS.ai account is out of credits." |
| 403 | `request` | "TTS.ai refused this request. Your plan may not include this voice." + details |
| 429 | `rateLimit` | "TTS.ai's rate limit was reached…". `retryAfterMs` comes from `Retry-After` (seconds) or `X-RateLimit-Reset` (a Unix time or seconds). |
| 500 and up | `server` | "TTS.ai is having trouble right now (error N)…" |
| Other HTTP errors | `request` | "TTS.ai couldn't process the request (error N)." + details |
| Cancelled (axios cancel) | `aborted` | "The request was cancelled." |
| An HTML page instead of data | `invalidResponse` | `PROXY_HINT`: the `/tts-api` proxy exists only under `npm run dev` and `npm run preview`, so set `VITE_TTS_API_ORIGIN` |
| A reply in the wrong shape | `invalidResponse` | a specific message, e.g. "…didn't return a job ID." |

"Details" are the server's own message, at most 200 characters: a plain-text body, or `error`,
`message` or `detail` (including a nested `error.message`). HTML bodies are ignored. Each error
keeps its HTTP `status`, and `isExpiredAudioError` uses it.

### 7.4 Retries and timeouts

- `send()` tries a request up to **8 times for rate limits** and **3 times for other retryable
  errors**. Between attempts it waits `min(max(retryAfterMs ?? 1000·2^(attempt−1), 1000),
  60000)` ms, which can be aborted.
- Reads (`READ_RETRY`) retry `rateLimit`, `network` and `server`. **Submits (`SUBMIT_RETRY`)
  retry only `rateLimit`:** after a network or server error TTS.ai may already have created the
  job, and sending it again could bill a duplicate. A 429 means the job was never created.
- axios timeouts: 30 s for API calls, 60 s for audio downloads.
- On top of that, `useGeneration` fails a row after 3 failed status checks in a row, or once the
  job is 10 minutes old. Samples give up after 120 checks, about 3 minutes.

### 7.5 Key and origin

- `API_ORIGIN = (VITE_TTS_API_ORIGIN || "/tts-api")` with trailing slashes removed. The API
  client's base URL is `${API_ORIGIN}/v1`.
- `Authorization: Bearer <currentApiKey()>` is added per request, only when there's a key.
- `vite.config.ts` → `test.env` forces `VITE_TTS_API_KEY=test-key` and
  `VITE_TTS_API_ORIGIN=https://tts.test` in tests.

### 7.6 Observed TTS.ai behavior the code relies on

| Observation | When / source | Where it matters |
| --- | --- | --- |
| Browser requests from any site are accepted (CORS) | checked 2026-10-25 | the hosted build calls TTS.ai directly; if this changes, it needs a proxy |
| An identical request is answered at once with the audio it already made: `credits_used: 0`, flagged `cached`, no `credits_remaining` | voice benchmark, 2026-10-25 | samples are free after the first; the benchmark varies its phrases; a resubmit after Stop may be free |
| No balance endpoint; `credits_remaining` didn't drop while jobs were being charged | 2026-10-25 | the app counts `credits_used` itself and labels the balance as TTS.ai's figure |
| No `X-RateLimit-*` headers are sent | 2026-10-25 | no per-minute counter; 429 handling still reads them if they appear |
| Voice IDs repeat across models (`FR`: melotts and openvoice) | voice list | voice key = `model:id` |
| piper, vits and bark-small return WAV labeled `audio/mpeg` even when MP3 is requested | 2026-10-25 | WAV → MP3 conversion (§8) |
| Prices are 1, 2 or 4 credits per character (free, standard, premium). kokoro was charged as free although the docs list it as standard. | benchmark 2026-10-25 + <https://tts.ai/api> | `MODEL_TIERS` |
| moss-tts answers HTTP 400 `model_disabled`; zonos answers HTTP 400 `invalid_model` | 2026-10-25 | both hidden |
| How long result links stay valid isn't documented | — | 404/410 → expired |
| Status replies contained `status`, `result_url`, `url`, `finished_at`, `transferred` | benchmark `.jsonl`, 2026-10-25 | only `status` and the URL fields are read |

---

## 8. Audio pipeline (WAV → MP3)

```
loadAudio(url)                                                       services/audio.ts
 ├─ cached for this URL? → the same promise (overlapping loads share one request)
 └─ downloadAudio(url) → toMp3(blob) → cached (removed from the cache if it fails)

toMp3(blob)
 ├─ isWav(blob)?  first 12 bytes are "RIFF" ... "WAVE"            services/wavHeader.ts
 │     no  → return the blob unchanged (it's MP3)
 │     yes ↓
 ├─ conversionWorker()  created on first use:
 │     new Worker(new URL("./mp3Worker.ts", import.meta.url), { type: "module" })
 │     post { id, wav: ArrayBuffer (transferred, not copied) } → reply { id, mp3 } or { id, error }
 │     worker onerror → reject every waiting job, terminate it, never use a worker again
 ├─ no worker, or the worker failed → await import("./wavToMp3") and convert on the page
 └─ anything throws, even the WAV check → console.warn and return the ORIGINAL blob
```

`readWav` (`src/services/wavToMp3.ts`):

- Walks the RIFF chunks from byte 12. Odd-sized chunks are followed by a pad byte.
- From `fmt `, it reads the format code, channel count, sample rate and bit depth. For
  `WAVE_FORMAT_EXTENSIBLE` (0xFFFE) the real code is read from the sub-format GUID.
- `data` must be 16-bit integer PCM (piper, vits) or 32-bit IEEE float (bark-small). Anything
  else throws, and the original file is kept. A declared size of 0 (left by streaming writers) or
  a size past the end means "read to the end of the file". A WAV without samples throws instead
  of becoming a silent MP3.
- `decode` keeps at most 2 channels. NaN or infinite float samples count as 0. If float audio
  peaks above 1.0 (bark-small reaches about 1.7), the whole clip is turned down by 1/peak instead
  of being clipped. Then it converts to 16-bit.

`encodeMp3`: lamejs `Mp3Encoder(channels, sampleRate, 64 kbps)`, fed in 1152-sample frames,
then flushed. The result is `audio/mpeg`.

Only queue files (Play, Download, ZIP) go through this. Voice samples are played as TTS.ai sent
them. The encoder (`@breezystack/lamejs`, LGPL-3.0) is imported only by `wavToMp3.ts`, so the
build puts it in its own files (§10).

---

## 9. Voice catalog (`src/utils/voices.ts`)

The voice list from TTS.ai has no fields for quality, speed behavior or price, so these are
hard-coded from checks. Every set is keyed by voice key (`model:id`).

| Data | Contents (as of 2026-10-29) | Used for |
| --- | --- | --- |
| `HIDDEN_VOICES` (key → display name) | 9 French voices: `bark:v2/fr_speaker_0`, `bark:v2/fr_speaker_1`, `bark-small:v2/fr_speaker_0`, `cosyvoice2:French Female`, `cosyvoice3:法文女`, `moss-tts:default_fr`, `moss-tts-nano:default_fr`, `pocket-tts:jean_fr`, `zonos:french_male` | removed in `useVoices`; dropped from restored settings and waiting rows (`session.ts`); the name is kept so rows made before the voice was hidden still show it (`voiceName`) |
| `TESTED_VOICES` | 8: `kokoro:ff_siwis`, `melotts:FR`, `openvoice:FR`, `piper:fr_FR-siwis-medium`, `pocket-tts:fantine_fr`, `qwen3-tts:eric_fr`, `qwen3-tts:vivian_fr`, `vits:css10_fr` | the **Tested voices only** box (on by default) |
| `FOLLOWS_SPEED` | 3: `kokoro:ff_siwis`, `melotts:FR`, `piper:fr_FR-siwis-medium` | the **Responds to speed control** box |
| `IGNORES_SPEED` | 5: `openvoice:FR`, `vits:css10_fr`, `pocket-tts:fantine_fr`, `qwen3-tts:eric_fr`, `qwen3-tts:vivian_fr` | the label suffix " · ignores speed" (`formatVoiceLabel`) |
| `MODEL_TIERS` (per model) | free: kokoro, melotts, piper, pocket-tts, vits · standard: bark, bark-small, cosyvoice2, cosyvoice3, moss-tts-nano, qwen3-tts · premium: chatterbox, openvoice, tortoise · any other model: unknown | the **Price, low to high** groups: "Free tier · 1 credit per character", "Standard · 2…", "Premium · 4…", "Price not known yet" |

Checks behind these lists (the comments next to each entry record the evidence):

- **Speaking French:** each of the 17 French voices said a word and a sentence, transcribed by
  TTS.ai's speech-to-text (Whisper). The voices that added words, repeated or garbled them, cut
  them short, or never generated were hidden. bark-small was hidden later because its clips stop
  abruptly.
- **Speed:** "une rivière" was timed at 0.5×, 1× and 2×. A voice follows the setting when its
  clip is about twice as long at 0.5× and half as long at 2×.
- **Price:** `credits_used` ÷ text length in the benchmark (French models, 2026-10-25). vits,
  tortoise and chatterbox come from TTS.ai's docs.
- None of these checks is a script in the repository. Only the timing benchmark is
  (CURRENT_STATE.md, Technical debt).

Arranging a list (`arrangeVoices` and `arrangeVoiceList`):

1. Filter: `testedOnly` keeps `TESTED_VOICES`; `followsSpeed` keeps `FOLLOWS_SPEED`.
2. Sort when `byName` is on: `Intl.Collator` on the name, then on the model. Otherwise TTS.ai's
   order is kept.
3. Group when `byPrice` is on: free, standard, premium, unknown, leaving out empty groups.
   Otherwise one ungrouped list.
4. `arrangeVoiceList` adds `shown` (the set of displayed keys) and `emptyMessage`, which names the
   box that emptied the list ("No tested voices here. Only French voices have been tested so
   far." or "None of these voices is known to respond to speed control.").

Defaults: `DEFAULT_VOICE_LIST = { testedOnly: true, byPrice: false, followsSpeed: false,
byName: true }`. Languages: `primaryLanguage("fr-FR") === "fr"`; `summarizeLanguages` sorts by
the English name (`Intl.DisplayNames`); `defaultLanguage` is `"fr"` when present, else `"all"`;
`formatLanguageCount` gives "8", or "0 of 40" when the boxes hide some.

Pickers:

- `VoiceSelect` shows the current choice first even when the filters hide it, gives the
  empty-list message its own disabled option (value `__no-voices__`, never `""`), and uses
  `<optgroup>` when the list is grouped.
- `VoiceChecklist` (the pool in Random Assignment and Round Robin) puts picked voices the filters
  hide first, under "Selected, but hidden by the language or Sort voices", so they can be
  unticked. **Select all shown** adds the displayed voices in screen order.
- `SpeakerOrder` (Round Robin) shows the rotation with **Move Up** and **Move Down**.

---

## 10. Build, bundling and deployment

- **`vite.config.ts`**:
  - `base: "./"` makes every asset URL relative, so the site works from any subfolder (GitHub
    Pages serves it from `/vocab-audio-generator/`). Vite also rewrites the root-relative icon
    links in `index.html` (`/favicon-32.png` → `./favicon-32.png`), as a build on 2026-10-29
    confirmed.
  - Plugins: `@vitejs/plugin-react` and `@tailwindcss/vite`.
  - `server.proxy` and `preview.proxy` set up `/tts-api` (§1).
  - `test.env` (§7.5) and `test.setupFiles: ["src/test/setup.ts"]`.
- **TypeScript** (project references in `tsconfig.json`):
  - `tsconfig.app.json` covers `src/`: ES2022 with the DOM libraries, `moduleResolution:
    "bundler"`, `verbatimModuleSyntax`, `allowImportingTsExtensions`, `noEmit`, `jsx:
    "react-jsx"`. It's strict, plus `noUncheckedIndexedAccess`, `noImplicitOverride`,
    `noImplicitReturns`, `noUnusedLocals`, `noUnusedParameters` and
    `noFallthroughCasesInSwitch`.
  - `tsconfig.node.json` covers `vite.config.ts` and `scripts/`: ES2023 with Node types,
    `strict`, `noUnusedLocals` and `noUnusedParameters`. It doesn't set
    `noUncheckedIndexedAccess`, `noImplicitOverride`, `noImplicitReturns` or
    `noFallthroughCasesInSwitch`.
  - `npm run build` is `tsc -b && vite build`, so a type error fails the build.
- **Styles:** `src/index.css` (`@import "tailwindcss"`, a light color scheme, the
  `bg-slate-50 text-slate-900` body). Everything else is Tailwind utility classes in the JSX.
- **Output** (a build on 2026-10-29 with CI's variables): `index.html`; the icons from `public/`;
  `assets/index-*.js` ≈ 430 KB (137 KB gzipped: React, axios, JSZip, uuid and the app);
  `assets/index-*.css` ≈ 30 KB (6.4 KB gzipped); `assets/mp3Worker-*.js` ≈ 165 KB (the worker,
  with lamejs); `assets/wavToMp3-*.js` ≈ 164 KB (58 KB gzipped; lamejs, for the on-page
  fallback). lamejs is only in the last two.
- **Build-time variables:** `VITE_TTS_API_KEY` (local development only) and
  `VITE_TTS_API_ORIGIN` (default `/tts-api`) are compiled into the JavaScript. They're typed in
  `src/vite-env.d.ts`.
- **CI/CD** (`.github/workflows/deploy-pages.yml`):
  - Triggers: every push to `main`, plus a manual run.
  - Job `build`: `ubuntu-latest`, Node 24 with the npm cache, `npm ci`, `npm test`, then
    `npm run build` with `VITE_TTS_API_ORIGIN=https://api.tts.ai` and `VITE_TTS_API_KEY=""`,
    then upload `dist/` as the Pages artifact.
  - Job `deploy`: `actions/deploy-pages` to the `github-pages` environment.
  - Permissions `contents: read`, `pages: write`, `id-token: write`. Concurrency group `pages`,
    without cancelling a deploy in progress.
  - One-time repository setting: Settings → Pages → Source: GitHub Actions.
  - **A push to `main` is a production release.**
- **Icons:** `index.html` links `/favicon-32.png` (PNG first, with `sizes`), `/favicon.svg` and
  `/apple-touch-icon.png`. `public/favicon.svg` is drawn by hand. The PNGs are drawn by
  `npm run icons` (§12). Tests keep all three consistent with the header icon in `App.tsx`.

---

## 11. Testing

- **Runner:** Vitest 5. `npm test` (`vitest run`) runs once; `npm run test:watch` re-runs on
  changes. As of 2026-10-29: 26 files, 456 tests, about 33 s on the development machine.
- **Environment:** Node by default. Tests that need a DOM begin with
  `// @vitest-environment jsdom` and use React Testing Library (`render`, `screen`,
  `fireEvent`, `within`, `waitFor`, `renderHook`). There's no jest-dom: assertions use plain
  matchers such as `toHaveProperty("value", …)` and `not.toBeNull()`.
- **Network:** `src/test/server.ts` is an MSW `setupServer()` with no default handlers. Tests
  add handlers with `server.use(http.get/post(...))` from `msw/http`. `src/test/setup.ts` calls
  `server.listen({ onUnhandledFrame: "error" })`, so **any request without a handler fails**,
  resets the handlers after each test, and closes the server at the end. Requests go to
  `https://tts.test/v1/...` (from `import.meta.env.VITE_TTS_API_ORIGIN`).
- **axios under Node:** `src/test/setup.ts` sets `axios.defaults.adapter = "fetch"` **before**
  `ttsApi.ts` creates its instances, so `responseType: "blob"` returns real `Blob`s as in the
  browser.
- **Helpers:** `src/test/wav.ts` → `wavFile({...})` builds WAV files in memory: PCM or float,
  extensible headers, LIST chunks, a missing data chunk, a declared size.
- **App-level tests** (`src/App.test.tsx`) render the whole app with two mock voices (piper and
  melotts). They:
  - stub `HTMLMediaElement.play`/`pause`, `URL.createObjectURL`/`revokeObjectURL`,
    `HTMLAnchorElement.click` and `window.confirm`;
  - wrap `previewSpeaker`, `arrangeVoiceList` and `retainAudio` with `vi.mock(...)` to count
    calls;
  - simulate reloads by unmounting and rendering again over the same `sessionStorage`.
- **Script tests:** `scripts/*.test.ts` run under the same Vitest. The icon tests read
  `src/App.tsx`, `public/favicon.svg` and `index.html` as text (AGENT_CONTEXT.md, Gotchas).
- **No direct tests** for `useGeneration` (Stop, a 401 ending the run, the poll-failure limit,
  the 10-minute limit, a rejected submit) or `useVoices`, and no test files for `ProgressPanel`,
  `Toolbar`, `QueueTable`, `StatusBadge`, `Notice`, `Section`, `Spinner` or `ErrorBoundary`.
  App tests exercise them only where they render (NEXT_STEPS.md, N1–N2).

---

## 12. Scripts

All scripts run as TypeScript directly in Node (`node scripts/<name>.ts`), using Node's built-in
type stripping (Node 22.18+ or 23.6+; the project requires 22.22.2+). They import with `.ts`
extensions and run `main()` only when `startedAsScript(import.meta.url)` is true, so tests can
import them.

- **`scripts/benchmark-voices.ts`** (`npm run benchmark:voices -- [options]`): times each voice
  from submit until a status check sees it finished, then ranks them.
  - Standalone on purpose: `ttsApi.ts` depends on Vite, and its retries would skew the timings.
  - Reads `VITE_TTS_API_KEY` from `.env` (`process.loadEnvFile(".env")`, relative to the current
    folder) or the shell. Calls `https://api.tts.ai` directly.
  - Prints the voices and a cost estimate, then asks; `--yes` skips the question, and
    `--dry-run` stops after the estimate. With no terminal it refuses unless `--yes` is given.
  - Rotates through 16 built-in 11-character phrases so TTS.ai's reuse of identical requests
    doesn't fake a fast time. A reply flagged `cached`, or with `credits_used === 0`, isn't
    timed.
  - Jobs run one at a time, in a new random (Fisher–Yates) order each round. Timeouts count as
    the timeout in the median.
  - Submits retry only 429; reads also retry network and 5xx errors, up to 5 attempts.
  - Writes `benchmark-results/voices-<timestamp>.jsonl` (each run as it finishes) and `.csv`
    (the summary), relative to the current folder.
- **`scripts/make-icons.ts`** (`npm run icons`): draws `public/favicon-32.png` (rounded corners,
  transparent outside) and `public/apple-touch-icon.png` (180 px, a full square because iOS
  rounds the corners itself). It uses a small signed-distance rasterizer and its own PNG encoder
  (`node:zlib`). The shapes come from the exported `ICON_PATH`, `ICON_BLUE` and `ICON_RADIUS`.
  Paths are resolved from the repository root (`REPO_ROOT`).
- **`scripts/startedAsScript.ts`**: `startedAsScript(moduleUrl)` compares `import.meta.url`
  with the real path of `process.argv[1]`. It resolves folder links and junctions first, because
  Node does. (`import.meta.main` would do the same job, but only exists from Node 22.18 and
  24.2.)
