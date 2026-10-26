# French Vocabulary Audio Generator

Batch-generate MP3 vocabulary recordings with the [TTS.ai](https://tts.ai/api) API.
Paste a word list, choose how voices are assigned, click **Generate All**, and download
each file or the whole set as `vocabulary_audio.zip`.

Live version: <https://simonprogai.github.io/vocab-audio-generator/>. Bring your own TTS.ai
API key: enter it in the box at the top of the page.

## Setup

```bash
npm install
npm run dev               # http://localhost:5173, then enter your key in the page
```

Or, for local development only, put the key in `.env` (`cp .env.example .env`, then set
`VITE_TTS_API_KEY`) so you don't have to enter it.

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

| Variable              | Required | Default    | Notes                                                                |
| --------------------- | -------- | ---------- | -------------------------------------------------------------------- |
| `VITE_TTS_API_KEY`    | No       | none       | Local development only. Used when no key was entered in the page.    |
| `VITE_TTS_API_ORIGIN` | No       | `/tts-api` | `/tts-api` is the Vite dev/preview proxy to `https://api.tts.ai`.    |

**Security:** `VITE_*` variables are compiled into the JavaScript bundle, so anyone who can
open the built site can read them. Never build a public copy with `VITE_TTS_API_KEY` set; the
GitHub Pages workflow forces it empty. Visitors enter their own key instead, which stays in their
browser and is only sent to TTS.ai. TTS.ai accepts browser requests from any site (checked
2026-10-25), so a hosted build calls `https://api.tts.ai` directly and needs no proxy.

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
- **API key**: the box at the top keeps the visitor's key for the current tab (sessionStorage),
  or on the device with **Remember** (localStorage), and `services/apiKey.ts` reads it for every
  request. **Forget** removes it; **Reset** leaves it alone. Without one, the built-in
  `VITE_TTS_API_KEY` is used (local development), else TTS.ai's limited anonymous access.
- **Session persistence**: the queue, the Bulk Import text (even before it's added), the
  settings and the credit count are saved to `sessionStorage` (`services/session.ts`) and
  restored on load, so a refresh or back navigation keeps them. Saving waits until changes pause
  for 250 ms, and happens at once when the page is hidden or reloaded. The data belongs to the
  browser tab and is gone when the tab closes. Saved data is validated field by field. Rows that
  were still generating keep their TTS.ai job, and the app checks on those jobs again after the
  reload instead of submitting (and paying for) new ones.
- **Reset**: the header's **Reset** button (after a confirmation) empties the queue and the Bulk
  Import box and restores the default settings, so a reload afterwards starts blank.
  **Clear Queue** only removes the files.
- **Voice quality**: 8 of the 17 voices TTS.ai labels French are hidden (`HIDDEN_VOICES` in
  `utils/voices.ts`). In a check on 2026-10-26, where each voice said a word and a sentence and
  TTS.ai's speech-to-text transcribed them, they added words, repeated or garbled the text, or
  always failed. Voices whose audio didn't get slower at 0.5× and faster at 2× are labeled
  "ignores speed" (`IGNORES_SPEED`); of the French voices, only kokoro, melotts and piper follow it
  (`FOLLOWS_SPEED`). **Sort voices → Follows speed, by price** lists just those, cheapest first;
  voices nobody has checked aren't assumed to follow it.
- **Real MP3s**: piper, vits and bark-small return WAV even though the app asks for MP3 (TTS.ai
  still labels it `audio/mpeg`). The first time such a file is played, downloaded or zipped, the
  browser converts it to 64 kbps MP3 (`services/wavToMp3.ts`); loud float audio is turned down to
  fit rather than clipped. If converting fails, the WAV is kept. The encoder is a separate file,
  loaded only when a WAV turns up.
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
  (`services/audio.ts`) while a row links to it, so Play, **Download** and the ZIP share it. A link
  that now answers 404 or 410 counts as expired, from any of the three: the row turns Failed (if
  it still has that link), so **Generate All** makes it again. A 403 is only reported, since it
  can be temporary. Pending rows have **Sample**: the row's voice says "Bonjour, ça va ?"
  (`services/voiceSample.ts`). TTS.ai has no preview clips, so a voice's first sample is a short
  real job (a few credits); it's kept for the session, and TTS.ai answers identical requests again
  for free. Stopping a sample stops checking on its job; asking again checks on the same job
  rather than paying for a new one. There's no Sample in random mode, where the voice is picked at
  generation. One clip plays at a time.

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

`npm run benchmark:voices` (in `scripts/`) has every French voice say short phrases of the same
length, times each job from submit until a status poll sees it finished, and ranks voices from
fastest to slowest. It **spends real credits**: it prints the voice list and a cost estimate and
asks before submitting anything. `--dry-run` stops after the estimate. Needs Node 22.18+ or 23.6+.

- TTS.ai answers a request it has seen before with the audio it already made, at once and for
  free. So each run uses the voice's next phrase (16 built in, all 11 characters), and a reply
  TTS.ai flags as reused isn't timed: the voice moves on to another phrase.
- Jobs run one at a time, in a new random order each round, so no voice waits behind another.
  The median of `--runs` (default 3) smooths out busy moments and cold starts.
- A timed-out run (`--timeout`, default 120 s) counts as the timeout in the median, shown as
  "≥", so voices that often time out rank last. Failures are listed under Problems.
- **Credits/char** is `credits_used` ÷ phrase length over charged runs: 1 = free tier,
  2 = standard, 4 = premium.
- Timings are only as precise as `--poll` (default 1 s), and 429 waits make them less precise.
- Options: `--text` (repeat it to give your own phrases), `--runs`, `--language` (`fr`, or
  `all`), `--model piper,melotts`, `--poll`, `--timeout`, `--yes` (skip the prompt),
  `--dry-run`. Pass them after `--`.
- Results go to `benchmark-results/` (git-ignored): a `.csv` summary and a `.jsonl` with every
  run, reused ones included, appended as it finishes with TTS.ai's last status reply.

## Deploying to GitHub Pages

`.github/workflows/deploy-pages.yml` tests, builds and publishes the site on every push to
`main`, to `https://<user>.github.io/<repo>/` (asset paths are relative, so any repo name works).
One-time setup: in the repository's **Settings → Pages**, set **Source** to **GitHub Actions**.

The build sets `VITE_TTS_API_ORIGIN=https://api.tts.ai` and an empty `VITE_TTS_API_KEY`, so no
key ships with the site. A key a visitor ticks **Remember** for is kept in `localStorage` for
`<user>.github.io`, which every Pages site of that GitHub account shares.

## Known issues

- **Slow speakers**: some speakers take an excessively long time to generate files.
  `npm run benchmark:voices` measures this (see [Benchmarking voices](#benchmarking-voices)).
- **Failing speakers**: French voices that failed or didn't speak French reliably are hidden (see
  **Voice quality** above). Re-check them now and then: TTS.ai changes its models.
- **Speed**: 6 of the 9 remaining French voices ignore the speed setting; their labels say so.

## TODO

Nothing open right now.

## License

MIT. See [LICENSE](LICENSE).

The MP3 encoder, [`@breezystack/lamejs`](https://www.npmjs.com/package/@breezystack/lamejs) (a
JavaScript port of LAME), is LGPL-3.0. It's built into its own file (`assets/wavToMp3-*.js`), so
it can be replaced without touching the rest of the app.
