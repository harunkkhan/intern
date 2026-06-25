import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Supabase client for server components, route handlers, and server actions.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              // Drop maxAge/expires so auth cookies are session cookies —
              // cleared when the browser closes, forcing a re-sign-in.
              cookieStore.set(name, value, {
                ...options,
                maxAge: undefined,
                expires: undefined,
              }),
            );
          } catch {
            // Called from a Server Component — safe to ignore because the
            // middleware refreshes the session cookie on every request.
          }
        },
      },
    },
  );
}
