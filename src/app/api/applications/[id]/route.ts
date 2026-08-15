import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getAllowedUser } from "@/lib/auth";
import { db } from "@/db";
import { applications } from "@/db/schema";
import { dedupeKeyFor, isUniqueViolation } from "@/lib/applications";
import {
  APPLICATION_STATUSES,
  COMPANY_TYPES,
  INDUSTRIES,
  TERMS,
} from "@/lib/types";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getAllowedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const body = (await req.json()) as Record<string, unknown>;

  const [existing] = await db
    .select()
    .from(applications)
    .where(and(eq(applications.id, id), eq(applications.userId, user.id)))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };

  if (typeof body.notes === "string") patch.notes = body.notes;
  if (typeof body.location === "string") patch.location = body.location;
  if (typeof body.oaCompleted === "boolean") patch.oaCompleted = body.oaCompleted;
  if (typeof body.interviewPending === "boolean") {
    patch.interviewPending = body.interviewPending;
  }
  if (
    typeof body.status === "string" &&
    (APPLICATION_STATUSES as readonly string[]).includes(body.status)
  ) {
    patch.status = body.status;
    // Waiting on an interview decision is only meaningful while the application
    // is at the interview stage. Moving it anywhere else by hand answers the
    // wait the same way an email would.
    if (body.status !== "interview") patch.interviewPending = false;
  }

  // "" clears the term. Both a change and a clear move the dedupe key, since the
  // key encodes the term.
  let term = existing.term;
  if (
    typeof body.term === "string" &&
    (body.term === "" || (TERMS as readonly string[]).includes(body.term))
  ) {
    term = body.term || null;
    patch.term = term;
  }

  if (
    typeof body.industry === "string" &&
    (INDUSTRIES as readonly string[]).includes(body.industry)
  ) {
    patch.industry = body.industry;
  }
  if (
    typeof body.companyType === "string" &&
    (COMPANY_TYPES as readonly string[]).includes(body.companyType)
  ) {
    patch.companyType = body.companyType;
  }

  let company = existing.company;
  let position = existing.position;
  if (typeof body.company === "string" && body.company.trim()) {
    company = body.company.trim();
    patch.company = company;
  }
  if (typeof body.position === "string" && body.position.trim()) {
    position = body.position.trim();
    patch.position = position;
  }
  if (patch.company || patch.position || "term" in patch) {
    patch.dedupeKey = dedupeKeyFor(company, position, term);
  }

  try {
    const [updated] = await db
      .update(applications)
      .set(patch)
      .where(and(eq(applications.id, id), eq(applications.userId, user.id)))
      .returning();

    return NextResponse.json({ application: updated });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json(
        {
          error:
            "Another entry already covers this company, role, and term.",
        },
        { status: 409 },
      );
    }
    throw err;
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getAllowedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  await db
    .delete(applications)
    .where(and(eq(applications.id, id), eq(applications.userId, user.id)));
  return NextResponse.json({ ok: true });
}
