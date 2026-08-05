// Subscriber lifecycle, shared by the inbound listener and the CLI.
//
// There is nothing to import from Spectrum Cloud: its `cloud` client exposes
// project and platform metadata only (`getProject`, `getImessageInfo`,
// `getPlatforms`, token issuance), and the space namespace has `create`/`get`
// but no `list`. Numbers in the Photon dashboard are the lines this app sends
// *from*; recipients live here, in `alert_subscriber`. The automatic way in is
// therefore inbound — someone texts the line and `listen.ts` records them.

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "./db.ts";

const { alertSubscribers, alertDeliveries, watchedCompanies } = schema;

export const ALERT_SCOPES = ["all", "watchlist"] as const;
export type AlertScope = (typeof ALERT_SCOPES)[number];

export type Subscriber = typeof alertSubscribers.$inferSelect;

/**
 * Mirrors `normalizePhone` in src/lib/alerts.ts. That module can't be imported
 * here: it opens with `import "server-only"` and resolves `@/` aliases through
 * Next's tsconfig paths, neither of which survives outside the web app. Keep
 * the two in step — a number normalized differently on each side would create a
 * second subscriber row rather than matching the existing one.
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

export function isAlertScope(value: string): value is AlertScope {
  return (ALERT_SCOPES as readonly string[]).includes(value);
}

/**
 * Which account a texted-in number is filed under. This is not cosmetic:
 * `scope: "watchlist"` resolves against that user's `watched_company` rows
 * (poll.ts:464), so filing a subscriber under the wrong id silently gives them
 * an empty watchlist and they never hear anything.
 *
 * Preference order is the owner set explicitly, then whoever actually owns a
 * watchlist, then any existing subscriber's account.
 */
export async function resolveOwnerUserId(): Promise<string> {
  const configured = process.env.ALERT_OWNER_USER_ID?.trim();
  if (configured) return configured;

  const [watchlistOwner] = await db
    .select({
      userId: watchedCompanies.userId,
      companies: sql<number>`count(*)::int`,
    })
    .from(watchedCompanies)
    .where(eq(watchedCompanies.enabled, true))
    .groupBy(watchedCompanies.userId)
    .orderBy(desc(sql`count(*)`))
    .limit(1);
  if (watchlistOwner) return watchlistOwner.userId;

  const [anySubscriber] = await db
    .select({ userId: alertSubscribers.userId })
    .from(alertSubscribers)
    .limit(1);
  if (anySubscriber) return anySubscriber.userId;

  throw new Error(
    "No account to file this subscriber under — no watched companies and no " +
      "existing subscribers. Add a company in the app first, or set " +
      "ALERT_OWNER_USER_ID.",
  );
}

export type ImportStatus = "created" | "reenabled" | "known";

export interface ImportOutcome {
  status: ImportStatus;
  subscriber: Subscriber;
}

export interface ImportOptions {
  label?: string;
  scope?: AlertScope;
  /**
   * Set when the number reached us itself. Suppresses the poller's cold-open
   * intro (poll.ts:528), which would otherwise arrive as a second, redundant
   * "here's what this is" text after the listener already replied.
   */
  confirmed?: boolean;
}

/** A stand-in until a real name is known — the dashboard shows this. */
function defaultLabel(phone: string): string {
  return `Texted in ${phone.slice(-4)}`;
}

/**
 * Record a number as a subscriber. Safe to call repeatedly for the same phone:
 * an already-active subscriber comes back as `known` and is left untouched.
 */
export async function importSubscriber(
  rawPhone: string,
  options: ImportOptions = {},
): Promise<ImportOutcome> {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw new Error(`not a usable phone number: ${rawPhone}`);

  const existing = await findByPhone(phone);
  if (existing) {
    if (existing.enabled) return { status: "known", subscriber: existing };
    const [reenabled] = await db
      .update(alertSubscribers)
      .set({ enabled: true })
      .where(eq(alertSubscribers.id, existing.id))
      .returning();
    return { status: "reenabled", subscriber: reenabled ?? existing };
  }

  const [created] = await db
    .insert(alertSubscribers)
    .values({
      userId: await resolveOwnerUserId(),
      label: options.label?.trim() || defaultLabel(phone),
      // Set explicitly rather than leaning on the column default: the CHECK
      // constraint ties the channel to which address column must be populated,
      // so the pair belongs in one place.
      channel: "imessage",
      phone,
      scope: options.scope ?? "watchlist",
      confirmedAt: options.confirmed ? new Date() : null,
    })
    .onConflictDoNothing({ target: alertSubscribers.phone })
    .returning();
  if (created) return { status: "created", subscriber: created };

  // Lost the insert race against another process. The row exists either way,
  // which is the outcome the caller asked for.
  const raced = await findByPhone(phone);
  if (!raced) throw new Error(`failed to record ${phone}`);
  return { status: "known", subscriber: raced };
}

/**
 * Only iMessage rows carry a phone, so matching on the number alone can't
 * collide with a Discord subscriber — but the channel is stated anyway, since
 * everything in this module is about the iMessage side.
 */
export async function findByPhone(phone: string): Promise<Subscriber | null> {
  const [row] = await db
    .select()
    .from(alertSubscribers)
    .where(
      and(
        eq(alertSubscribers.channel, "imessage"),
        eq(alertSubscribers.phone, phone),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** What to show for a subscriber: a phone number, or the Discord webhook's id. */
export function destinationOf(subscriber: Subscriber): string {
  if (subscriber.channel === "imessage") return subscriber.phone ?? "(no phone)";
  const id = subscriber.webhookUrl?.split("/").at(-2);
  return id ? `discord webhook ${id}` : "(no webhook)";
}

export async function listSubscribers(): Promise<Subscriber[]> {
  return db.select().from(alertSubscribers).orderBy(desc(alertSubscribers.createdAt));
}

/** Returns the updated row, or null if the number was never a subscriber. */
export async function setEnabled(
  phone: string,
  enabled: boolean,
): Promise<Subscriber | null> {
  const [row] = await db
    .update(alertSubscribers)
    .set({ enabled })
    .where(
      and(
        eq(alertSubscribers.channel, "imessage"),
        eq(alertSubscribers.phone, phone),
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * Clear the attempt counter on a subscriber's failed deliveries so the next
 * poll retries them.
 *
 * The poller only picks up rows with `attempts < MAX_ATTEMPTS` (poll.ts:518),
 * so anything that failed three times is out of the running permanently. That
 * is the right default for a bad number, but wrong after a transient block —
 * Spectrum's new-contact cap, say — where the backlog is still deliverable once
 * the block lifts.
 */
export async function retryFailed(phone: string): Promise<number> {
  const subscriber = await findByPhone(phone);
  if (!subscriber) return 0;

  const reset = await db
    .update(alertDeliveries)
    .set({ status: "pending", attempts: 0, error: null })
    .where(
      inArray(
        alertDeliveries.id,
        db
          .select({ id: alertDeliveries.id })
          .from(alertDeliveries)
          .where(
            sql`${alertDeliveries.subscriberId} = ${subscriber.id} and ${alertDeliveries.status} = 'failed'`,
          ),
      ),
    )
    .returning({ id: alertDeliveries.id });
  return reset.length;
}
