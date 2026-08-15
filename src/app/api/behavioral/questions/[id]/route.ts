import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getAllowedUser } from "@/lib/auth";
import { db } from "@/db";
import { behavioralQuestions } from "@/db/schema";
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

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  // An answer may be emptied; a prompt may not, since it is the question.
  if (typeof body.answer === "string") patch.answer = body.answer;
  if (typeof body.prompt === "string" && body.prompt.trim()) {
    patch.prompt = body.prompt.trim();
  }

  try {
    const [updated] = await db
      .update(behavioralQuestions)
      .set(patch)
      .where(
        and(
          eq(behavioralQuestions.id, id),
          eq(behavioralQuestions.userId, user.id),
        ),
      )
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ question: updated });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json(
        { error: "That question is already in this section." },
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
    .delete(behavioralQuestions)
    .where(
      and(
        eq(behavioralQuestions.id, id),
        eq(behavioralQuestions.userId, user.id),
      ),
    );
  return NextResponse.json({ ok: true });
}
