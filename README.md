# French Vocabulary Audio Generator

Batch-generate MP3 vocabulary recordings with the [TTS.ai](https://tts.ai/api) API.
Paste a word list, choose how voices are assigned, click **Generate All**, and download
each file or the whole set as `vocabulary_audio.zip`.

## Setup

```bash
npm install
cp .env.example .env      # then set VITE_TTS_API_KEY
npm run dev               # http://localhost:5173
```

| Script               | What it does                                   |
| -------------------- | ---------------------------------------------- |
| `npm run dev`        | Dev server with the TTS.ai proxy               |
| `npm run build`      | Strict type check + production build to `dist` |
| `npm run preview`    | Serve the production build (proxy included)    |
| `npm run typecheck`  | Type check only                                |
| `npm test`           | Run the tests once (no real API calls)         |
| `npm run test:watch` | Re-run the tests on every file change          |

## Environment

| Variable              | Required | Default    | Notes                                                                 |
| --------------------- | -------- | ---------- | --------------------------------------------------------------------- |
| `VITE_TTS_API_KEY`    | Yes\*    | none       | \*Without it TTS.ai only allows limited anonymous use of free models. |
| `VITE_TTS_API_ORIGIN` | No       | `/tts-api` | `/tts-api` is the Vite proxy to `https://api.tts.ai` (avoids CORS).   |

**Security:** `VITE_*` variables are compiled into the JavaScript bundle, so anyone who can
open the built site can read the key. That's fine for running locally. For a shared deployment,
put a reverse proxy in front of TTS.ai that adds the `Authorization` header on the server, and
point `VITE_TTS_API_ORIGIN` at it.

## How it works

```
src/
├── App.tsx                 page layout and top-level state
├── components/             BulkImport, SpeakerSettings, QueueTable, QueueRow,
│                           ProgressPanel, Toolbar + small shared UI pieces
├── services/
│   ├── ttsApi.ts           the only module that talks to TTS.ai (retries, error mapping, parsing)
│   ├── assignment.ts       speaker modes, validation, "is this row up to date?"
│   └── download.ts         single MP3 + ZIP downloads
├── hooks/
│   ├── useQueue.ts         queue reducer (useReducer)
│   ├── useVoices.ts        loads the voice list
│   └── useGeneration.ts    submit → poll → update loop, with Stop
├── utils/                  slugify, speed, voices, wait, format helpers
├── test/                   MSW mock server + Vitest setup (tests sit next to their code)
└── types/queue.ts          shared domain types
```

- **Generation**: jobs are submitted one at a time while a poller checks every active job
  about every 1.5 s, so early files finish while later ones are still being submitted. HTTP 429
  responses are retried after `Retry-After` / `X-RateLimit-Reset`. Submissions are never retried
  after network or server errors, because a resend could create and bill a duplicate job.
- **Generate All** only processes rows that aren't already done with the current settings.
  Completed rows whose speaker or speed has since changed are flagged and regenerated.
  Editing a row's text resets it to Pending.
- **Voices**: TTS.ai reuses voice IDs across models (e.g. `FR` exists for both melotts and
  openvoice), so the app identifies voices by `model:id`. It sends the raw `id` and `model`
  to the API.
- **Filenames**: `slugify` strips accents (`une rivière` → `une_riviere`), turns spaces and
  punctuation into `_`, and removes `/ \ : * ? " < > |`. Duplicate names in the ZIP get `_2`,
  `_3`, and so on.

## Testing

Tests use [Vitest](https://vitest.dev) and sit next to the code they cover (`*.test.ts`). They
never call TTS.ai or spend credits:

- `vite.config.ts` swaps the `.env` key and origin for `test-key` and `https://tts.test`, a
  reserved domain that never resolves.
- [MSW](https://mswjs.io) answers the requests in `ttsApi.test.ts` and fails any request that
  has no handler.
- `src/test/setup.ts` switches axios to its fetch adapter, so audio downloads come back as
  `Blob`s under Node, as they do in the browser.

## Known issues

- **Slow speakers**: some speakers take an excessively long time to generate files.
- **Failing speakers**: some speakers fail to generate audio and return an error message.

## TODO

- [ ] **Per-file downloads**: give each completed row its own download action alongside
  **Download All (ZIP)**.
- [ ] **Session persistence**: persist the queue to `sessionStorage` and rehydrate it on load,
  so an accidental refresh or back navigation doesn't wipe a long word list.
- [ ] **Reset button**: add a **Clear** / **Reset** control that clears `sessionStorage` and
  reinitializes app state, so users can still start from a blank slate once state survives
  reloads.
- [ ] **Sort voices by tier**: add a sort/group option to `VoiceSelect` that separates free
  models (`piper`, `vits`, `melotts`) from paid tiers (standard / premium). `parseVoices`
  doesn't keep any pricing info today; use a tier field from `/v1/voices/` if one exists,
  otherwise add a model → tier map in `utils/voices.ts`.
- [ ] **Remaining-credits counter**: surface the key's remaining quota in the UI. TTS.ai bills in
  characters, not calls, so read `credits_remaining` from each TTS response (and optionally
  `X-RateLimit-Remaining` for the per-minute limit) and keep the latest value in app state.
