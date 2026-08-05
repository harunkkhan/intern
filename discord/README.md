# discord — internship alerts in a Discord channel

Posts new internship and co-op postings into a Discord channel as a digest. Same
alerts the iMessage bot sends; different transport.

This bot **never fetches a job board**. `internships/src/poll.ts` is the only
thing that polls sources, and it reserves an `alert_delivery` row for every
enabled subscriber whatever their channel. By the time this runs, the work is
already in the ledger — it just drains the Discord rows and posts them. Two
pollers would mean two hits on every careers page for the same postings.

```
poll.ts ──fetch──> job_listing ──reserve──> alert_delivery ──┬─> internships/ ──> iMessage
                                                             └─> discord/     ──> webhook
```

## Why a webhook and not a bot token

An incoming webhook is the whole transport: no bot user, no gateway connection,
no always-on host. That's what lets this run as one more step in the 10-minute
GitHub Action instead of needing somewhere to live. The cost is that it's
send-only — a webhook has no inbound side, so there are no slash commands and
no `STOP` reply. Turning alerts off is done in the dashboard.

## Setup

1. In Discord: channel **Settings → Integrations → Webhooks → New Webhook**, then
   **Copy Webhook URL**.
2. In the dashboard's **Alerts** tab, add a recipient with channel **Discord** and
   paste the URL. Pick **all job alerts** or **watchlist only**, same as any
   recipient.
3. Optionally confirm delivery works before waiting for a real posting:

```bash
cd discord
bun src/test-send.ts https://discord.com/api/webhooks/<id>/<token>
```

The URL is stored in `alert_subscriber.webhook_url`, not in the environment, so
one deployment can post to several channels. Its token half is a bearer
credential — anyone holding it can post to the channel — so the dashboard only
ever renders the webhook id.

## Running it

```bash
cd discord
bun src/send-alerts.ts            # drain pending Discord deliveries
bun src/send-alerts.ts --dry-run  # print the messages; no posts, no writes
```

`.github/workflows/poll.yml` runs it right after the poller. There is nothing to
install: the sender has no runtime dependencies, and `drizzle-orm`/`postgres`
resolve from the repo root — the same reason `internships/package.json` omits
them (two installed copies of Drizzle make the root's `PgTable` objects
unassignable, and the schema is imported from `../src/db/schema.ts`).

## Two things worth knowing

- **A message is the unit of settlement, not a run.** Discord caps a message at
  2,000 characters, so a full digest is often several posts. Each one carries the
  delivery ids it covers and marks exactly those rows `sent` the moment it lands.
  Settling the whole digest at the end instead would mean a failure on the third
  post either loses the first two or re-posts them next run.
- **Links are `[text](<url>)` with `SUPPRESS_EMBEDS`.** The angle brackets aren't
  decoration: a `)` in the URL would otherwise terminate the markdown link early,
  and Greenhouse and Workday both emit parenthesised paths. Suppressing embeds
  matters because forty unfurled link cards is not a readable digest.

Rate limits are handled by pacing posts per webhook and honouring `retry_after`
on a 429. A 401/403/404 is treated as permanent — the webhook was deleted or its
token rotated, and the error says to re-add it in the Alerts tab.

## The "not getting these by text" footer

The last message of a digest names any iMessage number whose alerts have been
**permanently given up on**, and tells those people to reply to the texts they
already get so delivery picks back up:

```
**Not getting these by text**
+15551234567 — 12 alerts didn't send
-# Reply to the last text you got from the alerts number and they'll pick back up.
```

Three deliberate choices:

- **Only `attempts >= MAX_ATTEMPTS` counts.** A delivery that has failed once or
  twice is still inside the retry window and will most likely go out on the next
  poll. Naming those people would announce a problem that fixes itself minutes
  later. Past the cap the poller stops picking the row up, so the alert really is
  lost — that's the moment worth reporting. Disabled subscribers are skipped
  entirely: they opted out, so silence is correct.
- **No number to text is printed.** Whichever line Spectrum sent from is already
  in the recipient's message history; naming a second one here would be a number
  they have never seen.
- **Numbers are shown in full, on the owner's explicit instruction.** Anyone who
  can read the channel can read them. It is a shared channel — treat the member
  list as the audience for every number in it.

The footer's length is reserved out of the 2,000-character budget before postings
are packed, so adding it can cost an extra message but can never overflow one.

## Environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Supabase pooler URL — same value the web app and poller use |
| `ALERT_SITE_URL` | _Optional._ Linked from the last message of a digest |
| `DISCORD_USERNAME` | _Optional._ Overrides the name the webhook posts under |
| `DISCORD_AVATAR_URL` | _Optional._ Overrides the webhook's avatar |
