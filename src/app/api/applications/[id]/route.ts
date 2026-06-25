import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { applications } from "@/db/schema";
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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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
  if (
    typeof body.status === "string" &&
    (APPLICATION_STATUSES as readonly string[]).includes(body.status)
  ) {
    patch.status = body.status;
  }
  if (
    typeof body.term === "string" &&
    (TERMS as readonly string[]).includes(body.term)
  ) {
    patch.term = body.term;
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
  if (patch.company || patch.position) {
    patch.dedupeKey = `${company.toLowerCase()}::${position.toLowerCase()}`;
  }

  const [updated] = await db
    .update(applications)
    .set(patch)
    .where(and(eq(applications.id, id), eq(applications.userId, user.id)))
    .returning();

  return NextResponse.json({ application: updated });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  await db
    .delete(applications)
    .where(and(eq(applications.id, id), eq(applications.userId, user.id)));
  return NextResponse.json({ ok: true });
}
