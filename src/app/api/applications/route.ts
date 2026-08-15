import { NextResponse } from "next/server";
import { getAllowedUser } from "@/lib/auth";
import { db } from "@/db";
import { applications as applicationsTable } from "@/db/schema";
import { dedupeKeyFor, isUniqueViolation } from "@/lib/applications";
import {
  APPLICATION_STATUSES,
  COMPANY_TYPES,
  INDUSTRIES,
  TERMS,
} from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await getAllowedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as Record<string, unknown>;
  const company = typeof body.company === "string" ? body.company.trim() : "";
  const position = typeof body.position === "string" ? body.position.trim() : "";
  if (!company || !position) {
    return NextResponse.json(
      { error: "Company and position are required." },
      { status: 400 },
    );
  }

  const term =
    typeof body.term === "string" &&
    (TERMS as readonly string[]).includes(body.term)
      ? body.term
      : null;

  const values: typeof applicationsTable.$inferInsert = {
    userId: user.id,
    company,
    position,
    dedupeKey: dedupeKeyFor(company, position, term),
    term,
    status: "applied",
    source: "manual",
    lastEventAt: new Date(),
  };

  if (
    typeof body.status === "string" &&
    (APPLICATION_STATUSES as readonly string[]).includes(body.status)
  ) {
    values.status = body.status;
  }
  if (
    typeof body.industry === "string" &&
    (INDUSTRIES as readonly string[]).includes(body.industry)
  ) {
    values.industry = body.industry;
  }
  if (
    typeof body.companyType === "string" &&
    (COMPANY_TYPES as readonly string[]).includes(body.companyType)
  ) {
    values.companyType = body.companyType;
  }
  if (typeof body.notes === "string" && body.notes.trim()) {
    values.notes = body.notes.trim();
  }
  if (typeof body.appliedAt === "string" && body.appliedAt) {
    const d = new Date(body.appliedAt);
    if (!Number.isNaN(d.getTime())) values.appliedAt = d;
  }

  try {
    const [created] = await db
      .insert(applicationsTable)
      .values(values)
      .returning();
    return NextResponse.json({ application: created }, { status: 201 });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json(
        {
          error:
            "An entry for this company, role, and term already exists.",
        },
        { status: 409 },
      );
    }
    throw err;
  }
}
