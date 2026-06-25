import "server-only";
import { google } from "googleapis";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { googleTokens } from "@/db/schema";

// Typed off googleapis itself so it stays assignable to google.gmail({ auth })
// (avoids a clash with the duplicate google-auth-library under googleapis-common).
export type GoogleAuthClient = InstanceType<typeof google.auth.OAuth2>;

// Build an OAuth2 client for a user from the Google refresh token captured at
// sign-in. google-auth-library transparently mints/refreshes access tokens, so
// this works both inside a user session and from the unauthenticated cron.
export async function getGoogleAuthForUser(
  userId: string,
): Promise<GoogleAuthClient> {
  const [row] = await db
    .select()
    .from(googleTokens)
    .where(eq(googleTokens.userId, userId))
    .limit(1);

  if (!row?.refreshToken) {
    throw new Error(
      "No Google refresh token stored for this user. Sign out and sign in again to grant access.",
    );
  }

  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  client.setCredentials({ refresh_token: row.refreshToken });
  return client;
}
