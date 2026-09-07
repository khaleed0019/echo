# ECHO — your second brain, living inside your conversations

Built for the **$3,000 Photon iMessage Agent Challenge**
([tweet](https://x.com/photonhq/status/2095652251880784100)). Deadline: **Sep 10, 2026**.

> You live your life. Echo remembers everything else.

ECHO is a personal-context AI agent that lives on its own iMessage number
([Spectrum](https://docs.photon.codes)). It continuously turns conversations
into structured memory — commitments, deadlines, decisions, open questions —
and answers questions, briefs you, and proactively watches conversations on
your behalf. One database, one extraction pipeline, many surfaces: a daily
brief, a life timeline, a knowledge graph, a weekly review, a promise
tracker — all reading the same rows.

## The demo script this is built around

1. **"Echo, catch me up"** → the ECHO orb appears instantly, then *morphs in
   place* into a live animated brief card (URGENT / IMPORTANT / UPCOMING /
   COMMITMENTS / FOLLOW-UPS), plus a text summary. The morph uses Spectrum's
   `edit()` API on an already-sent app card — verified against
   docs.photon.codes' "App" content page.
2. **"Prioritize my day"** → today's plan, ranked
3. A screenshot is sent → ECHO reads it (Claude vision), finds the event,
   confirms via a real iMessage poll before adding it
4. A conversation is forwarded → ECHO flags the promise, the deadline, and
   the opportunity inside it
5. **"What am I forgetting?"** → surfaces stale/overdue commitments and
   questions
6. **"When James replies, summarize his answer and tell me what I need to
   do."** → ECHO registers a watch on the shared thread James is actually in;
   when he replies, ECHO proactively DMs *you* — in a completely different
   conversation than the one his reply arrived in. This is the "not a
   chatbot" moment.

## Architecture decisions

Two deliberate departures from the original product brief, both made to
protect a working live demo rather than to save effort:

- **SQLite via Bun's native `bun:sqlite`, not Postgres/Supabase.** Zero
  external services, zero auth setup, nothing that can be down on demo day.
  The dashboard reuses this same DB and the same Bun/Hono process rather than
  standing up a parallel Next.js app — one source of truth, no sync layer,
  no second deploy to keep alive. Migrating to Postgres is a legitimate
  "scale past one user" step, not a hackathon-week one.
- **Voice mode needs a third-party key, and is optional.** Claude's API is
  text+vision only — it does not accept audio in or produce audio out — so
  speech genuinely requires a separate STT/TTS provider. `src/voice.ts` is
  the only integration point (default OpenAI: one key covers Whisper STT and
  TTS; swap for Deepgram/ElevenLabs by rewriting two functions). With
  `VOICE_API_KEY` unset, ECHO runs exactly as before and says so plainly
  rather than half-working.

`echoSearch` (`src/search.ts`) is a real multi-turn tool-use retrieval loop —
Claude issues its own keyword searches across tables, several times if needed,
then synthesizes an answer with sources. It is *not* vector/embedding search;
at this data scale that would be ceremony, not capability. Called out plainly
rather than labeled "semantic."

**The multi-agent architecture is real, just not over-engineered.** Each
concern lives in its own module with a clear boundary, and every autonomous
action is tagged with which agent took it (visible in `what have you done`):

| Agent | File |
|---|---|
| Orchestrator | `src/router.ts` + the dispatch in `src/index.ts` |
| Conversation/Extraction Agent | `src/extract.ts` |
| Commitment Agent | `src/ingest.ts` (writes) |
| Memory Agent | `src/memory.ts` |
| Follow-up Agent | `src/watches.ts` |
| Risk Agent | `src/agents.ts` (`assessRisk`) |
| Reply Agent | `src/agents.ts` (`draftReplies`) |
| Screenshot Agent | `src/extract.ts` (`extractEventFromImage`) |

## Autonomy levels — they change behavior, not just a label

`autonomy 1` / `2` / `3` (or "suggest only" / "ask before acting" / "act
automatically"). The screenshot→event and one-tap-cleanup flows each branch
on this for real (`src/index.ts`):

| Level | What actually happens |
|---|---|
| 1 | ECHO describes what it found and writes **nothing** |
| 2 (default) | ECHO stages the change and confirms via a real iMessage poll |
| 3 | ECHO applies the change immediately; the activity log is the receipt |

## Intelligence scoring — explainable, never a bare number

Commitments carry `urgency` (1-5) + `urgency_reason` and `confidence`;
events carry `importance` + `importance_reason`; opportunities carry
`confidence` + `confidence_reason`. The extraction tool schema *requires* the
reason alongside the score, and every surface renders them together — the
brief card's urgency chip puts the reason in its tooltip, the text brief
appends it inline.

## Data model

```
people          people ECHO has seen, keyed by address (phone number OR email)
threads         conversations ECHO is part of (its DM with you, or a group)
messages        raw log — every text seen, real or seeded
commitments     "I'll..."/"they'll..." + owner, due date, status, urgency, confidence
events          things with a date — from text or from a screenshot, + importance
decisions       what was decided + why (the rationale is a first-class field)
open_questions  unanswered asks, tracked to resolution
opportunities   openings/offers/leads worth acting on, + confidence
watches         "when X replies, do Y" — the future-message mechanism
memories        only ever written from an explicit "remember that ..."
activity_log    one row per autonomous action, tagged by agent — the transparency mechanism
settings        per-person autonomy level + pause switch
```

Everything else — Life Timeline, Open Loops, What Changed, Decision Memory,
Weekly Review, Context Packets, One-Tap Cleanup, the Knowledge Graph, the
Command Center dashboard — is a *query* over these same tables
(`src/queries.ts`), not a separate subsystem.

## The Command Center dashboard

`GET /dashboard` — nine live panels (Today, Memory, Commitments, Follow-ups,
People, Conversations, Opportunities, Decisions, Activity) plus a stat row,
reading the same DB the iMessage commands read, served by the same process.
No auth: this is a single-owner personal agent, so it renders
`PRIMARY_USER_ADDRESS`'s data directly rather than gating behind a login that
would need its own infrastructure to be real. Don't expose the port publicly
without putting auth in front of it first.

## The ECHO orb

Six states (listening / thinking / working / remembering / completed /
alert), one shared color+motion language, at `GET /card/orb?state=…`. It's
not decoration: the "catch me up", search, and screenshot flows each send the
orb instantly, then `edit()` that same card in place into the result — so the
user gets sub-second feedback and a single evolving bubble instead of a
silent wait followed by a wall of text.

> One honesty note on the "catch me up" flow: it holds the orb for a
> deliberate ~900ms beat before revealing the brief. The brief is already
> computed by then — that pause is a presentation choice, not covered
> latency. It's a single `setTimeout` in `src/index.ts`; delete it if you'd
> rather it snap.

## The real architectural constraint (stated, not hidden)

Spectrum gives ECHO its own iMessage number. It is **not** a silent listener
on your personal Messages app — it only sees threads it's actually in: its
DM with you, and any group you add it to. That's not a limitation to
apologize for, it's the actual privacy model, and it's what makes "when
James replies" *real*: ECHO watches a group thread it's genuinely part of,
not your private 1:1 with James. If you want ECHO watching a relationship,
put it in a shared group, or forward the relevant messages into your DM
with it.

For the same reason, the **Reply Agent only drafts** — ECHO has no way to
send a message *from* your personal number, only from its own line. It
proposes 2-3 options; you send the one you like yourself.

## Real / Demo / Future

| | |
|---|---|
| **Real** | Webhook + signature verification; the extraction engine (Claude tool-use, runs identically on live or seeded messages) with explainable urgency/importance/confidence scoring; every command (see the full list below); screenshot→event via Claude vision + `im.getAttachment`; the cross-thread watch/proactive-DM mechanism; memory (remember/forget/pin/list, auto-categorized); risk assessment; reply drafting; natural-language search via multi-turn tool-use retrieval; the agent-tagged activity log; working 3-tier autonomy; the Privacy Center (pause/resume, forget-conversation, delete-everything, export); the Command Center dashboard; four live iMessage App cards (orb, daily brief, knowledge graph, export) incl. `edit()`-in-place morphing |
| **Demo** | `src/seed.ts` populates ~10 days of realistic multi-thread history. Spectrum has no historical-backfill API — there is no way to honestly pull a real phone's past texts — so this is direct, deterministic DB inserts (not routed through the LLM; a live demo can't depend on extraction being byte-identical run to run). The **real** extraction path is `src/ingest.ts`, exercised by any actual inbound message. |
| **Future** | Vector/semantic search (today's search is keyword-driven tool-use, see above); `@spectrum-ts/imessage-local` (Mac-only) for genuine on-device history; writing screenshot-events to a real calendar instead of ECHO's own `events` table; auth on the dashboard; time-based follow-ups ("if James hasn't replied in 3 days") — today's watches fire on a reply, not on a timer; live SIP phone calls (Spectrum supports them via its `voice` **provider**, separate from the voice *notes* ECHO uses today) |

## Setup

1. Text **"hi" to +1 (628) 284-7827**, then create a real project + enable
   the iMessage provider at [app.photon.codes](https://app.photon.codes) for
   `PROJECT_ID` / `PROJECT_SECRET`.
2. Get an Anthropic key at [console.anthropic.com](https://console.anthropic.com/settings/keys).
   **Or** use an Anthropic-API-compatible gateway (AgentRouter, OpenRouter,
   LiteLLM, a self-hosted proxy) by setting `ANTHROPIC_BASE_URL` and putting
   the *gateway's* key in `ANTHROPIC_API_KEY` — see "Using a gateway" below.
3. `cp .env.example .env` and fill in both, plus `PRIMARY_USER_ADDRESS` —
   **either** your phone number in E.164 (`+14155551234`) **or** your Apple ID
   email, whichever your iMessage actually sends from. iMessage identifies
   users by either (see docs.photon.codes "iMessage connection and routing":
   `im.user()` takes a phone *or* email), and so does ECHO. This is the only
   address ECHO accepts commands from.
4. `bun install`

### Local run

```bash
bun run dev
# in another terminal:
ngrok http 3000
```

Register the webhook (same as Photon's own quickstart):

```bash
curl -X POST "https://spectrum.photon.codes/projects/$PROJECT_ID/webhooks/" \
  -u "$PROJECT_ID:$PROJECT_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"webhookUrl":"https://YOUR-NGROK-URL.ngrok-free.app/spectrum-webhook"}'
```

Save the returned `signingSecret` into `.env` as `SPECTRUM_SIGNING_SECRET`,
set `PUBLIC_BASE_URL` to the same ngrok URL, restart.

### Choosing an LLM provider

ECHO speaks to its model through one provider-neutral interface
(`src/llm/`), so switching backends is env vars only — no code changes. Two
providers ship:

**Google AI Studio (Gemini) — free tier, recommended if you have no budget**

```
LLM_PROVIDER=gemini
GEMINI_API_KEY=<free key from https://aistudio.google.com/apikey>
GEMINI_MODEL=gemini-3-flash        # or gemini-3.1-flash-lite for 2x the RPM
```

The free tier is Flash-only but includes **function calling and vision** — the
two things ECHO can't work without — plus a 1M context window, at roughly
15–30 requests/minute. Adapting to it wasn't a one-liner: Gemini's function
schema is OpenAPI-flavoured and rejects the JSON Schema dialect ECHO's tools
use (union types like `type: ["string","null"]`, numeric `minimum`/`maximum`),
so `src/llm/gemini.ts` converts them properly rather than casting and hoping.

**Anthropic — official API, or any Anthropic-compatible gateway**

```
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=<official key, sent as x-api-key>
# ...or for a gateway:
ANTHROPIC_AUTH_TOKEN=<gateway key, sent as Authorization: Bearer>
ANTHROPIC_BASE_URL=<gateway base URL>
ANTHROPIC_MODEL=claude-sonnet-5
```

Note: Anthropic has no free tier — new Console accounts get a one-time ~$5
trial credit, and that isn't granted universally.

**Either way, verify before you rely on it:**

```bash
bun run doctor
```

It checks text, **forced tool use with ECHO's actual schema shapes**, and
**vision** against the live backend, and tells you exactly which features die
if one fails.

**Cost control:** `LLM_EXTRACTION_MODEL` points the high-volume path (which
runs on *every* inbound message) at a cheaper model than the user-facing
agents. Worth setting if you're on trial credits.

### Using an Anthropic-compatible gateway

ECHO constructs its LLM client in exactly one place (`src/llm.ts`), so
pointing it at an Anthropic-API-compatible gateway (AgentRouter, OpenRouter,
LiteLLM, a self-hosted proxy) is one env var:

```
ANTHROPIC_BASE_URL=<gateway base URL>
ANTHROPIC_AUTH_TOKEN=<gateway key — most gateways use Bearer auth>
ANTHROPIC_MODEL=<whatever that gateway calls the model>
```

Use `ANTHROPIC_AUTH_TOKEN` (sent as `Authorization: Bearer`) for gateways, and
`ANTHROPIC_API_KEY` (sent as `x-api-key`) for the official API. Setting the
token is enough — `src/llm.ts` explicitly passes `apiKey: null` alongside it,
because otherwise the SDK falls back to a blank `ANTHROPIC_API_KEY=` line in
`.env` and dies at request time with "Could not resolve authentication method".

**AgentRouter specifically** (verified against their docs, Sept 2026):

```
ANTHROPIC_BASE_URL=https://agentrouter.org      # NO /v1 on the Anthropic path
ANTHROPIC_AUTH_TOKEN=<your AgentRouter key>
ANTHROPIC_MODEL=claude-opus-4-6                 # or claude-opus-4-7 / 4-8
```

⚠️ **This does not currently work for ECHO.** AgentRouter allowlists client
applications: an identical request differing only in `User-Agent` is rejected
with `unauthorized client detected` for a normal client but accepted for
`claude-cli`. Their supported-client list is all coding tools (Claude Code,
Cursor, Cline, Codex...), and ECHO isn't one. Impersonating an allowlisted
client would circumvent their access control and likely breach their ToS, so
it isn't implemented here. Ask them directly
([Discord](https://discord.gg/HgekCyHJqB)) whether your use case is supported.

Separately, even past that gate their documented default model returned
"no available channel for model under group default" for our test key — so
credits/channel provisioning may also need sorting before it would work at all.

Then **verify it before relying on it**:

```bash
bun run doctor
```

That checks the three capabilities ECHO actually depends on — text completion,
**tool use**, and **vision**. Gateways vary in whether they proxy the last two,
and a gateway that silently drops tool calls doesn't error: it just captures
nothing from any message, which looks like ECHO being broken rather than the
gateway being wrong. `doctor` tells you exactly which features die.

Two things worth knowing first:

- **Your conversation content flows through the gateway operator.** ECHO's
  whole pitch is holding your personal context; on a third-party gateway every
  message it extracts from is relayed by someone you don't control. Fine for a
  demo on seeded data — think harder before pointing it at real conversations.
- **Free-tier gateways change without notice** (model names, limits, uptime).
  Re-run `doctor` the morning of any demo.

Note: `ANTHROPIC_BASE_URL` exported in your **shell** overrides a blank value
in `.env`, so clearing it in `.env` alone may not clear it. `doctor` prints a
warning when it detects this.

### Seed the demo data

```bash
bun run seed
```

Populates the "Ski Trip 🏔️", "Apartment 4B", and "Project Nova" threads —
enough for every command above to return real content immediately.

### Try it

Open **`http://localhost:3000/dashboard`** for the Command Center, and text
your ECHO number (from `PRIMARY_USER_ADDRESS`) any of:

**Briefings & views**
`catch me up` · `prioritize my day` · `what am I forgetting` ·
`life timeline` · `open loops` · `what changed` · `weekly review` ·
`show me the graph` · `context on Priya`

**Memory**
`remember that my mom's birthday is October 12` · `what do you remember` ·
`pin birthday` · `forget the marathon thing`

**Search & recall**
`search when did Priya mention the cabin` · `why did we decide to use supabase`

**Agents**
`is this a scam: <paste>` · `reply casual` · `reply professional`

**Autonomy & privacy**
`autonomy 1` / `autonomy 2` / `autonomy 3` · `what have you done` ·
`pause` → `resume` · `forget this conversation` · `export my data` ·
`delete everything`

**Voice** (needs `VOICE_API_KEY`)
Send a **voice memo** with any command in it — ECHO transcribes it, runs it,
and replies with a real iMessage voice note. Or type `speak catch me up` /
`say what am I forgetting` to get a spoken answer without recording anything.

**Cleanup & the future-message**
`clean up` (answer the poll) · `when James replies, summarize his answer and
tell me what I need to do` — then send a message as James in the Ski Trip
group to watch it fire into your DM.

For the screenshot demo: open `demo-assets/event-flyer.html` in a browser,
screenshot it, text the screenshot to ECHO.

## Known shortcuts worth fixing before you rely on this past the demo

- **Poll-response correlation is single-pending-per-kind.** A poll_option
  reply doesn't carry back a handle to what prompted it, so
  `pending_cleanup_items` / `pending_screenshot_events` assume one pending
  poll of each kind per requester at a time. Fine for a demo; add a proper
  poll-instance id before relying on concurrent polls.
- **New contacts have no name** until they text something or appear in
  seed data — ECHO has no per-user display-name API to call, only
  `getDisplayName` on a *space*.
- **One address per person.** iMessage users can be reachable at both a
  phone number *and* an email; ECHO treats those as two separate people
  because Spectrum surfaces whichever one the message arrived from. If your
  contact texts you from both, you'll see two entries. Merging them needs a
  contact-linking step that isn't built.
- **In-memory-adjacent SQLite file** — fine for a single demo instance;
  move to Turso/LiteFS or Postgres before running more than one server
  process.
- **The dashboard has no auth.** It renders the primary user's data to
  anyone who can reach the port. Fine on localhost/ngrok for a demo; put
  auth in front of it before deploying anywhere public.
- **Third-party commitment attribution is best-effort.** When the extractor
  says a commitment belongs to "them", ECHO attributes it to whoever sent
  that message. If someone says *"Priya said she'd handle it"*, the
  commitment lands on the speaker, not Priya — resolving named third parties
  to `person_id`s needs a disambiguation pass that isn't built yet.
- **"Pause" is global, not per-thread.** `pause` stops all processing
  everywhere until `resume`; there's no "pause just this conversation".
- **Autonomy level 3 auto-resolves cleanup candidates** based on staleness
  heuristics (overdue >2 days, questions >5 days). That's intentionally
  aggressive — it's opt-in, and level 2 is the default for a reason.
