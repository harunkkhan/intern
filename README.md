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
5. Results are upserted into Postgres: one row per `company + role`
   application, plus an append-only `application_event` timeline.

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
    types.ts                     # taxonomies + shared types
  components/                    # Dashboard, table, filters, details drawer, …
drizzle/                         # generated SQL migrations
```

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
