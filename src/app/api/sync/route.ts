import { NextResponse } from "next/server";
import { getAllowedUser } from "@/lib/auth";
import { runSync } from "@/lib/sync";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST() {
  const user = await getAllowedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runSync(user.id);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 },
    );
  }
}
