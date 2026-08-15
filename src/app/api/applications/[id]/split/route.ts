import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { getAllowedUser } from "@/lib/auth";
import { db } from "@/db";
import { applicationEvents, applications } from "@/db/schema";
import {
  dedupeKeyFor,
  isUniqueViolation,
  rollupEvents,
} from "@/lib/applications";
import { TERMS } from "@/lib/types";

export const dynamic = "force-dynamic";

// Peel part of an entry off into its own application. One entry can end up
// covering several real applications — the same role reopened for a later cycle,
// or two different roles at one company whose titles normalize to the same thing
// — and this is how they get pulled apart: the named events move to a new row,
// which carries its own role title and term, and whatever is left behind is
// recomputed from the events that stayed.
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

  const position = typeof body.position === "string" ? body.position.trim() : "";
  if (!position) {
    return NextResponse.json(
      { error: "The new entry needs a role title." },
      { status: 400 },
    );
  }

  const rawTerm = body.term ?? null;
  if (
    rawTerm !== null &&
    !(typeof rawTerm === "string" && (TERMS as readonly string[]).includes(rawTerm))
  ) {
    return NextResponse.json({ error: "Unknown term." }, { status: 400 });
  }
  const term = rawTerm as string | null;

  const eventIds = Array.isArray(body.eventIds)
    ? body.eventIds.filter((v): v is string => typeof v === "string")
    : [];

  const keepPosition =
    typeof body.keepPosition === "string" ? body.keepPosition.trim() : null;
  if (typeof body.keepPosition === "string" && !keepPosition) {
    return NextResponse.json(
      { error: "The remaining entry needs a role title." },
      { status: 400 },
    );
  }

  const [existing] = await db
    .select()
    .from(applications)
    .where(and(eq(applications.id, id), eq(applications.userId, user.id)))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const events = await db
    .select()
    .from(applicationEvents)
    .where(eq(applicationEvents.applicationId, id));

  const moving = events.filter((e) => eventIds.includes(e.id));
  if (moving.length !== eventIds.length) {
    return NextResponse.json(
      { error: "Those events aren't on this entry." },
      { status: 400 },
    );
  }
  // Emptying the timeline leaves a row whose status can never be derived again.
  // Renaming the entry or changing its term does that job.
  if (moving.length > 0 && moving.length === events.length) {
    return NextResponse.json(
      { error: "That moves the whole timeline — edit this entry instead." },
      { status: 400 },
    );
  }

  const moved = rollupEvents(moving);

  try {
    const created = await db.transaction(async (tx) => {
      // A split with no events — one half of a joined title like "TPM + SWE" —
      // has nothing to derive from, so the new row starts as a copy of where it
      // came from.
      const [row] = await tx
        .insert(applications)
        .values({
          userId: user.id,
          company: existing.company,
          position,
          dedupeKey: dedupeKeyFor(existing.company, position, term),
          term,
          industry: existing.industry,
          companyType: existing.companyType,
          location: existing.location,
          source: existing.source,
          status: moved?.status ?? existing.status,
          // Carried only on a pure copy — one half of a joined title is the same
          // application, so the assessment you sat is still sat. A split that
          // takes events with it is a different application (another cycle, a
          // different role), and its assessment is its own to record.
          oaCompleted: moving.length === 0 ? existing.oaCompleted : false,
          interviewPending:
            moving.length === 0 ? existing.interviewPending : false,
          appliedAt: moved?.appliedAt ?? existing.appliedAt,
          lastEventAt: moved?.lastEventAt ?? existing.lastEventAt,
        })
        .returning();

      const patch: Record<string, unknown> = { updatedAt: new Date() };

      if (moving.length > 0) {
        await tx
          .update(applicationEvents)
          .set({ applicationId: row.id })
          .where(
            inArray(
              applicationEvents.id,
              moving.map((e) => e.id),
            ),
          );

        const remaining = rollupEvents(
          events.filter((e) => !eventIds.includes(e.id)),
        );
        if (remaining) {
          patch.status = remaining.status;
          patch.appliedAt = remaining.appliedAt;
          patch.lastEventAt = remaining.lastEventAt;
        }
      }

      if (keepPosition && keepPosition !== existing.position) {
        patch.position = keepPosition;
        patch.dedupeKey = dedupeKeyFor(
          existing.company,
          keepPosition,
          existing.term,
        );
      }

      await tx
        .update(applications)
        .set(patch)
        .where(eq(applications.id, existing.id));

      return row;
    });

    return NextResponse.json({ application: created }, { status: 201 });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json(
        { error: "An entry for that role and term already exists." },
        { status: 409 },
      );
    }
    throw err;
  }
}
