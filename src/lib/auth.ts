import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/queries";

export interface AllowedUser {
  id: string;
  email: string;
}

// Resolves the signed-in user and re-checks the allowlist on every request.
// Checking here (rather than only at sign-in) means deleting someone's
// allowed_email row cuts off their access immediately, instead of leaving them
// with a working session until the cookie expires.
//
// Returns null for "not signed in" and "no longer allowed" alike — callers treat
// both as unauthorized.
export async function getAllowedUser(): Promise<AllowedUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) return null;
  if (!(await isEmailAllowed(user.email))) return null;

  return { id: user.id, email: user.email };
}
