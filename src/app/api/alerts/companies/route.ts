import { NextResponse } from "next/server";
import { getAllowedUser } from "@/lib/auth";
import { db } from "@/db";
import { jobSources, watchedCompanies } from "@/db/schema";
import { detectSource } from "@/lib/alerts";
import { normalizeCompany } from "@/lib/company";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await getAllowedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const careersUrl =
    typeof body.careersUrl === "string" ? body.careersUrl.trim() : "";

  if (!name) {
    return NextResponse.json(
      { error: "A company name is required" },
      { status: 400 },
    );
  }
  const normalizedName = normalizeCompany(name);
  if (!normalizedName) {
    return NextResponse.json(
      { error: "That name normalizes to nothing — try the full company name." },
      { status: 400 },
    );
  }

  // A careers URL is optional. Without one the entry still works: watchlist
  // matching is by company name against every source, so the GitHub feeds cover
  // it immediately. A recognized URL just adds direct polling of the company's
  // own board, which surfaces roles the community feeds haven't picked up.
  let sourceId: string | null = null;
  let detectedAdapter: string | null = null;
  if (careersUrl) {
    const detected = detectSource(careersUrl);
    if (!detected) {
      return NextResponse.json(
        {
          error:
            "Couldn't recognize that board. Supported: Greenhouse, Lever, Ashby, Workday, SmartRecruiters. Leave the URL blank to match by name only.",
        },
        { status: 400 },
      );
    }
    detectedAdapter = detected.adapter;
    const [source] = await db
      .insert(jobSources)
      .values({
        label: name,
        adapter: detected.adapter,
        config: detected.config,
        // ATS boards list every role a company has open, so titles must name an
        // internship or co-op to qualify.
        trustedInternOnly: false,
      })
      .onConflictDoUpdate({
        target: [jobSources.label, jobSources.adapter],
        set: { config: detected.config, enabled: true },
      })
      .returning({ id: jobSources.id });
    sourceId = source?.id ?? null;
  }

  const [created] = await db
    .insert(watchedCompanies)
    .values({ userId: user.id, name, normalizedName, sourceId })
    .onConflictDoUpdate({
      target: [watchedCompanies.userId, watchedCompanies.normalizedName],
      set: { name, sourceId, enabled: true },
    })
    .returning();

  return NextResponse.json({ company: created, adapter: detectedAdapter });
}
