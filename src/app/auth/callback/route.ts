import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { googleTokens } from "@/db/schema";
import { isEmailAllowed } from "@/lib/queries";

export const dynamic = "force-dynamic";

// Supabase redirects here after Google sign-in. We exchange the code for a
// session, enforce the allowlist, and persist the Google provider_refresh_token
// (only available right after this exchange) so the cron can call Gmail offline
// later.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  const fail = (error: string, detail?: string) =>
    NextResponse.redirect(
      `${origin}/login?error=${error}` +
        (detail ? `&detail=${encodeURIComponent(detail.slice(0, 300))}` : ""),
    );

  if (!code) return fail("missing_code");

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (error || !data.session || !data.user?.email) {
      return fail("auth", error?.message);
    }

    if (!(await isEmailAllowed(data.user.email))) {
      await supabase.auth.signOut();
      return fail("not_allowed", data.user.email);
    }

    const refreshToken = data.session.provider_refresh_token;
    if (refreshToken) {
      await db
        .insert(googleTokens)
        .values({
          userId: data.user.id,
          email: data.user.email,
          refreshToken,
        })
        .onConflictDoUpdate({
          target: googleTokens.userId,
          set: { refreshToken, email: data.user.email, updatedAt: new Date() },
        });
    }

    // Honor the proxy host on Vercel so the final redirect points at the real URL.
    const forwardedHost = request.headers.get("x-forwarded-host");
    const isLocal = process.env.NODE_ENV === "development";
    const base = isLocal || !forwardedHost ? origin : `https://${forwardedHost}`;
    return NextResponse.redirect(`${base}/`);
  } catch (err) {
    // Surfaces DB / connection / unexpected errors to the login page instead of
    // a blank 500, so the failure is visible in the browser.
    return fail("server", err instanceof Error ? err.message : String(err));
  }
}
