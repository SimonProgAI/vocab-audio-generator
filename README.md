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

| Script                     | What it does                                                   |
| -------------------------- | -------------------------------------------------------------- |
| `npm run dev`              | Dev server with the TTS.ai proxy                               |
| `npm run build`            | Strict type check + production build to `dist`                 |
| `npm run preview`          | Serve the production build (proxy included)                    |
| `npm run typecheck`        | Type check only                                                |
| `npm test`                 | Run the tests once (no real API calls)                         |
| `npm run test:watch`       | Re-run the tests on every file change                          |
| `npm run benchmark:voices` | Time every French voice on TTS.ai (spends credits, asks first) |

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
- **Session persistence**: the queue, the Bulk Import text (even before it's added) and the
  settings are saved to `sessionStorage` (`services/session.ts`) on every change and restored on
  load, so a refresh or back navigation keeps them. The data belongs to the browser tab and is
  gone when the tab closes. Saved data is validated field by field; rows that were still
  generating restart as Pending.
- **Reset**: the header's **Reset** button (after a confirmation) empties the queue and the Bulk
  Import box and restores the default settings, so a reload afterwards starts blank.
  **Clear Queue** only removes the files.
- **Voice tiers**: the voice list has no prices, so `utils/voices.ts` maps each model to TTS.ai's
  price tier (free = 1 credit per character, standard = 2, premium = 4), measured with
  `npm run benchmark:voices`. **Sort voices → By price** groups every speaker list by tier;
  unmapped models appear under "Price not known yet".
- **Credits**: the toolbar adds up `credits_used` from every job this tab submitted, including
  voice samples (audio TTS.ai already had costs 0). It also shows the latest `credits_remaining`,
  labeled as TTS.ai's figure because it didn't drop while jobs were being charged. TTS.ai has no
  balance endpoint and sends no `X-RateLimit-*` headers (checked 2026-10-25), so there's no
  per-minute counter. The count is saved with the session and cleared by **Reset**.
- **Audio preview**: completed rows have **Play**. Each file is fetched once and kept in memory
  (`services/audio.ts`), so Play, **Download** and the ZIP share it. A link that now answers 403,
  404 or 410 counts as expired: the row turns Failed, so **Generate All** makes it again. Pending
  rows have **Sample**: the row's voice says "Bonjour, ça va ?" (`services/voiceSample.ts`). TTS.ai
  has no preview clips, so a voice's first sample is a short real job (a few credits); it's kept
  for the session, and TTS.ai answers identical requests again for free. There's no Sample in
  random mode, where the voice is picked at generation. One clip plays at a time.

## Testing

Tests use [Vitest](https://vitest.dev) and sit next to the code they cover (`*.test.ts`,
`*.test.tsx`). They never call TTS.ai or spend credits:

- `vite.config.ts` swaps the `.env` key and origin for `test-key` and `https://tts.test`, a
  reserved domain that never resolves.
- [MSW](https://mswjs.io) answers the requests in `ttsApi.test.ts` and fails any request that
  has no handler.
- `src/test/setup.ts` switches axios to its fetch adapter, so audio downloads come back as
  `Blob`s under Node, as they do in the browser.
- Tests that need a DOM (components, saving files) start with `// @vitest-environment jsdom`
  and use [React Testing Library](https://testing-library.com/docs/react-testing-library/intro).

## Benchmarking voices

`npm run benchmark:voices` (in `scripts/`) gives every French voice the same text, times each
job from submit until a status poll sees it finished, and ranks voices from fastest to slowest.
It **spends real credits**: it prints the voice list and a cost estimate and asks before
submitting anything. `--dry-run` stops after the estimate.

- Jobs run one at a time, in a new random order each round, so no voice waits behind another.
  The median of `--runs` (default 3) smooths out busy moments and cold starts.
- Failed and timed-out runs (`--timeout`, default 120 s) are listed separately, not ranked.
- **Credits/char** is `credits_used` ÷ text length: 1 = free tier, 2 = standard, 4 = premium.
- Timings are only as precise as `--poll` (default 1 s), and 429 waits make them less precise.
- Options: `--text`, `--runs`, `--language` (`fr`, or `all`), `--model piper,melotts`,
  `--poll`, `--timeout`, `--yes` (skip the prompt), `--dry-run`. Pass them after `--`.
- Results go to `benchmark-results/` (git-ignored): a `.csv` summary and a `.jsonl` with every
  run, appended as it finishes, including TTS.ai's last status reply.

## Known issues

- **Slow speakers**: some speakers take an excessively long time to generate files.
- **Failing speakers**: some speakers fail to generate audio and return an error message.

`npm run benchmark:voices` measures both (see [Benchmarking voices](#benchmarking-voices)).

## TODO

Nothing open right now.
