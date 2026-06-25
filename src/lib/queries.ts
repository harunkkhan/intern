import { asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  applications,
  applicationEvents,
  googleTokens,
  syncState,
} from "@/db/schema";
import type {
  ApplicationDTO,
  ApplicationEventDTO,
  ApplicationStatus,
  CompanyType,
  Industry,
  Term,
} from "@/lib/types";

// The cron has no user session; it resolves the single allowed user from the
// stored Google token row keyed by email.
export async function getUserIdByEmail(email: string): Promise<string | null> {
  const [row] = await db
    .select({ id: googleTokens.userId })
    .from(googleTokens)
    .where(eq(googleTokens.email, email))
    .limit(1);
  return row?.id ?? null;
}

export async function getApplicationsForUser(
  userId: string,
): Promise<ApplicationDTO[]> {
  const apps = await db
    .select()
    .from(applications)
    .where(eq(applications.userId, userId))
    .orderBy(desc(applications.lastEventAt));

  if (apps.length === 0) return [];

  const events = await db
    .select()
    .from(applicationEvents)
    .where(
      inArray(
        applicationEvents.applicationId,
        apps.map((a) => a.id),
      ),
    )
    .orderBy(asc(applicationEvents.occurredAt));

  const eventsByApp = new Map<string, ApplicationEventDTO[]>();
  for (const e of events) {
    const list = eventsByApp.get(e.applicationId) ?? [];
    list.push({
      id: e.id,
      status: e.status as ApplicationStatus,
      summary: e.summary,
      emailSubject: e.emailSubject,
      emailFrom: e.emailFrom,
      occurredAt: e.occurredAt.toISOString(),
    });
    eventsByApp.set(e.applicationId, list);
  }

  return apps.map((a) => ({
    id: a.id,
    company: a.company,
    position: a.position,
    term: (a.term as Term | null) ?? null,
    industry: (a.industry as Industry | null) ?? null,
    companyType: (a.companyType as CompanyType | null) ?? null,
    status: a.status as ApplicationStatus,
    appliedAt: a.appliedAt ? a.appliedAt.toISOString() : null,
    lastEventAt: a.lastEventAt ? a.lastEventAt.toISOString() : null,
    location: a.location,
    notes: a.notes,
    source: a.source,
    events: eventsByApp.get(a.id) ?? [],
  }));
}

export interface SyncStateDTO {
  status: string;
  lastError: string | null;
  lastResultCount: number | null;
  lastSyncedAt: string | null;
}

export async function getSyncStateForUser(
  userId: string,
): Promise<SyncStateDTO | null> {
  const [row] = await db
    .select()
    .from(syncState)
    .where(eq(syncState.userId, userId))
    .limit(1);
  if (!row) return null;
  return {
    status: row.status,
    lastError: row.lastError,
    lastResultCount: row.lastResultCount,
    lastSyncedAt: row.lastSyncedAt ? row.lastSyncedAt.toISOString() : null,
  };
}
