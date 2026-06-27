import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  applications,
  applicationEvents,
  processedMessages,
  syncState,
} from "@/db/schema";
import { getGoogleAuthForUser } from "@/lib/google";
import {
  defaultGmailQuery,
  fetchEmail,
  getTrackAfterDate,
  listCandidateMessages,
  type ParsedEmail,
} from "@/lib/gmail";
import { classifyEmail } from "@/lib/classify";
import type { ClassificationResult } from "@/lib/types";

// Bound work per invocation so a single run stays within serverless time limits
// (each candidate email may cost a ~1-2s Gemini call). The daily cron and the
// manual button drain any remaining backlog over repeated runs.
const MAX_EMAILS_PER_RUN = 25;

export interface SyncResult {
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  remaining: number;
}

export async function runSync(userId: string): Promise<SyncResult> {
  await setSyncState(userId, { status: "running" });

  try {
    const auth = await getGoogleAuthForUser(userId);
    const query = defaultGmailQuery();
    const candidates = await listCandidateMessages(auth, query);

    const seen = new Set(
      (
        await db
          .select({ id: processedMessages.gmailMessageId })
          .from(processedMessages)
          .where(eq(processedMessages.userId, userId))
      ).map((r) => r.id),
    );

    const pending = candidates.filter((c) => !seen.has(c.id));
    const batch = pending.slice(0, MAX_EMAILS_PER_RUN);
    const trackAfter = getTrackAfterDate();

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    let consecutiveFailures = 0;

    for (const { id } of batch) {
      const email = await fetchEmail(auth, id);

      let isApp = false;
      try {
        // Hard cutoff: emails before the tracking start date are never recorded
        // (and skip the Gemini call).
        if (email.date >= trackAfter) {
          const result = await classifyEmail(email);
          // A known company is enough to track; the role is often absent from
          // confirmation emails and can be filled in from the details panel.
          isApp = result.isApplicationRelated && !!result.company;

          if (isApp) {
            const outcome = await applyClassification(userId, email, result);
            if (outcome === "created") created++;
            else updated++;
          } else {
            skipped++;
          }
        } else {
          skipped++;
        }
        consecutiveFailures = 0;
      } catch {
        // Transient failure (e.g. Gemini overloaded). Leave the email
        // unprocessed so it retries next sync; bail early if the service looks
        // down rather than hammering it for the rest of the batch.
        failed++;
        if (++consecutiveFailures >= 3) break;
        continue;
      }

      // Only reached on success — marks the email so it isn't re-fetched.
      await db
        .insert(processedMessages)
        .values({
          userId,
          gmailMessageId: email.id,
          isApplication: isApp ? "yes" : "no",
        })
        .onConflictDoNothing();
    }

    await setSyncState(userId, {
      status: "idle",
      lastError: null,
      lastResultCount: created + updated,
      lastSyncedAt: new Date(),
    });

    return {
      processed: batch.length,
      created,
      updated,
      skipped,
      failed,
      remaining: pending.length - batch.length,
    };
  } catch (err) {
    await setSyncState(userId, {
      status: "error",
      lastError: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

async function applyClassification(
  userId: string,
  email: ParsedEmail,
  result: ClassificationResult,
): Promise<"created" | "updated"> {
  const company = result.company!.trim();
  const position = result.position?.trim() || "Unknown role";
  const dedupeKey = `${company.toLowerCase()}::${position.toLowerCase()}`;
  const status = result.status ?? "applied";

  let [app] = await db
    .select()
    .from(applications)
    .where(
      and(
        eq(applications.userId, userId),
        eq(applications.dedupeKey, dedupeKey),
      ),
    )
    .limit(1);

  // No exact (company + position) match — e.g. a follow-up email whose role
  // title differs from a manually-added entry, or omits it entirely. Fall back
  // to an existing entry at the SAME company whose role title matches once both
  // are normalized (filler words / casing / punctuation stripped). This lets an
  // interview/OA/offer email land on the entry you already created instead of
  // spawning a duplicate. The most recently active matching entry wins.
  if (!app) {
    const sameCompany = await db
      .select()
      .from(applications)
      .where(
        and(
          eq(applications.userId, userId),
          sql`lower(${applications.company}) = ${company.toLowerCase()}`,
        ),
      );
    app = sameCompany
      .filter((a) => positionsMatch(a.position, position))
      .sort(
        (x, y) =>
          (y.lastEventAt?.getTime() ?? 0) - (x.lastEventAt?.getTime() ?? 0),
      )[0];
  }

  let created = false;
  if (!app) {
    [app] = await db
      .insert(applications)
      .values({
        userId,
        company,
        position,
        dedupeKey,
        term: result.term,
        industry: result.industry,
        companyType: result.companyType,
        status,
        appliedAt: email.date,
        lastEventAt: email.date,
        source: result.source,
      })
      .returning();
    created = true;
  }

  await db
    .insert(applicationEvents)
    .values({
      applicationId: app.id,
      userId,
      status,
      summary: result.summary,
      emailSubject: email.subject,
      emailFrom: email.from,
      gmailMessageId: email.id,
      gmailThreadId: email.threadId,
      occurredAt: email.date,
    })
    .onConflictDoNothing();

  // Current status is the latest event by date; fill any missing metadata.
  const isNewest = !app.lastEventAt || email.date >= app.lastEventAt;
  const earliestApplied =
    app.appliedAt && app.appliedAt < email.date ? app.appliedAt : email.date;

  await db
    .update(applications)
    .set({
      status: isNewest ? status : app.status,
      lastEventAt: isNewest ? email.date : app.lastEventAt,
      appliedAt: earliestApplied,
      term: app.term ?? result.term,
      industry: app.industry ?? result.industry,
      companyType: app.companyType ?? result.companyType,
      updatedAt: new Date(),
    })
    .where(eq(applications.id, app.id));

  return created ? "created" : "updated";
}

// Tokens that describe the cycle/seniority/wrapping of a posting rather than the
// role itself. Stripped before comparing titles so "Software Engineer Intern"
// and "Software Engineer, Summer 2027" are recognized as the same role.
const POSITION_FILLER = new Set([
  "intern",
  "interns",
  "internship",
  "internships",
  "co",
  "op",
  "coop",
  "program",
  "programme",
  "summer",
  "fall",
  "autumn",
  "winter",
  "spring",
  "new",
  "grad",
  "graduate",
  "fulltime",
  "parttime",
  "contract",
  "temporary",
  "the",
  "a",
  "an",
  "of",
  "for",
  "role",
  "position",
  "opening",
  "req",
  "id",
  "i",
  "ii",
  "iii",
]);

function positionTokens(position: string): Set<string> {
  return new Set(
    position
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\b20\d\d\b/g, " ")
      .split(/\s+/)
      .filter((w) => w && !POSITION_FILLER.has(w)),
  );
}

// Two titles match when one's distinguishing tokens are a subset of the other's
// (after filler removal) — tolerant of word order, casing, and extra qualifiers
// while still keeping genuinely different roles apart.
function positionsMatch(a: string, b: string): boolean {
  const ta = positionTokens(a);
  const tb = positionTokens(b);
  if (ta.size === 0 || tb.size === 0) return false;
  const [small, large] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  for (const t of small) if (!large.has(t)) return false;
  return true;
}

async function setSyncState(
  userId: string,
  patch: Partial<{
    status: string;
    lastError: string | null;
    lastResultCount: number;
    lastSyncedAt: Date;
  }>,
) {
  await db
    .insert(syncState)
    .values({
      userId,
      status: patch.status ?? "idle",
      lastError: patch.lastError ?? null,
      lastResultCount: patch.lastResultCount ?? null,
      lastSyncedAt: patch.lastSyncedAt ?? null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: syncState.userId,
      set: { ...patch, updatedAt: new Date() },
    });
}
