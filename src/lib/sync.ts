import { and, eq } from "drizzle-orm";
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

    for (const { id } of batch) {
      const email = await fetchEmail(auth, id);

      let isApp = false;
      // Hard cutoff: emails before the tracking start date are never recorded
      // (and skip the Gemini call). Marked processed so they aren't re-fetched.
      if (email.date >= trackAfter) {
        const result = await classifyEmail(email);
        isApp =
          result.isApplicationRelated && !!result.company && !!result.position;

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
  const position = result.position!.trim();
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

  let created = false;
  if (!app) {
    [app] = await db
      .insert(applications)
      .values({
        userId,
        company,
        position,
        dedupeKey,
        positionType: result.positionType,
        industry: result.industry,
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
      positionType: app.positionType ?? result.positionType,
      industry: app.industry ?? result.industry,
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
