# Internship Tracker

A single-user web app that turns your Gmail into a Notion-style internship
application tracker, with a second pipeline that alerts you to new postings.

## Screenshots

<!-- screenshots go here -->

## Features

- **Automatic tracking from Gmail.** A sync (manual button or daily cron) scans
  your inbox for confirmations, assessments, interviews, offers, and rejections,
  and extracts company, role, type, and industry.
- **Rules-first + LLM classification.** Known ATS sender domains (Greenhouse,
  Lever, Workday, iCIMS, Ashby, …) and subject keywords decide relevance
  cheaply; only what survives goes to Gemini for structured extraction.
- **Searchable, filterable table** with a per-application event timeline, plus
  manual add/edit, split (one entry into several), and merge.
- **Stage flags** for online assessments and pending interviews, so you can see
  which applications are waiting on you and which are waiting on them.
- **Analytics** — funnel, Sankey, and offer rate over your applications.
- **Job alerts** — a poller watches community repos, ATS board APIs, and scraped
  career pages for new internship/co-op postings and sends digests over iMessage
  and Discord.
- **Behavioral prep** — sections of questions and answers for interview practice.

## Stack

- **Next.js 16** (App Router, TypeScript) · **Tailwind CSS v4**
- **Supabase Auth** (Google OAuth via `@supabase/ssr`)
- **Supabase Postgres** via **Drizzle ORM**
- **googleapis** (Gmail) · **@google/genai** (Gemini)
- **Vercel Cron** (daily sync) · **GitHub Actions** (job-alert poller)
- **Bun** (alert senders) · **Python** + Playwright/BeautifulSoup (scrapers)

## Repo structure

```
src/
  proxy.ts          # session refresh + auth gate (Next 16 proxy)
  app/
    page.tsx        # dashboard (auth-gated server component)
    login/          # Google sign-in
    auth/callback/  # OAuth code exchange; stores refresh token
    api/            # sync, cron, applications, alerts, postings, behavioral
  db/               # Drizzle client + schema
  lib/              # gmail, gemini, classify, sync, queries, analytics, alerts, …
  components/       # dashboard, table, filters, details drawer, panels, charts
drizzle/            # generated SQL migrations
internships/        # job-posting poller + iMessage sender (Bun)
discord/            # Discord webhook sender (Bun)
scrapers/           # career-page scraping and ATS discovery (Python)
.github/workflows/  # poller schedule
```

## Running it

Requires Node 20+, a Supabase project, a Google Cloud OAuth client with the
Gmail API enabled, and a Gemini API key.

```bash
npm install
cp .env.example .env.local   # fill in Supabase, Google, and Gemini values
npm run db:migrate           # apply the schema
npm run dev
```

Open <http://localhost:3000>, sign in with Google, and click **Sync inbox**.
Each sync processes up to 25 emails; the button reports how many remain.

The job-alert pipeline runs separately:

```bash
cd internships && bun src/poll.ts   # fetch postings, record, reserve deliveries
cd discord && bun src/send-alerts.ts
```
