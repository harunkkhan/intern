import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Next.js 16 "proxy" convention (formerly middleware). Refreshes the Supabase
// session cookie and gates page navigations.
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Run on all paths except static assets, image files, and the Discord
    // interactions endpoint — that one verifies its own signature and has three
    // seconds to answer, which a Supabase round-trip it can't use eats into.
    "/((?!_next/static|_next/image|favicon.ico|api/discord/interactions|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
