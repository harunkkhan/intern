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
send-only — a webhook has no inbound side, so nothing typed in the channel
reaches this sender and there is no `STOP` reply. Turning alerts off is done in
the dashboard.

The one inbound thing that exists is the **`/load` slash command**, and it lives
somewhere else entirely: `src/app/api/discord/interactions/route.ts` in the web
app, which is on Vercel and can therefore receive an HTTP request. It doesn't
post anything itself — it starts a one-shot `poll.yml` run, and that run's
`Post Discord alerts` step is this same sender. Anyone in the server can run it,
the reply is public, and a manual run posts up to 200 postings per channel
instead of the usual 40.

`/load` refuses to dispatch while a `poll.yml` run is alive and links that run
instead. During the weekday window a 5h45m loop holds `concurrency:
poll-job-listings`, and a run queued against it replaces the pending standby
that the loop's handoff depends on — so the command would cost more than it
gives. It is meant for evenings and weekends, when nothing is polling.

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

4. Only for `/load`: create a Discord **application** (Developer Portal → New
   Application), put its **Public Key** and **Application ID** into Vercel as
   `DISCORD_PUBLIC_KEY` and `DISCORD_APP_ID`, deploy, and then set
   **Interactions Endpoint URL** to
   `https://intern.harunkhan.org/api/discord/interactions`. Discord verifies the
   URL by signing a PING — and by sending deliberately bad signatures it expects
   a 401 for — so the route has to be deployed before the URL will save.
5. Register the command once. It is a bulk overwrite of the guild's commands, so
   running it again is how you edit the command, not how you duplicate it. The
   bot token is used **only here** — the web app never holds one:

```bash
curl -X PUT \
  "https://discord.com/api/v10/applications/$DISCORD_APP_ID/guilds/$DISCORD_GUILD_ID/commands" \
  -H "Authorization: Bot $DISCORD_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '[
    {
      "name": "load",
      "type": 1,
      "description": "Poll for new internships now and post whatever turns up",
      "options": [
        {
          "name": "source",
          "type": 3,
          "description": "Poll only this source (leave empty for every source due)",
          "required": false,
          "autocomplete": true
        }
      ]
    }
  ]'
```

Guild commands appear immediately; a global registration (the same call without
`/guilds/$DISCORD_GUILD_ID`) takes up to an hour to propagate.

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

- **Postings are grouped under a bold employer heading.** The company is a
  heading above its roles rather than a prefix repeated on every line, and the
  heading is re-emitted at the top of a new message so a company whose roles
  span a message boundary never continues under no heading. Employers keep
  newest-first order, so one with forty stale roles open can't bury one that just
  posted.
- **The same role listed twice by one employer is sent once.** `alert_delivery`
  dedupes on `dedupe_key`, which prefers the canonical URL — so TikTok's many
  separate "Software Engineer Intern" reqs, one per team, survive as distinct
  rows and read as the channel repeating itself. The sender collapses them on
  (employer, title) and still settles every suppressed row, so duplicates aren't
  left pending to be retried forever.
- **A message is the unit of settlement, not a run.** Discord caps a message at
  2,000 characters, so a full digest is often several posts. Each one carries the
  delivery ids it covers and marks exactly those rows `sent` the moment it lands.
  Settling the whole digest at the end instead would mean a failure on the third
  post either loses the first two or re-posts them next run.
- **Links are `[text](<url>)` with `SUPPRESS_EMBEDS`.** The angle brackets aren't
  decoration: a `)` in the URL would otherwise terminate the markdown link early,
  and Greenhouse and Workday both emit parenthesised paths. Suppressing embeds
  matters because forty unfurled link cards is not a readable digest.
- **Only the first message of a digest pings.** A digest that overflows into
  three posts is still one batch of news; three notifications for it would train
  people to mute the channel, which defeats the point. The intro never pings.
  `allowed_mentions.parse` is empty on every message, so `@everyone` and `@here`
  are inert however they turn up in a job title — only the role id in
  `DISCORD_MENTION_ROLE_ID` can ring, and only on that first message.

The mention is configured as a **numeric role id**, not a name: `@job` typed
literally is text Discord ignores, and only `<@&123…>` is a real mention. With
Developer Mode on, get it from **Server Settings → Roles → right-click → Copy
Role ID**. Leave `DISCORD_MENTION_ROLE_ID` unset and digests post silently —
it never falls back to a broader ping than was configured.

The role must be **mentionable**, or the webhook needs **Mention @everyone,
@here, and All Roles** on the channel. Without either, the message still posts
and the mention renders highlighted but silent, which looks like it worked.

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
| `DISCORD_MENTION_ROLE_ID` | _Optional._ Numeric role id a digest pings. Unset = post silently |
| `DISCORD_MAX_PER_RUN` | _Optional._ Postings drained per run. Default 40; `poll.yml` sets 200 on the manual-dispatch step, which is what `/load` starts |
| `DISCORD_USERNAME` | _Optional._ Overrides the name the webhook posts under |
| `DISCORD_AVATAR_URL` | _Optional._ Overrides the webhook's avatar |

The `/load` command runs in the web app, so its variables are set in **Vercel**,
not here:

| Variable | Purpose |
| --- | --- |
| `DISCORD_PUBLIC_KEY` | Application's Public Key. Every interaction request is Ed25519-checked against it — unset rejects everything |
| `DISCORD_APP_ID` | Application ID, used to edit the command's own deferred reply |
| `GITHUB_DISPATCH_TOKEN` | Fine-grained token with Actions: Read and write on `harunkkhan/intern`. Lists live runs and dispatches `poll.yml` |

`DISCORD_APP_ID`, `DISCORD_GUILD_ID` and `DISCORD_BOT_TOKEN` are exported by hand
for the one-off registration curl in Setup and are needed nowhere at runtime.
