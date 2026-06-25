import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { googleTokens } from "@/db/schema";

export const dynamic = "force-dynamic";

// Supabase redirects here after Google sign-in. We exchange the code for a
// session, enforce the single allowed user, and persist the Google
// provider_refresh_token (only available right after this exchange) so the cron
// can call Gmail offline later.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session || !data.user?.email) {
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }

  const allowed = process.env.ALLOWED_EMAIL?.toLowerCase();
  if (!allowed || data.user.email.toLowerCase() !== allowed) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=not_allowed`);
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
}
