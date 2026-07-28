import { NextResponse } from "next/server";
import { getAllowedUser } from "@/lib/auth";
import { db } from "@/db";
import { alertSubscribers } from "@/db/schema";
import { ALERT_SCOPES, normalizePhone } from "@/lib/alerts";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await getAllowedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as Record<string, unknown>;
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const rawPhone = typeof body.phone === "string" ? body.phone : "";
  const scope =
    typeof body.scope === "string" &&
    (ALERT_SCOPES as readonly string[]).includes(body.scope)
      ? body.scope
      : "watchlist";

  if (!label) {
    return NextResponse.json({ error: "A name is required" }, { status: 400 });
  }
  const phone = normalizePhone(rawPhone);
  if (!phone) {
    return NextResponse.json(
      {
        error:
          "Enter a 10-digit US number, or include a country code (e.g. +44…).",
      },
      { status: 400 },
    );
  }

  const [created] = await db
    .insert(alertSubscribers)
    .values({ userId: user.id, label, phone, scope })
    .onConflictDoNothing({ target: alertSubscribers.phone })
    .returning();

  if (!created) {
    return NextResponse.json(
      { error: "That number is already subscribed." },
      { status: 409 },
    );
  }
  return NextResponse.json({ subscriber: created });
}
