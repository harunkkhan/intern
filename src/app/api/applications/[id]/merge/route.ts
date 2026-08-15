import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { getAllowedUser } from "@/lib/auth";
import { db } from "@/db";
import { applicationEvents, applications } from "@/db/schema";
import { rollupEvents } from "@/lib/applications";

export const dynamic = "force-dynamic";

// The inverse of a split: fold `sourceId` into this entry. The source's events
// are re-parented rather than copied — application_event.gmail_message_id is
// globally unique, so an email exists on exactly one entry and moving it is the
// only way to combine two timelines — and the source row is then dropped.
// This entry's own company, role, term, and classification win; only dates,
// status, and notes are recomputed from the combined history.
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getAllowedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const body = (await req.json()) as Record<string, unknown>;
  const sourceId = typeof body.sourceId === "string" ? body.sourceId : "";

  if (!sourceId) {
    return NextResponse.json(
      { error: "No entry to merge was given." },
      { status: 400 },
    );
  }
  if (sourceId === id) {
    return NextResponse.json(
      { error: "An entry can't be merged into itself." },
      { status: 400 },
    );
  }

  const pair = await db
    .select()
    .from(applications)
    .where(
      and(
        eq(applications.userId, user.id),
        inArray(applications.id, [id, sourceId]),
      ),
    );

  const target = pair.find((a) => a.id === id);
  const source = pair.find((a) => a.id === sourceId);
  if (!target || !source) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const combined = await db
    .select()
    .from(applicationEvents)
    .where(inArray(applicationEvents.applicationId, [target.id, source.id]));
  const rollup = rollupEvents(combined);

  await db.transaction(async (tx) => {
    await tx
      .update(applicationEvents)
      .set({ applicationId: target.id })
      .where(eq(applicationEvents.applicationId, source.id));

    // A manually added entry can carry an applied date without any events at
    // all, so the earliest date across both rows beats the earliest event.
    const appliedAt = earliest([
      rollup?.appliedAt,
      target.appliedAt,
      source.appliedAt,
    ]);
    const lastEventAt = latest([
      rollup?.lastEventAt,
      target.lastEventAt,
      source.lastEventAt,
    ]);

    await tx
      .update(applications)
      .set({
        status: rollup?.status ?? target.status,
        appliedAt,
        lastEventAt,
        notes: joinNotes(target.notes, source.notes),
        updatedAt: new Date(),
      })
      .where(eq(applications.id, target.id));

    await tx
      .delete(applications)
      .where(
        and(
          eq(applications.id, source.id),
          eq(applications.userId, user.id),
        ),
      );
  });

  return NextResponse.json({ ok: true, mergedId: source.id });
}

function earliest(dates: (Date | null | undefined)[]): Date | null {
  const known = dates.filter((d): d is Date => !!d);
  if (known.length === 0) return null;
  return known.reduce((a, b) => (a < b ? a : b));
}

function latest(dates: (Date | null | undefined)[]): Date | null {
  const known = dates.filter((d): d is Date => !!d);
  if (known.length === 0) return null;
  return known.reduce((a, b) => (a > b ? a : b));
}

function joinNotes(target: string | null, source: string | null): string | null {
  const parts = [target, source]
    .map((n) => n?.trim())
    .filter((n): n is string => !!n);
  return parts.length ? [...new Set(parts)].join("\n\n") : null;
}
