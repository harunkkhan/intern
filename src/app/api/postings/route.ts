import { NextResponse } from "next/server";
import { getAllowedUser } from "@/lib/auth";
import { getPostingsData } from "@/lib/alerts";

export const dynamic = "force-dynamic";

/** Pages and searches the postings list for the Postings tab. */
export async function GET(req: Request) {
  const user = await getAllowedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const rawPage = Number(searchParams.get("page") ?? "0");
  const page = Number.isFinite(rawPage) ? Math.max(0, Math.floor(rawPage)) : 0;
  const query = searchParams.get("q") ?? "";
  // getPostingsData clamps this to the offered sizes, so an arbitrary value in
  // the query string can't ask for every row at once.
  const pageSize = Number(searchParams.get("pageSize") ?? "");

  return NextResponse.json(await getPostingsData({ page, query, pageSize }));
}
