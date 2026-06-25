import { NextResponse } from "next/server";
import { runSync } from "@/lib/sync";
import { getUserIdByEmail } from "@/lib/queries";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Invoked by Vercel Cron (see vercel.json). Vercel sends the CRON_SECRET as a
// Bearer token automatically when the env var is set.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization");
  if (!secret || header !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const email = process.env.ALLOWED_EMAIL;
  if (!email) {
    return NextResponse.json({ error: "ALLOWED_EMAIL not set" }, { status: 500 });
  }

  const userId = await getUserIdByEmail(email);
  if (!userId) {
    return NextResponse.json(
      { error: "No user found. Sign in to the app at least once first." },
      { status: 404 },
    );
  }

  try {
    const result = await runSync(userId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 },
    );
  }
}
