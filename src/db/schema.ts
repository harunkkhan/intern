import {
  pgTable,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  primaryKey,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// Auth is handled by Supabase Auth (the `auth.users` schema it manages). App
// tables key off the Supabase user id (a UUID) stored as plain text — no
// cross-schema foreign key, which keeps Drizzle migrations self-contained.

// Emails permitted to sign in, stored lowercased. Rows are added/removed by hand
// (Supabase dashboard or SQL) and take effect on the next request — no redeploy.
// The owner from ALLOWED_EMAIL is always allowed on top of this table, so an
// empty table can never lock everybody out.
export const allowedEmails = pgTable("allowed_email", {
  email: text("email").primaryKey(),
  // Optional label so you can tell who an address belongs to later.
  note: text("note"),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Google OAuth refresh token captured from the Supabase session at sign-in.
// The daily cron reads this to call the Gmail API offline.
export const googleTokens = pgTable("google_token", {
  userId: text("user_id").primaryKey(),
  email: text("email").notNull(),
  refreshToken: text("refresh_token").notNull(),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const applications = pgTable(
  "application",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id").notNull(),
    company: text("company").notNull(),
    position: text("position").notNull(),
    // Normalized "company::position" (lowercased) used for idempotent upserts.
    dedupeKey: text("dedupe_key").notNull(),
    term: text("term"),
    industry: text("industry"),
    companyType: text("company_type"),
    status: text("status").notNull().default("applied"),
    location: text("location"),
    notes: text("notes"),
    source: text("source"),
    appliedAt: timestamp("applied_at", { mode: "date", withTimezone: true }),
    lastEventAt: timestamp("last_event_at", {
      mode: "date",
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("application_user_dedupe_idx").on(t.userId, t.dedupeKey),
    index("application_user_idx").on(t.userId),
  ],
);

export const applicationEvents = pgTable(
  "application_event",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    status: text("status").notNull(),
    summary: text("summary"),
    emailSubject: text("email_subject"),
    emailFrom: text("email_from"),
    // Globally unique — guarantees each Gmail message is processed at most once.
    gmailMessageId: text("gmail_message_id").notNull().unique(),
    gmailThreadId: text("gmail_thread_id"),
    occurredAt: timestamp("occurred_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("event_application_idx").on(t.applicationId)],
);

// Every Gmail message id we have already fetched + classified (whether or not
// it turned into an application). Used to skip work on subsequent syncs.
export const processedMessages = pgTable(
  "processed_message",
  {
    userId: text("user_id").notNull(),
    gmailMessageId: text("gmail_message_id").notNull(),
    isApplication: text("is_application"), // null | "yes" | "no"
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.gmailMessageId] }),
    index("processed_user_idx").on(t.userId),
  ],
);

// ---------------------------------------------------------------------------
// Job alerts
//
// A poller (internships/, run from GitHub Actions) fetches every enabled
// `job_source`, records what it finds in `job_listing`, and fans newly-seen
// postings out to `alert_subscriber` phone numbers over iMessage.
//
// Sources and listings are global — scraping a careers page is user-independent,
// so every user reads one shared cache. Watchlists and subscribers are per-user.
// ---------------------------------------------------------------------------

// One thing to poll: a GitHub listings repo, a company's ATS board, or a plain
// HTML careers page.
export const jobSources = pgTable(
  "job_source",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Shown in the Alerts UI and poll logs, e.g. "SimplifyJobs" / "Stripe".
    label: text("label").notNull(),
    // greenhouse | lever | ashby | workday | smartrecruiters | github | html
    adapter: text("adapter").notNull(),
    // Adapter-specific. { repo, path } | { board } | { host, tenant, site } |
    // { company } | { url, selector }
    config: jsonb("config").$type<Record<string, unknown>>().notNull(),
    // Which named list on the Alerts tab this source belongs to. See
    // ALERT_LISTS in src/lib/alertLists.ts. Only meaningful for sources that are
    // themselves the subject — the community repos — since a company's own board
    // is grouped by its watched_company entry instead.
    listKey: text("list_key"),
    // True for sources that only ever list internships (the GitHub repos), where
    // requiring an "intern"/"co-op" token in the title would drop real postings
    // whose titles omit the word. False for ATS boards, which list every role.
    trustedInternOnly: boolean("trusted_intern_only").notNull().default(false),
    enabled: boolean("enabled").notNull().default(true),
    // How often this source may be polled. The community feeds are cheap and
    // change constantly, so they run at the workflow's full 10-minute cadence.
    // Company career pages are a different matter: ~95 of them polled every 10
    // minutes is ~14,000 requests a day at those sites, which earns rate limits
    // and IP blocks. They default to hourly.
    pollIntervalMinutes: integer("poll_interval_minutes").notNull().default(60),
    // Last content revision seen (a git commit sha, or an ETag). Lets a poll
    // skip the download entirely when nothing changed — the SimplifyJobs feed is
    // ~11 MB and would otherwise be re-fetched every 10 minutes.
    lastSha: text("last_sha"),
    // Last *attempt*, successful or not. Drives the poll interval and backoff.
    lastPolledAt: timestamp("last_polled_at", {
      mode: "date",
      withTimezone: true,
    }),
    // Set on the first poll that actually succeeds. While NULL the poller records
    // listings but sends nothing, so seeding a source — or adding a company with
    // 800 open roles — can never fire hundreds of messages.
    //
    // Deliberately separate from lastPolledAt: a failed attempt must still push
    // the retry clock forward, but must not consume the one-time seeding grace.
    // Sharing one column would mean a source that failed once then succeeded
    // would treat its entire backlog as new and text all of it.
    seededAt: timestamp("seeded_at", { mode: "date", withTimezone: true }),
    lastError: text("last_error"),
    // Drives exponential backoff on the effective poll interval. Career sites
    // push back on scrapers — several in this watchlist returned 403 after only
    // a handful of requests — so a failing source must slow itself down instead
    // of hammering a host that is already rejecting it. Reset to 0 on success.
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("job_source_label_adapter_idx").on(t.label, t.adapter),
    index("job_source_enabled_idx").on(t.enabled),
  ],
);

export const jobListings = pgTable(
  "job_listing",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    sourceId: text("source_id")
      .notNull()
      .references(() => jobSources.id, { onDelete: "cascade" }),
    // The source's own stable id for this posting. Unique per source, which is
    // what makes new-posting detection an id diff rather than a content diff.
    externalId: text("external_id").notNull(),
    company: text("company").notNull(),
    // Lowercased/punctuation-stripped — joins listings to `watched_company`.
    normalizedCompany: text("normalized_company").notNull(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    // Identifies the same posting across sources: both GitHub repos carry many
    // of the same jobs under different ids. Derived from the apply URL, falling
    // back to company + title. Deliveries are deduped on this, not on listing
    // id, so one job never produces two messages.
    dedupeKey: text("dedupe_key").notNull(),
    locations: jsonb("locations").$type<string[]>(),
    // A value from TERMS in src/lib/types.ts, or NULL when the source doesn't
    // say. NULL passes the term filter rather than being dropped.
    term: text("term"),
    sponsorship: text("sponsorship"),
    category: text("category"),
    postedAt: timestamp("posted_at", { mode: "date", withTimezone: true }),
    firstSeenAt: timestamp("first_seen_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    // Cleared when a posting stops appearing in its source feed.
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    uniqueIndex("job_listing_source_external_idx").on(t.sourceId, t.externalId),
    index("job_listing_company_idx").on(t.normalizedCompany),
    index("job_listing_first_seen_idx").on(t.firstSeenAt),
    index("job_listing_dedupe_idx").on(t.dedupeKey),
  ],
);

// Companies a user follows. A subscriber with scope 'watchlist' is only alerted
// for postings whose normalized company appears here. Matching is by name, so a
// watchlist entry starts working immediately against the GitHub feeds — adding a
// dedicated ATS source for the company is an optional upgrade, not a
// prerequisite.
export const watchedCompanies = pgTable(
  "watched_company",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    // Which named list on the Alerts tab this company belongs to. See
    // ALERT_LISTS in src/lib/alertLists.ts.
    listKey: text("list_key").notNull().default("harun"),
    // Free-text ranking from the user's own list ("S+", "A++", "B-"). Used for
    // ordering the watchlist and grouping digests, not for filtering.
    tier: text("tier"),
    // Extra normalized names that also count as this company. Necessary because
    // sources name employers differently than people do: a watchlist entry for
    // "HRT" must match a listing from "Hudson River Trading", and "Block" must
    // match both "Square" and "Cash App". Without this, abbreviations and
    // parent/brand splits silently match nothing at all.
    aliases: jsonb("aliases").$type<string[]>(),
    // Optional dedicated source polled for this company's own board.
    sourceId: text("source_id").references(() => jobSources.id, {
      onDelete: "set null",
    }),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("watched_company_user_name_idx").on(t.userId, t.normalizedName),
    index("watched_company_user_idx").on(t.userId),
  ],
);

// An iMessage recipient. Not necessarily an app user — just a phone number the
// owner has provisioned, which is why these rows key off the user who added them
// rather than off Supabase auth.
export const alertSubscribers = pgTable(
  "alert_subscriber",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id").notNull(),
    label: text("label").notNull(),
    // E.164, e.g. +15714619323.
    phone: text("phone").notNull(),
    // all       — every posting that passes the intern/co-op + term filter
    // watchlist — only postings from this user's `watched_company` rows
    scope: text("scope").notNull().default("watchlist"),
    enabled: boolean("enabled").notNull().default(true),
    // Set when the intro/opt-out message has been delivered.
    confirmedAt: timestamp("confirmed_at", {
      mode: "date",
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("alert_subscriber_phone_idx").on(t.phone),
    index("alert_subscriber_user_idx").on(t.userId),
  ],
);

// The notification ledger. A row is inserted as 'pending' *before* the message
// goes out, so the UNIQUE constraint below is what makes the whole pipeline
// idempotent: a crashed run, a retried job, or a double-fired cron can never
// text the same posting twice. Deduping on `dedupe_key` rather than listing id
// also collapses the same job arriving from two different sources.
export const alertDeliveries = pgTable(
  "alert_delivery",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    subscriberId: text("subscriber_id")
      .notNull()
      .references(() => alertSubscribers.id, { onDelete: "cascade" }),
    listingId: text("listing_id")
      .notNull()
      .references(() => jobListings.id, { onDelete: "cascade" }),
    dedupeKey: text("dedupe_key").notNull(),
    // pending | sent | failed
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    sentAt: timestamp("sent_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("alert_delivery_subscriber_dedupe_idx").on(
      t.subscriberId,
      t.dedupeKey,
    ),
    index("alert_delivery_status_idx").on(t.status),
  ],
);

// One row per source per poll. Powers the health panel in the Alerts tab and
// makes a silent scraper breakage visible instead of just looking quiet.
export const pollRuns = pgTable(
  "poll_run",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    sourceId: text("source_id").references(() => jobSources.id, {
      onDelete: "cascade",
    }),
    startedAt: timestamp("started_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { mode: "date", withTimezone: true }),
    // Postings returned by the source after filtering.
    found: integer("found").notNull().default(0),
    // Of those, ones never seen before.
    created: integer("created").notNull().default(0),
    // Messages actually sent as a result.
    notified: integer("notified").notNull().default(0),
    skipped: boolean("skipped").notNull().default(false),
    error: text("error"),
  },
  (t) => [index("poll_run_source_idx").on(t.sourceId, t.startedAt)],
);

export const syncState = pgTable("sync_state", {
  userId: text("user_id").primaryKey(),
  status: text("status").notNull().default("idle"), // idle | running | error
  lastError: text("last_error"),
  lastResultCount: integer("last_result_count"),
  lastSyncedAt: timestamp("last_synced_at", {
    mode: "date",
    withTimezone: true,
  }),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
});
