import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getAllowedUser } from "@/lib/auth";
import { db } from "@/db";
import { alertSubscribers } from "@/db/schema";
import { ALERT_SCOPES } from "@/lib/alerts";

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
  const patch: Record<string, unknown> = {};

  if (
    typeof body.scope === "string" &&
    (ALERT_SCOPES as readonly string[]).includes(body.scope)
  ) {
    patch.scope = body.scope;
  }
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (typeof body.label === "string" && body.label.trim()) {
    patch.label = body.label.trim();
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const [updated] = await db
    .update(alertSubscribers)
    .set(patch)
    .where(
      and(eq(alertSubscribers.id, id), eq(alertSubscribers.userId, user.id)),
    )
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ subscriber: updated });
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
    .delete(alertSubscribers)
    .where(
      and(eq(alertSubscribers.id, id), eq(alertSubscribers.userId, user.id)),
    );
  return NextResponse.json({ ok: true });
}
