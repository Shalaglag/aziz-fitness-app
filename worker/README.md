# Mizan coach service (Ask Claude)

A Cloudflare Worker between Mizan and the Claude API. It holds the API key, lets only the owner's account ask,
and keeps a monthly spending ledger so a question that would pass the cap is never sent.

- **Model:** Claude Haiku 5.5 (`claude-haiku-5-5`), fixed. No other model is ever called. Effort is `low`
  for ordinary questions and `medium` for "why / should I / plan" questions (the app decides; the service
  accepts only those two). `max_tokens` 900 / 1,400 (thinking plus a JSON answer of under 120 words).
- **Prices** (Haiku 5.5 list, checked 2026-11-02): $0.10 input / $0.50 output per million tokens, cache
  write $0.125, cache read $0.01. A typical question is about 5-6K input tokens and 300-700 output tokens,
  about **$0.001** (a tenth of a cent). 10 questions a day is about $0.30 a month.
- **Spending cap:** starts at **$100 a month** (Aziz, Nov 2), adjustable in the app between $1 and $100. A
  warning shows at 80 %. Before each call the ledger reserves a deliberately high estimate (every character
  counted as a token, all as a cache write, the whole `max_tokens`); a call that would pass the cap gets
  `402 cap_reached` and Claude is not called. When the answer ends the estimate is replaced by the cost of the
  tokens Anthropic reported. A call that fails before any text costs nothing; one cut off mid-answer is
  counted with the full `max_tokens`; one whose end is never seen is counted at its estimate after 10 minutes.
  The ledger is one Durable Object, which handles one reserve/settle at a time, so two questions can't both
  slip under the cap. The prepaid credit ($100 in total) is separate: when it runs out the app says so.
- **Who can ask:** a valid Firebase ID token from the `aziz-fitness` project (checked against Google's keys)
  whose email is in `ALLOWED_EMAILS` (or uid in `ALLOWED_UIDS`). Both empty = nobody. Anyone else who installs
  the APK gets `403 not_allowed` and can't spend the credit. Per account: 2 questions in flight, 6 a minute,
  60 a day.
- **Data:** the app sends the question, the last 4 turns and only the data sections the question needs
  (see `Coach.trimContext`). Bounds: question 600 characters, data 40,000 characters, history 4 turns. The
  service logs only status codes, never questions, answers or the key. Nothing is stored except the ledger
  totals (dollars, token counts, per-account counters).
- **Prompt caching:** the rules + data block carries one cache breakpoint. A follow-up question in the same
  chat reads it at a tenth of the price; a one-off question pays 1.25x on that block (about $0.0001).

## Endpoints

| | | |
|---|---|---|
| `GET /v1/health` | no sign-in | `{ok, model, keySet, ownerSet}`: is it set up? |
| `GET /v1/usage` | owner | this month: `capUsd, usedUsd (confirmed + unsettled), pendingUsd, allTimeUsd, requests, tokens, warn, stopped` |
| `POST /v1/cap` | owner | `{capUsd}` 1-100 |
| `POST /v1/chat` | owner | `{question, ctx, history, effort, lang}` → NDJSON: `{"t":"d","text"}` … `{"t":"done","costUsd","usage","month"}` or `{"t":"error","error"}` |
| `POST /v1/read` | owner | `{kind:"menu", images:[{media_type, data(base64)}]}` (up to 4, 2.5 MB each) → `{text, stop, costUsd, month}`. The menu-reading instructions are fixed on the server; each image is reserved as 6,000 tokens, so a menu costs well under a cent. Same ledger, cap and per-account limits as chat. |
| `POST /v1/tidy` | owner | `{text (≤ 2,000 chars), lang, hints[] (≤ 80 names)}` → `{text, costUsd, month}`. Cleans a voice transcript before the user sends it (misheard or mixed-up words, repeats, self-corrections); fixed prompt on the server, low effort, at most 600 output tokens, about $0.0003 each. Same ledger, cap and per-account limits as chat. |

Errors: `not_signed_in` 401, `not_allowed` 403, `cap_reached` / `out_of_credit` 402, `busy` / `rate_limited` /
`daily_limit` 429, `no_key` / `upstream_busy` / `bad_key` 503, `timeout` 504.

## Setup (once, free)

1. Create a free Cloudflare account: https://dash.cloudflare.com/sign-up (no card; the Free plan blocks
   instead of billing when a limit is reached).
2. Workers & Pages → Create → **Import a repository** → connect GitHub → `Shalaglag/aziz-fitness-app`.
   Project name `mizan-coach`, **Root directory `worker`**, deploy command `npx wrangler deploy` (the default).
   Optional: Settings → Build → Build watch paths `worker/*` so app-only pushes don't rebuild it.
3. The Worker → Settings → **Variables and Secrets**:
   - `ANTHROPIC_API_KEY`, type **Secret**: the key from https://platform.claude.com/settings/keys
   - `ALLOWED_EMAILS`, type Text: the email you sign in to Mizan with
4. Open `https://mizan-coach.<your-subdomain>.workers.dev/v1/health`: `keySet` and `ownerSet` should be `true`.
5. The app's built-in address is `coachEndpoint` in `app/cloud-config.js` (the BASE address, no `/v1/…`):
   `https://mizan-coach.a47alshaheen.workers.dev` since Nov 2. A different service can be set in Ask Claude → ⚙ AI
   settings; the field drops a pasted `/v1/health`, `/v1/chat`, `/v1/usage` or `/v1/cap` suffix. Ask a question and
   turn the AI chat on when asked.

The key is only ever typed into Cloudflare's secret field. It is never in the repo, the APK, the app's data,
browser storage or a chat.

## Tests

- `npm test` (repo root) runs `worker/test/core.test.js`: token checks, owner list, body limits, the request
  (model, effort, caching, history), Haiku prices, and the ledger (cap, 80 %, concurrency, lost answers,
  per-account limits, month rollover).
- `cd worker && npm install && node test/e2e.mjs`: the Worker in the local Workers runtime against a mock
  Claude: sign-in, strangers refused, streaming and cost, in-flight limit, 80 % and the hard stop, busy upstream,
  out of credit, timeout, cut-off stream.
- `node test/app-e2e.mjs [shot.png]`: the built app on a 360×800 screen → the local Worker → mock Claude:
  consent gate, English and Arabic answers, multi-turn, spending meter.
