import "server-only";
import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  ilike,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import {
  alertSubscribers,
  jobListings,
  jobSources,
  watchedCompanies,
} from "@/db/schema";
import { normalizePageSize, POSTINGS_WINDOW_DAYS } from "@/lib/postings";
import { redactDiscordWebhook } from "@/lib/discordWebhook";

export const ALERT_SCOPES = ["all", "watchlist"] as const;
export type AlertScope = (typeof ALERT_SCOPES)[number];

export const ALERT_CHANNELS = ["imessage", "discord"] as const;
export type AlertChannel = (typeof ALERT_CHANNELS)[number];

export interface SubscriberDTO {
  id: string;
  label: string;
  channel: AlertChannel;
  /**
   * What the dashboard shows as the destination. A phone number for iMessage; for
   * Discord the webhook id only — the token half is a bearer credential and never
   * leaves the server.
   */
  destination: string;
  scope: AlertScope;
  enabled: boolean;
  confirmedAt: string | null;
}

export interface WatchedCompanyDTO {
  id: string;
  name: string;
  tier: string | null;
  listKey: string;
  enabled: boolean;
  sourceLabel: string | null;
  /** Active listings currently matching this company across every source. */
  openCount: number;
}

/** A source that is itself the subject of a list, e.g. a community repo. */
export interface ListSourceDTO {
  id: string;
  label: string;
  adapter: string;
  listKey: string;
  enabled: boolean;
  lastPolledAt: string | null;
  lastError: string | null;
  listingCount: number;
}

export interface AlertListingDTO {
  id: string;
  company: string;
  title: string;
  url: string;
  locations: string[] | null;
  term: string | null;
  firstSeenAt: string;
  sourceLabel: string;
}

export interface SourceHealthDTO {
  id: string;
  label: string;
  adapter: string;
  enabled: boolean;
  lastPolledAt: string | null;
  lastError: string | null;
  listingCount: number;
}

export interface AlertsData {
  subscribers: SubscriberDTO[];
  companies: WatchedCompanyDTO[];
  /** Sources that belong to a named list in their own right (the repo lists). */
  listSources: ListSourceDTO[];
  sources: SourceHealthDTO[];
}

/** One page of postings, shown on their own tab rather than inside Alerts. */
export interface PostingsData {
  rows: AlertListingDTO[];
  /** Rows matching the current query, across every page. */
  total: number;
  page: number;
  pageSize: number;
  query: string;
}

const RECENT_LIMIT = 40;

export async function getAlertsData(userId: string): Promise<AlertsData> {
  const [subscriberRows, companyRows, listSourceRows, sourceRows] =
    await Promise.all([
      db
        .select()
        .from(alertSubscribers)
        .where(eq(alertSubscribers.userId, userId))
        .orderBy(desc(alertSubscribers.createdAt)),

      db
        .select({
          id: watchedCompanies.id,
          name: watchedCompanies.name,
          tier: watchedCompanies.tier,
          listKey: watchedCompanies.listKey,
          normalizedName: watchedCompanies.normalizedName,
          enabled: watchedCompanies.enabled,
          sourceLabel: jobSources.label,
        })
        .from(watchedCompanies)
        .leftJoin(jobSources, eq(watchedCompanies.sourceId, jobSources.id))
        .where(eq(watchedCompanies.userId, userId))
        .orderBy(watchedCompanies.name),

      // Sources that belong to a list in their own right. Company boards are
      // excluded by the NOT NULL check — those are grouped via watched_company.
      db
        .select({
          id: jobSources.id,
          label: jobSources.label,
          adapter: jobSources.adapter,
          listKey: jobSources.listKey,
          enabled: jobSources.enabled,
          lastPolledAt: jobSources.lastPolledAt,
          lastError: jobSources.lastError,
          listingCount: count(jobListings.id),
        })
        .from(jobSources)
        .leftJoin(
          jobListings,
          and(
            eq(jobListings.sourceId, jobSources.id),
            eq(jobListings.active, true),
          ),
        )
        .where(isNotNull(jobSources.listKey))
        .groupBy(jobSources.id)
        .orderBy(jobSources.label),

      db
        .select({
          id: jobSources.id,
          label: jobSources.label,
          adapter: jobSources.adapter,
          enabled: jobSources.enabled,
          lastPolledAt: jobSources.lastPolledAt,
          lastError: jobSources.lastError,
          listingCount: count(jobListings.id),
        })
        .from(jobSources)
        .leftJoin(
          jobListings,
          and(
            eq(jobListings.sourceId, jobSources.id),
            eq(jobListings.active, true),
          ),
        )
        .groupBy(jobSources.id)
        .orderBy(jobSources.label),
    ]);

  // One grouped count for every watched company rather than a query per row.
  const openCounts = new Map<string, number>();
  if (companyRows.length > 0) {
    const counts = await db
      .select({
        normalizedCompany: jobListings.normalizedCompany,
        total: count(jobListings.id),
      })
      .from(jobListings)
      .where(
        and(
          eq(jobListings.active, true),
          sql`${jobListings.normalizedCompany} = ANY(${sql.param(
            companyRows.map((c) => c.normalizedName),
          )}::text[])`,
        ),
      )
      .groupBy(jobListings.normalizedCompany);
    for (const row of counts) {
      openCounts.set(row.normalizedCompany, Number(row.total));
    }
  }

  return {
    subscribers: subscriberRows.map((s) => ({
      id: s.id,
      label: s.label,
      channel: s.channel as AlertChannel,
      destination:
        s.channel === "discord"
          ? redactDiscordWebhook(s.webhookUrl ?? "")
          : (s.phone ?? ""),
      scope: s.scope as AlertScope,
      enabled: s.enabled,
      confirmedAt: s.confirmedAt ? s.confirmedAt.toISOString() : null,
    })),
    companies: companyRows.map((c) => ({
      id: c.id,
      name: c.name,
      tier: c.tier,
      listKey: c.listKey,
      enabled: c.enabled,
      sourceLabel: c.sourceLabel,
      openCount: openCounts.get(c.normalizedName) ?? 0,
    })),
    listSources: listSourceRows.map((s) => ({
      id: s.id,
      label: s.label,
      adapter: s.adapter,
      listKey: s.listKey ?? "",
      enabled: s.enabled,
      lastPolledAt: s.lastPolledAt ? s.lastPolledAt.toISOString() : null,
      lastError: s.lastError,
      listingCount: Number(s.listingCount),
    })),
    sources: sourceRows.map((s) => ({
      id: s.id,
      label: s.label,
      adapter: s.adapter,
      enabled: s.enabled,
      lastPolledAt: s.lastPolledAt ? s.lastPolledAt.toISOString() : null,
      lastError: s.lastError,
      listingCount: Number(s.listingCount),
    })),
  };
}

/** Discord returns at most 25 autocomplete choices, each at most 100 chars. */
const DISCORD_CHOICE_LIMIT = 25;
const DISCORD_CHOICE_MAX_LENGTH = 100;

/**
 * Suggestions for the `source` option of the Discord /load command.
 *
 * Distinct labels, because what is unique is (label, adapter): the same company
 * can hold an enabled row under two adapters, and `--source` polls every enabled
 * row with that label anyway, so offering it twice would just be noise.
 *
 * Labels longer than Discord's choice limit are dropped rather than truncated —
 * a truncated value would no longer exact-match a label, so picking it would
 * poll nothing.
 */
export async function getEnabledSourceLabels(term: string): Promise<string[]> {
  const filters = [
    eq(jobSources.enabled, true),
    sql`char_length(${jobSources.label}) <= ${DISCORD_CHOICE_MAX_LENGTH}`,
  ];
  const trimmed = term.trim();
  if (trimmed) {
    const like = `%${trimmed.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    filters.push(ilike(jobSources.label, like));
  }

  const rows = await db
    .selectDistinct({ label: jobSources.label })
    .from(jobSources)
    .where(and(...filters))
    .orderBy(jobSources.label)
    .limit(DISCORD_CHOICE_LIMIT);
  return rows.map((r) => r.label);
}

/**
 * Whether a label names an enabled source, exactly as the poller matches it.
 *
 * This is a security boundary, not a nicety. Autocomplete only suggests —
 * Discord submits whatever the user typed into the option — and the value
 * reaches poll.yml, where it becomes a shell argument in a step holding the
 * database URL and the iMessage credentials. Nothing is dispatched until a
 * value has been found here.
 */
export async function isEnabledSourceLabel(label: string): Promise<boolean> {
  const rows = await db
    .select({ id: jobSources.id })
    .from(jobSources)
    .where(and(eq(jobSources.enabled, true), eq(jobSources.label, label)))
    .limit(1);
  return rows.length > 0;
}

// Page-size options live in src/lib/postings.ts so client components can import
// them without dragging the database client into the browser bundle.

/**
 * Backs the Postings tab. Paged and filtered in Postgres rather than in the
 * browser: there are well over a thousand active listings, so shipping them all
 * to filter client-side would be a large payload that grows with every poll, and
 * searching only the loaded page would quietly miss matches.
 */
export async function getPostingsData(
  options: { page?: number; query?: string; pageSize?: number } = {},
): Promise<PostingsData> {
  const query = (options.query ?? "").trim();
  const page = Math.max(0, Math.floor(options.page ?? 0));
  const pageSize = normalizePageSize(options.pageSize);

  // Only postings that opened within the window. `posted_at` is the company's own
  // date and is authoritative where a source reports one; where none is reported
  // — every scraped careers page — the date we first saw it stands in, since
  // otherwise a third of the corpus could never appear at all.
  const cutoff = new Date(
    Date.now() - POSTINGS_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
  const filters = [
    eq(jobListings.active, true),
    or(
      gte(jobListings.postedAt, cutoff),
      and(isNull(jobListings.postedAt), gte(jobListings.firstSeenAt, cutoff)),
    )!,
  ];
  if (query) {
    const like = `%${query.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    filters.push(
      or(
        ilike(jobListings.company, like),
        ilike(jobListings.title, like),
        ilike(jobListings.term, like),
        // locations is jsonb; casting to text lets one LIKE cover every entry.
        sql`${jobListings.locations}::text ILIKE ${like}`,
      )!,
    );
  }
  const where = and(...filters);

  // One row per job, not per source: the GitHub feeds and the company's own board
  // carry the same posting under different ids, and dedupe_key is what says they
  // are the same. The copy kept is the earliest sighting, so the date shown is
  // also the date the outer sort uses — a later copy's date would claim the job
  // appeared after it did. The search predicate deliberately runs before the
  // collapse: the winning copy is chosen among matching rows, so a job whose only
  // matching copy is worded differently still turns up instead of vanishing.
  const deduped = db
    .selectDistinctOn([jobListings.dedupeKey], {
      id: jobListings.id,
      company: jobListings.company,
      title: jobListings.title,
      url: jobListings.url,
      locations: jobListings.locations,
      term: jobListings.term,
      firstSeenAt: jobListings.firstSeenAt,
      sourceLabel: jobSources.label,
    })
    .from(jobListings)
    .innerJoin(jobSources, eq(jobListings.sourceId, jobSources.id))
    .where(where)
    .orderBy(
      jobListings.dedupeKey,
      asc(jobListings.firstSeenAt),
      asc(jobListings.id),
    )
    .as("deduped");

  const [rows, [totals]] = await Promise.all([
    db
      .select()
      .from(deduped)
      // `id` breaks the tie: a poll stamps every row it inserts with the same
      // first_seen_at, so without it LIMIT/OFFSET can repeat or skip rows.
      .orderBy(desc(deduped.firstSeenAt), desc(deduped.id))
      .limit(pageSize)
      .offset(page * pageSize),
    db
      .select({ total: countDistinct(jobListings.dedupeKey) })
      .from(jobListings)
      .where(where),
  ]);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      company: r.company,
      title: r.title,
      url: r.url,
      locations: r.locations,
      term: r.term,
      firstSeenAt: r.firstSeenAt.toISOString(),
      sourceLabel: r.sourceLabel,
    })),
    total: Number(totals?.total ?? 0),
    page,
    pageSize,
    query,
  };
}

/**
 * Normalizes user input to E.164, which is the only format Spectrum accepts.
 * Bare 10-digit input is assumed to be +1; anything else must be entered with a
 * country code so a non-US number can't be silently mangled into a US one.
 */
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  if (trimmed.startsWith("+")) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export interface DetectedSource {
  adapter: string;
  config: Record<string, string>;
}

/**
 * Derives an adapter and its config from a pasted careers URL, so adding a
 * company doesn't require knowing which ATS it runs. Returns null when the URL
 * isn't a recognized board — the watchlist entry still works in that case,
 * matching against the GitHub feeds by company name.
 */
export function detectSource(rawUrl: string): DetectedSource | null {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./i, "").toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);

  if (host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io") {
    const board = segments[0];
    return board ? { adapter: "greenhouse", config: { board } } : null;
  }
  if (host === "jobs.lever.co") {
    const company = segments[0];
    return company ? { adapter: "lever", config: { company } } : null;
  }
  if (host === "jobs.ashbyhq.com") {
    const board = segments[0];
    return board ? { adapter: "ashby", config: { board } } : null;
  }
  if (host === "jobs.smartrecruiters.com") {
    const company = segments[0];
    return company ? { adapter: "smartrecruiters", config: { company } } : null;
  }
  if (host.endsWith(".myworkdayjobs.com")) {
    const tenant = host.split(".")[0];
    // Paths look like /en-US/<Site> or /<Site>; the locale segment, when
    // present, is the only one shaped like "xx-YY".
    const site = segments.find((s) => !/^[a-z]{2}-[A-Z]{2}$/.test(s));
    return tenant && site
      ? { adapter: "workday", config: { host, tenant, site } }
      : null;
  }
  return null;
}
