# Internship Tracker

A single-user web app that turns your Gmail into a Notion-style internship
application tracker. It scans your inbox for application confirmations,
assessments, interview invites, offers, and rejections, extracts the company,
role, type, and industry, and shows everything in a searchable, filterable
table with a per-application progress timeline.

## How it works

1. You sign in with Google (read-only Gmail access).
2. A sync (manual button or daily cron) lists candidate emails via the Gmail
   API using a keyword/ATS query.
3. Each new email is classified **rules-first** — known ATS sender domains
   (Greenhouse, Lever, Workday, iCIMS, Ashby, …) and subject keywords cheaply
   decide whether it's application-related and hint at the status.
4. Relevant emails are passed to **Gemini** (`gemini-2.5-flash`) which returns
   structured JSON: `{ company, position, positionType, industry, status,
   summary }` and confirms relevance (filtering out job alerts/newsletters).
5. Results are upserted into Postgres: one row per `company + role + term`
   application, plus an append-only `application_event` timeline.

The `term` in that key is load-bearing. The same posting reopens every cycle, and
title matching deliberately ignores season words so a follow-up email still finds
its entry — which means without the cycle in the key, a Summer 2027 confirmation
is indistinguishable from the Fall 2026 entry of the same name and lands on
whichever was touched last. Matching still falls back to a cycle-less entry when
one exists, and to loose title matching when the email names no cycle at all.

Classification is a guess, so the details panel has two menus for fixing what it
got wrong in either direction. **Separate** splits one entry into several — by a
cycle named in the timeline, by a role the emails mention, by a joined title like
"TPM + SWE", or one email at a time — moving the chosen events onto a new row and
recomputing both rows' status and dates from the events they end up with.
**Merge** lists the other entries at the same company and folds the one you pick
into this one, re-parenting every event and dropping the absorbed row.

An entry that has reached an assessment also gets an **online assessment** field
in the details panel, marking whether you have actually sat the OA. It is a plain
flag rather than a status, because finishing an assessment does not advance an
application — it just moves the ball into the company's court — so the funnel and
the status filters are unaffected. Sync sets it too: an email confirming an
assessment was completed (as opposed to requested) marks it automatically, via
both a rules pass and a Gemini field. The flag is only ever set by sync and only
ever cleared by hand.

## Stack

- **Next.js 16** (App Router, TypeScript) · **Tailwind CSS v4**
- **Supabase Auth** (Google OAuth via `@supabase/ssr`)
- **Supabase Postgres** via **Drizzle ORM**
- **googleapis** (Gmail) · **@google/genai** (Gemini)
- **Vercel Cron** for the daily sync

> Auth note: sign-in goes through **Supabase Auth**. Supabase hands us the
> Google `provider_refresh_token` once at sign-in, which we store in a
> `google_tokens` table so the cron can call Gmail offline. Supabase does not
> refresh Google tokens for us — `google-auth-library` does that from the stored
> refresh token.

---

## Setup

### 1. Install

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local` as you complete the steps below.

### 2. Supabase project — keys + Postgres

1. Create a project at <https://supabase.com>. Pick a region near you and set a
   **database password** (save it).
2. **Settings → API:** copy the **Project URL** → `NEXT_PUBLIC_SUPABASE_URL` and
   the **anon / publishable key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. Click **Connect** (top bar) and copy two connection strings — they differ
   only by port:
   - **Transaction pooler** (port `6543`) → `DATABASE_URL` (app runtime).
   - **Session pooler** (port `5432`) → `DIRECT_URL` (Drizzle migrations).
   > Use the **Session pooler**, _not_ the "Direct connection"
   > (`db.<ref>.supabase.co`) — the latter is IPv6-only and usually fails to
   > connect from a laptop or from Vercel.
   Replace `[YOUR-PASSWORD]` in each with your database password.
4. Apply the schema:

```bash
npm run db:migrate   # or: npm run db:push
```

### 3. Google Cloud — Gmail API + OAuth client

In your Google Cloud project:

1. **APIs & Services → Library →** search **Gmail API → Enable**.
2. **APIs & Services → OAuth consent screen:**
   - User type: **External**; add yourself as a **Test user** (keeps the app in
     testing mode — no Google verification needed).
   - Add the scope `https://www.googleapis.com/auth/gmail.readonly`.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID →
   Web application.** For **Authorized redirect URIs**, add the **Supabase**
   callback (not your app):
   - `https://<ref>.supabase.co/auth/v1/callback`

     (Supabase shows this exact URL in step 4. With Supabase Auth, Google
     redirects to Supabase, which then redirects to your app's `/auth/callback`.)
   - Copy the **Client ID** → `GOOGLE_CLIENT_ID` and **Secret** →
     `GOOGLE_CLIENT_SECRET`. The app needs these to refresh the Gmail token from
     the cron.

### 4. Wire Google into Supabase Auth

1. **Authentication → Providers → Google:** enable it and paste the same
   **Client ID** and **Client Secret** from step 3.
2. **Authentication → URL Configuration:**
   - **Site URL:** `http://localhost:3000` (change to your Vercel URL in prod).
   - **Redirect URLs:** add `http://localhost:3000/auth/callback` and, later,
     `https://<your-app>.vercel.app/auth/callback`.
3. Set `ALLOWED_EMAIL` to your own Gmail address. You are always allowed past the
   callback; everyone else needs a row in `allowed_email` (see
   [Granting access](#granting-access-to-other-people)).

### 5. Gemini API key

Create a key at <https://aistudio.google.com/app/apikey> → `GEMINI_API_KEY`.

### 6. Run

```bash
npm run dev
```

Open <http://localhost:3000>, sign in with Google, and click **Sync inbox**.
The first sync processes up to 25 emails per run — click again (or wait for the
cron) to drain any backlog; the button reports how many remain.

---

## Deploy to Vercel

1. Push the repo to GitHub and import it into Vercel.
2. Add all `.env.local` variables to the Vercel project's **Environment
   Variables**, plus:
   - `CRON_SECRET` — any random string. Vercel automatically sends it as a
     Bearer token to the cron route, which rejects anything else.
3. In **Supabase → Authentication → URL Configuration**, set the **Site URL** to
   your Vercel URL and add `https://<your-app>.vercel.app/auth/callback` to the
   **Redirect URLs**. (The Google OAuth client's redirect — the Supabase
   `/auth/v1/callback` — does not change.)
4. Deploy. `vercel.json` registers the daily cron:

```json
{ "crons": [{ "path": "/api/cron/sync", "schedule": "0 7 * * *" }] }
```

> The Vercel **Hobby** plan runs cron jobs once per day, which matches this
> schedule. Adjust the cron expression for other cadences on paid plans.

---

## Granting access to other people

Access is controlled by the `allowed_email` table plus the `ALLOWED_EMAIL` env var
(the owner, always allowed). Adding someone takes **two** steps — miss the second
and they get blocked by Google before the app ever sees them.

### 1. Add them to the app allowlist

Run this in the Supabase SQL editor. Takes effect on their next request; no
redeploy needed.

```sql
insert into allowed_email (email, note)
values ('friend@gmail.com', 'Sam from the group chat');
```

Revoking is immediate — every page load and API call re-checks the table:

```sql
delete from allowed_email where email = 'friend@gmail.com';
```

To see who currently has access:

```sql
select email, note, created_at from allowed_email order by created_at;
```

### 2. Add them as a Google OAuth test user

**Google Cloud Console → APIs & Services → OAuth consent screen → Test users →
Add users.** Because this app requests the `gmail.readonly` *restricted* scope
while in "Testing" publishing status, Google blocks any account that isn't on this
list — they'll see *"Access blocked: this app has not completed verification"* at
the consent screen, before Supabase issues a session.

Two consequences of staying in Testing mode:

- **100 test users max.**
- **Refresh tokens expire after 7 days.** Background sync silently stops for a
  user until they sign in again. Going past this needs Google app verification
  plus a CASA security assessment for the restricted scope.

Once both steps are done they sign in with Google, and that same sign-in grants
Gmail access — the refresh token is stored per user, so their inbox is scanned
independently of yours.

---

## Environment variables

| Variable                        | Purpose                                                   |
| ------------------------------- | --------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase project URL                                      |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon / publishable key                           |
| `DATABASE_URL`                  | Supabase transaction pooler (port 6543, runtime)          |
| `DIRECT_URL`                    | Supabase session pooler (port 5432, migrations)           |
| `GOOGLE_CLIENT_ID`              | Google OAuth client ID (also set in Supabase)             |
| `GOOGLE_CLIENT_SECRET`          | Google OAuth client secret (also set in Supabase)         |
| `ALLOWED_EMAIL`                 | Owner's Gmail — always allowed, and the inbox the cron scans |
| `GEMINI_API_KEY`                | Google Gemini API key                                     |
| `CRON_SECRET`                   | Shared secret protecting `/api/cron/sync` (prod)          |
| `TRACK_AFTER`                   | Only track emails on/after this date (YYYY-MM-DD)         |
| `NEXT_PUBLIC_SITE_URL`          | _Optional._ Absolute site URL for the OAuth redirect      |
| `GMAIL_QUERY`                   | _Optional._ Override the Gmail search used to find email  |

---

## Project layout

```
src/
  proxy.ts                       # session refresh + auth gate (Next 16 proxy)
  app/
    page.tsx                     # dashboard (auth-gated server component)
    login/page.tsx               # Google sign-in
    actions.ts                   # signIn / signOut server actions
    auth/callback/route.ts       # OAuth code exchange; stores refresh token
    api/
      sync/route.ts              # POST — manual sync (session-gated)
      cron/sync/route.ts         # GET  — daily cron (CRON_SECRET-gated)
      applications/route.ts      # GET  — list
      applications/[id]/route.ts # PATCH / DELETE — manual edits
      applications/[id]/split/   # POST — peel events onto a new entry
      applications/[id]/merge/   # POST — fold another entry into this one
  db/
    index.ts                     # Drizzle client (postgres-js)
    schema.ts                    # all tables (incl. google_tokens)
  lib/
    supabase/server.ts           # Supabase client (server / route handlers)
    supabase/middleware.ts       # session refresh used by proxy.ts
    google.ts                    # OAuth2 client from stored refresh token
    gmail.ts                     # list + fetch + parse emails
    gemini.ts                    # structured-output classifier
    classify.ts                  # rules-first gate + Gemini orchestration
    sync.ts                      # sync orchestration / upserts
    queries.ts                   # read queries / DTO mapping
    applications.ts              # dedupe key, event rollup, title matching
    split.ts                     # split suggestions from titles + timelines
    types.ts                     # taxonomies + shared types
  components/                    # Dashboard, table, filters, details drawer, …
drizzle/                         # generated SQL migrations
internships/                     # iMessage alert poller (Bun + Spectrum)
  src/
    poll.ts                      # entrypoint: fetch → record → reserve → send
    sources/                     # github, ats (greenhouse/lever/ashby/…), scraped, msr
    filter.ts                    # intern/co-op + term-floor rules
    message.ts                   # digest formatting
    send.ts                      # Spectrum iMessage client
    seed-watchlist.ts            # upsert the tiered company watchlist
    register-sources.ts          # discovery.json → job_source rows
discord/                         # Discord alert bot (Bun + incoming webhook)
  src/
    send-alerts.ts               # entrypoint: drain reserved deliveries → post
    webhook.ts                   # webhook client: pacing, 429s, retries
    message.ts                   # digest formatting + 2,000-char packing
scrapers/                        # career-page scraping (Python)
  fetch.py                       # HTTP first, Playwright when needed
  extract.py                     # BeautifulSoup extraction + ATS detection
  discover.py                    # classify a career page; find its board slug
  scrape.py                      # one company → JSON on stdout
```

---

## Job alerts (iMessage + Discord)

A second pipeline watches for **new internship and co-op postings** and sends them
as a digest. Managed from the **Alerts** tab: recipients, a company watchlist, a
recent-postings feed, and per-source health.

Each recipient chooses **all job alerts** or **watchlist only**, and is either a
phone number that gets an iMessage or a Discord channel that gets a webhook post.

**One poller, two senders.** `internships/src/poll.ts` is the only thing that
fetches job boards. It records listings and reserves an `alert_delivery` row for
every enabled subscriber whatever their channel, then sends the iMessage ones;
`discord/src/send-alerts.ts` runs straight after and drains the rest. Splitting
it the other way — a poller per transport — would mean two hits on every careers
page for the same postings.

```
poll.ts ──fetch──> job_listing ──reserve──> alert_delivery ──┬─> internships/ ──> iMessage
                                                             └─> discord/     ──> webhook
```

The Discord side is a plain incoming webhook, not a bot user: no gateway, no
always-on host, so it's one more step in the same 10-minute Action. It is
therefore send-only — no slash commands, and no `STOP` reply, since nothing is
listening on the other end. See [`discord/README.md`](discord/README.md) for
setup.

### Where postings come from

| Source kind | How it's read | Why |
| --- | --- | --- |
| Community repos | `listings.json` from SimplifyJobs / vanshb03 | Stable uuids, so detection is an id diff. A commit-sha check skips the 11 MB download when nothing changed |
| Company page fronting an ATS | That ATS's JSON board API | These pages *are* Greenhouse/Ashby front-ends — `figma.com/careers` links every posting to `boards.greenhouse.io/figma`. Same data, one request instead of a rendered browser page |
| Company on its own system | `scrapers/` — Playwright renders, BeautifulSoup parses | No API exists. Databricks' "Product Management Intern (Summer 2027)" lives only on `databricks.com` |

`scrapers/discover.py` classifies a career page by **where its apply links point**
and recovers the ATS board slug from the link path, so sources configure
themselves:

```bash
pip install -r scrapers/requirements.txt
python -m playwright install chromium
python scrapers/discover.py > scrapers/discovery.json
cd internships && bun src/register-sources.ts ../scrapers/discovery.json
```

Rendering is never the default — it costs ~4.5s and a Chromium process — so HTTP
is tried first. The fallback triggers on **job-link count, not page size**:
Databricks returns 737 KB of text containing zero postings, which fools any
"does this look rendered" check.

### Filtering

Internships and co-ops only, no new-grad or full-time. Titles must contain an
intern/co-op token — except on the community feeds, which only list internships
and where the requirement would drop real postings whose titles omit the word. A
disqualifying rule always applies, removing roles that *manage* interns
("Solution Architect Manager - Intern Program"), new-grad pipelines, and adjacent
programs (apprenticeships, residencies, PhD/MBA tracks).

Terms use a **floor**, `ALERT_TERM_FLOOR` (default `Fall 2026`): any later cycle
qualifies and only expired ones are dropped, so the rule needs no annual
widening. Terms that don't parse pass rather than being discarded.

### Running it

```bash
cd internships
bun src/poll.ts                  # fetch, record, alert
bun src/poll.ts --dry-run        # report only; no writes, no messages
bun src/poll.ts --refetch        # ignore the revision cache after a rule change
bun src/test-send.ts +15551234567
bun src/seed-watchlist.ts you@gmail.com
```

```bash
cd discord
bun src/send-alerts.ts           # post whatever the poller reserved for Discord
bun src/send-alerts.ts --dry-run # print the messages; no posts, no writes
bun src/test-send.ts https://discord.com/api/webhooks/<id>/<token>
```

`.github/workflows/poll.yml` runs both every 10 minutes — Vercel's Hobby plan caps
its own cron at once per day, and Actions minutes are free on a public repo. The
Discord step runs on `!cancelled()` rather than on success, so a Spectrum outage
or one broken scraper doesn't also hold up the Discord digest.

### Adding recipients

Recipients live in `alert_subscriber`, and **nothing syncs them from the Photon
dashboard**. Spectrum Cloud has no recipient directory to read: its `cloud`
client exposes project and platform metadata only, and the space namespace has
`create`/`get` but no `list`. The numbers shown in that dashboard are the lines
this app sends *from*.

Three ways in, then:

```bash
cd internships
bun src/listen.ts                                     # anyone who texts the line is subscribed
bun src/subscribers.ts add +15551234567 --label Ada   # a number you already know
bun src/subscribers.ts list                           # and disable / enable / retry
```

…plus the **Alerts** tab, which is the same insert behind a form.

`listen.ts` is the automatic path, and it doubles as the STOP/START handler the
digests advertise. It has to run continuously: the provider's stream supports
server-side catch-up, but the cursor driving it starts empty on every process
start and can't be seeded, so a fresh process only sees messages that arrive
while it is connected. A cron run would miss everything in between. It reconnects
on its own with backoff, so any always-on host works.

Someone who texts in is marked confirmed and gets a short acknowledgement;
someone added from the CLI is not, so the poller opens with the intro that
explains where the texts came from and how to stop them.

### Two safeguards worth knowing

- **Nothing is sent twice, on either channel.** A delivery row is reserved as
  `pending` *before* the message goes out, unique on `(subscriber, dedupe_key)`. A
  crash between reserve and send leaves a retryable row, never a duplicate or a
  loss — and the key collapses the same job arriving from several sources into one
  message. Both senders share this ledger, which is the reason Discord channels
  are rows in `alert_subscriber` rather than a table of their own: the
  safety-critical part is written once, not reimplemented per transport.
- **A new source never floods.** A source alerts on nothing until its first
  *successful* poll (`job_source.seeded_at`). Seeding the community feeds would
  otherwise have fired ~750 texts, and adding a company with hundreds of open
  roles would do the same. `seeded_at` is deliberately separate from
  `last_polled_at`, so a failed attempt advances the retry clock without
  consuming that one-time grace.

Career sites push back on scrapers, so `job_source.consecutive_failures` drives
exponential backoff (capped at 24h, reset on success).

### Alerts environment variables

| Variable | Purpose |
| --- | --- |
| `PROJECT_ID` / `PROJECT_SECRET` | Spectrum cloud credentials (app.photon.codes) |
| `ALERT_TERM_FLOOR` | _Optional._ Earliest term to alert on. Default `Fall 2026` |
| `ALERT_SITE_URL` | _Optional._ Linked from a truncated digest |
| `PYTHON_BIN` / `SCRAPERS_DIR` | _Optional._ Interpreter and path for `scrapers/` |
| `DISCORD_USERNAME` / `DISCORD_AVATAR_URL` | _Optional._ Name and avatar the webhook posts under |

Discord webhook URLs are **not** environment variables — they live in
`alert_subscriber.webhook_url` so one deployment can post to several channels.

## Notes & limitations

- **Access is allowlisted.** `ALLOWED_EMAIL` (the owner) plus any row in the
  `allowed_email` table. See [Granting access](#granting-access-to-other-people)
  — note the Google test-user cap and the 7-day token expiry that come with
  staying in Google's "testing" mode.
- **The daily cron only syncs the owner.** Other allowlisted users can sign in,
  connect Gmail, and sync with the button in Settings, but the scheduled job at
  `/api/cron/sync` still resolves a single user from `ALLOWED_EMAIL`.
- **Tracking starts at `TRACK_AFTER`** (default `2026-06-24`). Emails before
  that date are never fetched or recorded — enforced both in the Gmail query and
  as a hard guard in the sync loop.
- Extraction quality depends on Gemini; every application's fields are editable
  in the details drawer, and the type/industry filters update accordingly.
- Tune the candidate query with `GMAIL_QUERY` if your providers use unusual
  subject lines.
