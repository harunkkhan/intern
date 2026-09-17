import { NextResponse } from "next/server";
import { dispatchPollWorkflow } from "@/lib/pollWorkflow";

export const dynamic = "force-dynamic";

// Invoked by Vercel Cron (see vercel.json) to start the weekday poll loop in
// GitHub Actions, whose own schedule starts it hours late.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization");
  if (!secret || header !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const run = await dispatchPollWorkflow({ loop: "true" });
    return NextResponse.json(run);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Dispatch failed" },
      { status: 500 },
    );
  }
}
