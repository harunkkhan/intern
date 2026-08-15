import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getAllowedUser } from "@/lib/auth";
import { db } from "@/db";
import { behavioralSections } from "@/db/schema";
import { isUniqueViolation } from "@/lib/applications";

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
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json(
      { error: "Give the section a name." },
      { status: 400 },
    );
  }

  try {
    const [updated] = await db
      .update(behavioralSections)
      .set({ name, updatedAt: new Date() })
      .where(
        and(
          eq(behavioralSections.id, id),
          eq(behavioralSections.userId, user.id),
        ),
      )
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ section: updated });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json(
        { error: "You already have a section with that name." },
        { status: 409 },
      );
    }
    throw err;
  }
}

// Questions are removed with the section by the foreign key's ON DELETE CASCADE.
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
    .delete(behavioralSections)
    .where(
      and(eq(behavioralSections.id, id), eq(behavioralSections.userId, user.id)),
    );
  return NextResponse.json({ ok: true });
}
