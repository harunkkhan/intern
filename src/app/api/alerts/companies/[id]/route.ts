import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getAllowedUser } from "@/lib/auth";
import { db } from "@/db";
import { watchedCompanies } from "@/db/schema";

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
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const [updated] = await db
    .update(watchedCompanies)
    .set({ enabled: body.enabled })
    .where(
      and(eq(watchedCompanies.id, id), eq(watchedCompanies.userId, user.id)),
    )
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ company: updated });
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
  // The job_source stays: another user may watch the same company, and its
  // listing history is worth keeping either way.
  await db
    .delete(watchedCompanies)
    .where(
      and(eq(watchedCompanies.id, id), eq(watchedCompanies.userId, user.id)),
    );
  return NextResponse.json({ ok: true });
}
