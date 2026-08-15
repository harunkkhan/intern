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
import { dedupeKeyFor, pickMatchingApplication } from "@/lib/applications";
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
  const term = result.term ?? null;
  const dedupeKey = dedupeKeyFor(company, position, term);
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

  // No exact (company + position + cycle) match — e.g. a follow-up email whose
  // role title differs from a manually-added entry, or omits it entirely. Fall
  // back to an existing entry at the SAME company whose role title matches once
  // both are normalized (filler words / casing / punctuation stripped). This lets
  // an interview/OA/offer email land on the entry you already created instead of
  // spawning a duplicate. See pickMatchingApplication for how ties break.
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
    const picked = pickMatchingApplication(sameCompany, position, term);
    if (picked) app = picked;
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
        term,
        industry: result.industry,
        companyType: result.companyType,
        status,
        oaCompleted: result.assessmentCompleted,
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

  // Recording a cycle for the first time moves the row's dedupe key, because the
  // key encodes it. Another entry can already own the resulting key — a manual
  // row for the same role and cycle, or one peeled off by a split — and writing
  // into it would fail the unique index and leave this email to be retried on
  // every future sync. Leaving the cycle unset keeps the row matchable through
  // the cycle-agnostic fallback above, which is where it came from.
  let nextTerm = app.term;
  let nextDedupeKey = app.dedupeKey;
  if (!app.term && term) {
    const rekeyed = dedupeKeyFor(app.company, app.position, term);
    const [taken] = await db
      .select({ id: applications.id })
      .from(applications)
      .where(
        and(
          eq(applications.userId, userId),
          eq(applications.dedupeKey, rekeyed),
        ),
      )
      .limit(1);
    if (!taken) {
      nextTerm = term;
      nextDedupeKey = rekeyed;
    }
  }

  await db
    .update(applications)
    .set({
      status: isNewest ? status : app.status,
      // Only ever set, never cleared: a later email that says nothing about the
      // assessment is not evidence you un-took it, and clearing would fight the
      // manual toggle on every sync.
      oaCompleted: app.oaCompleted || result.assessmentCompleted,
      lastEventAt: isNewest ? email.date : app.lastEventAt,
      appliedAt: earliestApplied,
      term: nextTerm,
      dedupeKey: nextDedupeKey,
      industry: app.industry ?? result.industry,
      companyType: app.companyType ?? result.companyType,
      updatedAt: new Date(),
    })
    .where(eq(applications.id, app.id));

  return created ? "created" : "updated";
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
