import { NextResponse } from "next/server";
import { getAllowedUser } from "@/lib/auth";
import { db } from "@/db";
import { behavioralSections } from "@/db/schema";
import { isUniqueViolation } from "@/lib/applications";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await getAllowedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json(
      { error: "Give the section a name." },
      { status: 400 },
    );
  }

  try {
    const [created] = await db
      .insert(behavioralSections)
      .values({ userId: user.id, name })
      .returning();
    return NextResponse.json({ section: created }, { status: 201 });
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
