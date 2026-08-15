import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getAllowedUser } from "@/lib/auth";
import { db } from "@/db";
import { behavioralQuestions, behavioralSections } from "@/db/schema";
import { isUniqueViolation } from "@/lib/applications";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await getAllowedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as Record<string, unknown>;
  const sectionId =
    typeof body.sectionId === "string" ? body.sectionId : "";
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!sectionId || !prompt) {
    return NextResponse.json(
      { error: "Pick a section and write the question." },
      { status: 400 },
    );
  }

  // The section is looked up under this user's id, so a question can never be
  // filed under someone else's section by posting its id.
  const [section] = await db
    .select({ id: behavioralSections.id })
    .from(behavioralSections)
    .where(
      and(
        eq(behavioralSections.id, sectionId),
        eq(behavioralSections.userId, user.id),
      ),
    )
    .limit(1);

  if (!section) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const [created] = await db
      .insert(behavioralQuestions)
      .values({ userId: user.id, sectionId, prompt })
      .returning();
    return NextResponse.json({ question: created }, { status: 201 });
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
