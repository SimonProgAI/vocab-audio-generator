# French Vocabulary Audio Generator

## TL;DR

- **What it is:** a browser-only React 19 + TypeScript app, built with Vite and styled with
  Tailwind CSS 4. It turns a vocabulary list into one MP3 per word or phrase using the
  [TTS.ai](https://tts.ai/api) API. Live at <https://simonprogai.github.io/vocab-audio-generator/>.
- **No backend.** The page calls TTS.ai directly with the visitor's own API key, which stays in
  their browser.
- **How it's used:** paste one item per line → pick a speaker mode (Single Speaker, Per File,
  Random Assignment, Round Robin) and a speed (0.5×–2.0×) → **Generate All** → **Play**,
  **Download**, or **Download All (ZIP)**.
- **Credits cost money,** so the app avoids paying twice. It never resubmits a job after a network
  or server error, skips rows already made with the current settings, and checks on interrupted
  jobs after a reload instead of submitting new ones.
- **Voices:** only the French ones have been checked. 9 of the 17 French voices are hidden as
  unreliable. Of the 8 left, only kokoro, melotts and piper follow the speed setting
  (`src/utils/voices.ts`).
- **Real MP3s:** piper and vits send WAV, which the browser converts to MP3 with `lamejs`
  (LGPL-3.0, built into separate files).
- **Persistence:** the queue, the Bulk Import text, the settings and the credit count survive a
  reload in the same tab (`sessionStorage`). They're gone when the tab closes.
- **Run it:** `npm install`, then `npm run dev`, then enter a TTS.ai key in the page. `npm test`
  never calls TTS.ai or spends credits.
- **Deploy:** every push to `main` is tested, built and published to GitHub Pages.
- **Security:** never build a public copy with `VITE_TTS_API_KEY` set. Vite compiles it into the
  JavaScript.
- **Changing the code?** Read [AGENT_CONTEXT.md](AGENT_CONTEXT.md) first. The other project docs
  are listed under [Project documentation](#project-documentation).

## Overview

Batch-generate MP3 vocabulary recordings with the [TTS.ai](https://tts.ai/api) API.
Paste a word list, choose how voices are assigned, click **Generate All**, and download
each file or the whole set as `vocabulary_audio.zip`.

Live version: <https://simonprogai.github.io/vocab-audio-generator/>. Bring your own TTS.ai
API key: enter it in the box at the top of the page.

The page has four numbered steps: **1 Bulk Import** (paste the list), **2 Speaker Settings**
(assignment mode, voice language, Sort voices, global speed), **3 Queue** (each row's text,
filename, speed and speaker, plus Play, Sample and Download) and **4 Progress**. A toolbar fixed
to the bottom of the window holds **Generate All** (or **Stop**), the credit counter, **Download
All (ZIP)** and **Clear Queue**. The header has **Reset**.

## Goals

There's no written product brief. These goals are inferred from the code, the interface text
and the commit history (2026-10-23 to 2026-10-26):

1. **One clean MP3 per vocabulary item**, named after its text (`une rivière` →
   `une_riviere.mp3`), for French learning material.
2. **Control over who speaks:** one voice for everything, a voice per row, a random mix from a
   pool, or a fixed rotation, chosen from voices checked to speak French properly.
3. **Slower speech for beginners:** 0.5× to 2.0×, for every file or per row.
4. **Spend as few TTS.ai credits as possible,** and show what was spent.
5. **Safe to host publicly:** no shared key and nothing secret in the build. Visitors bring
   their own key.
6. **Don't lose work:** a refresh or an accidental back navigation keeps everything.

Out of scope, as far as the code shows: accounts, a server, keeping data after the tab closes,
editing audio, and checking voices in languages other than French. Open questions about the
goals are in [CURRENT_STATE.md](CURRENT_STATE.md#open-questions).

## Setup

### Requirements

- **Node.js 22.22.2 or newer** (`engines` in `package.json`; it's the minimum for Vitest and
  jsdom). The GitHub Pages build uses Node 24. Development so far used Node 25 on Windows 11.
- **npm.** CI installs with `npm ci` from `package-lock.json`.
- **A TTS.ai API key** for real use, created in your TTS.ai account settings. Without one,
  TTS.ai only allows limited anonymous use of its free voices.
- **A current desktop browser.** The build targets ES2022. Web Workers, `sessionStorage` and
  `localStorage` are used when they're available but aren't required. The queue table is 1,100
  px wide and scrolls sideways on narrow screens. There's no record of testing particular
  browsers.
- **Network access** to `https://api.tts.ai` and to the audio file links it returns.

### Install and run

```bash
npm install
npm run dev               # http://localhost:5173, then enter your key in the page
```

Or, for local development only, put the key in `.env` (`cp .env.example .env`, then set
`VITE_TTS_API_KEY`) so you don't have to enter it.

| Script                     | What it does                                                          |
| -------------------------- | --------------------------------------------------------------------- |
| `npm run dev`              | Dev server with the TTS.ai proxy                                      |
| `npm run build`            | Strict type check + production build to `dist`                        |
| `npm run preview`          | Serve the production build (proxy included)                           |
| `npm run typecheck`        | Type check only                                                       |
| `npm test`                 | Run the tests once (no real API calls)                                |
| `npm run test:watch`       | Re-run the tests on every file change                                 |
| `npm run benchmark:voices` | Time every French voice on TTS.ai (spends credits, asks first)        |
| `npm run icons`            | Redraw the PNG app icons from the same shapes as `public/favicon.svg` |

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

## High-level architecture

```
Browser: static files from GitHub Pages, or the Vite dev server
│
├─ components/   UI only: gets data and callbacks as props
├─ App.tsx       owns the page state and every event handler
├─ hooks/        useQueue (queue reducer) · useGeneration (submit and poll loop) · useVoices
│                useAudioPlayer (one clip at a time) · useSessionSaver (saving, 250 ms after changes stop)
├─ services/     ttsApi (the only code that calls TTS.ai) · assignment · session · apiKey
│                audio + wavToMp3 + mp3Worker (WAV → MP3) · download · voiceSample
├─ utils/        pure helpers: the voice catalog, slugify, speed, credits, format, wait
├─ sessionStorage                  the queue, Bulk Import text, settings and credit count
└─ sessionStorage or localStorage  the visitor's API key
        │
        │  HTTPS with "Authorization: Bearer <key>"
        │  npm run dev / preview: through the /tts-api proxy · hosted: straight to TTS.ai
        ▼
TTS.ai API, https://api.tts.ai/v1: GET /voices/ · POST /tts/ · GET /speech/results/?uuid=…
plus the audio file links it returns (fetched without the key)
```

- `src/App.tsx` is the only place that holds page state and starts side effects. Components
  render what they're given and report what the user did.
- Generating means submitting one job per row and polling TTS.ai until each finishes. A row
  counts as done only while its audio matches the current speaker and speed.
- Everything the page needs after a reload goes into one `sessionStorage` entry. Audio files
  live in memory only and are fetched again from their links when needed.

The full design is in [ARCHITECTURE.md](ARCHITECTURE.md), and the reasons behind it are in
[DECISIONS.md](DECISIONS.md).

## Directory structure

```
.
├── .github/workflows/deploy-pages.yml   tests, builds and publishes to GitHub Pages on every push to main
├── public/                         favicon.svg, favicon-32.png, apple-touch-icon.png
│                                   (the PNGs are drawn by npm run icons)
├── scripts/                        Node scripts, run as TypeScript without a build step
│   ├── benchmark-voices.ts         npm run benchmark:voices (spends credits, asks first)
│   ├── make-icons.ts               npm run icons
│   └── startedAsScript.ts          "run main() only when started as a script" check
├── src/
│   ├── main.tsx                    entry point: StrictMode + ErrorBoundary + App
│   ├── App.tsx                     page layout and top-level state; every event handler
│   ├── index.css                   Tailwind import and page colors
│   ├── components/                 BulkImport, SpeakerSettings, QueueTable, QueueRow,
│   │                               ProgressPanel, Toolbar, ApiKeySettings, VoiceSelect,
│   │                               CreditCounter + small shared UI pieces (Button, Section,
│   │                               Notice, StatusBadge, Spinner, ErrorBoundary, fieldStyles)
│   ├── hooks/
│   │   ├── useQueue.ts             queue reducer (useReducer)
│   │   ├── useGeneration.ts        submit → poll → update loop, with Stop and resuming
│   │   ├── useVoices.ts            loads the voice list
│   │   ├── useAudioPlayer.ts       plays one clip at a time
│   │   └── useSessionSaver.ts      saves the session once changes pause
│   ├── services/
│   │   ├── ttsApi.ts               the only module that talks to TTS.ai (retries, error mapping, parsing)
│   │   ├── assignment.ts           speaker modes, validation, "is this row up to date?"
│   │   ├── session.ts              saves, loads and checks the tab's session
│   │   ├── apiKey.ts               the visitor's API key (this tab, or remembered)
│   │   ├── audio.ts                audio cache shared by Play, Download and the ZIP; WAV → MP3
│   │   ├── wavToMp3.ts             WAV reader + MP3 encoder (lamejs)
│   │   ├── mp3Worker.ts            runs wavToMp3 in a Web Worker
│   │   ├── wavHeader.ts            "is this a WAV file?"
│   │   ├── download.ts             single MP3 + ZIP downloads
│   │   └── voiceSample.ts          the Sample button's short TTS jobs
│   ├── utils/                      voices (hidden, tested, speed and price lists), slugify,
│   │                               speed, credits, format, wait helpers
│   ├── test/                       MSW mock server + Vitest setup + WAV builder
│   │                               (tests sit next to their code)
│   ├── types/queue.ts              shared domain types
│   └── vite-env.d.ts               types for the VITE_* variables
├── index.html                      page shell and icon links
├── vite.config.ts                  relative base path, /tts-api proxy, test settings
├── tsconfig*.json                  type checks for the app (src) and for Node (vite.config.ts, scripts)
├── .env.example                    copy to .env for local development
├── AGENTS.md                       read automatically by coding agents; points them to AGENT_CONTEXT.md
├── ARCHITECTURE.md … SESSION_SUMMARY.md   project docs (see Project documentation)
└── LICENSE                         MIT
```

Git-ignored, so they exist only on a developer's machine: `node_modules/`, `dist/` (the build),
`.env`, `benchmark-results/` and `*.tsbuildinfo`.

## How it works

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
- **Voice quality**: 9 of the 17 voices TTS.ai labels French are hidden (`HIDDEN_VOICES` in
  `utils/voices.ts`). In a check on 2026-10-26, where each voice said a word and a sentence and
  TTS.ai's speech-to-text transcribed them, they added words, repeated or garbled the text, or
  always failed; bark-small was dropped later because its clips stop abruptly mid-sound. Voices
  whose audio didn't get slower at 0.5× and faster at 2× are labeled "ignores speed"
  (`IGNORES_SPEED`); of the French voices, only kokoro, melotts and piper follow it
  (`FOLLOWS_SPEED`). Voices nobody has checked aren't assumed to follow it.
- **Sort voices**: four checkboxes apply to every speaker list (`arrangeVoiceList` in
  `utils/voices.ts`, worked out once in `App` and shared by every picker). **Tested voices only**
  hides voices that weren't checked (every language but French). **Price, low to high** groups by
  price tier. **Responds to speed control** keeps only kokoro, melotts and piper. **By name
  (A–Z)** sorts by name, inside each price group when both are on; with it off, voices keep
  TTS.ai's order. A first visit, and **Reset**, start with Tested voices only and By name. A list
  the boxes leave empty says which box did it. Voices you picked that the language or the boxes
  now hide stay in the voice pool, under "Selected, but hidden…", so they can still be unticked.
  The language counts follow the boxes too: "English (0 of 40)".
- **Real MP3s**: piper and vits return WAV even though the app asks for MP3 (TTS.ai still labels
  it `audio/mpeg`); so does bark-small, still listed for other languages. The first time such a
  file is played, downloaded or zipped, it's converted to 64 kbps MP3 (`services/wavToMp3.ts`) in
  a background worker (`services/mp3Worker.ts`), so a big ZIP doesn't freeze the page; browsers
  that can't run it convert on the page instead. Loud or broken float samples are turned down or
  silenced rather than clipped, a WAV that declares no data size is read to its end, and if
  anything fails the original audio is kept. Voice samples are only played, so they aren't
  converted.
- **Voice tiers**: the voice list has no prices, so `utils/voices.ts` maps each model to TTS.ai's
  price tier (free = 1 credit per character, standard = 2, premium = 4), measured with
  `npm run benchmark:voices`. **Price, low to high** groups every speaker list by tier;
  unmapped models appear under "Price not known yet".
- **Downloaded mark**: once a row's file is saved, by **Download** or inside **Download All
  (ZIP)**, its button turns amber and reads **Download again**. The mark (`downloadedUrl` on the
  row) only counts while it matches the row's audio link, so regenerating clears it, and it's
  saved with the session. Buttons darken on hover and press down on click (no animation for people
  who ask their system for less motion).
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

## Project documentation

These files are the project's long-term memory. They're written so that someone with only this
repository (a person or an AI agent) can pick up the work.

| Document                                   | What's in it                                                                                    |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| [ARCHITECTURE.md](ARCHITECTURE.md)         | Modules, component tree, state, data flows, the TTS.ai API as the code uses it, audio, build, tests |
| [CURRENT_STATE.md](CURRENT_STATE.md)       | What works and how that was checked, what's partial, limitations, technical debt, open questions |
| [DECISIONS.md](DECISIONS.md)               | Why things are built the way they are, the alternatives, and the assumptions                    |
| [NEXT_STEPS.md](NEXT_STEPS.md)             | Suggested tasks in priority order, with their dependencies                                      |
| [AGENT_CONTEXT.md](AGENT_CONTEXT.md)       | Rules, conventions and gotchas to know before changing anything                                 |
| [AGENTS.md](AGENTS.md)                     | A short entry point that coding agents (Claude Code, Codex, Cursor and others) read on their own; it sends them to AGENT_CONTEXT.md |
| [SESSION_SUMMARY.md](SESSION_SUMMARY.md)   | The latest analysis session: findings, risks, and the first thing to do next                    |

## Known issues

- **Slow speakers**: some speakers take an excessively long time to generate files.
  `npm run benchmark:voices` measures this (see [Benchmarking voices](#benchmarking-voices)).
- **Failing speakers**: French voices that failed or didn't speak French reliably are hidden (see
  **Voice quality** above). A session saved before a voice was hidden drops it from the speaker
  settings and from rows still waiting for audio; rows that have audio keep it, under the voice's
  name. Re-check the voices now and then: TTS.ai changes its models.
- **Speed**: 5 of the 8 remaining French voices ignore the speed setting; their labels say so.

## TODO


## License

MIT. See [LICENSE](LICENSE).

The MP3 encoder, [`@breezystack/lamejs`](https://www.npmjs.com/package/@breezystack/lamejs) (a
JavaScript port of LAME), is LGPL-3.0. It's built into its own files (`assets/mp3Worker-*.js`
for the background worker, and `assets/wavToMp3-*.js` for browsers without one), so it can be
replaced without touching the rest of the app.
