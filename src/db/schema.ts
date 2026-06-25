import {
  pgTable,
  text,
  integer,
  timestamp,
  primaryKey,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// Auth is handled by Supabase Auth (the `auth.users` schema it manages). App
// tables key off the Supabase user id (a UUID) stored as plain text — no
// cross-schema foreign key, which keeps Drizzle migrations self-contained.

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
