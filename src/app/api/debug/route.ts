import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getGoogleAuthForUser } from "@/lib/google";
import {
  defaultGmailQuery,
  fetchEmail,
  fetchHeaders,
  getTrackAfterDate,
  listCandidateMessages,
  recentAllQuery,
} from "@/lib/gmail";
import { analyzeRules, classifyEmail } from "@/lib/classify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Diagnostic view of the sync pipeline. Visit /api/debug while signed in.
// Add ?classify=1 to also run Gemini on the keyword-matched emails (slower).
export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const runClassify = new URL(req.url).searchParams.get("classify") === "1";
  const trackAfter = getTrackAfterDate();

  try {
    const auth = await getGoogleAuthForUser(user.id);
    const query = defaultGmailQuery();

    // Stage 1: keyword-matched candidates (what sync actually processes).
    const matchedIds = await listCandidateMessages(auth, query, 25);
    const matched = [];
    for (const m of matchedIds) {
      const email = await fetchEmail(auth, m.id);
      const rule = analyzeRules(email);
      const row: Record<string, unknown> = {
        subject: email.subject,
        from: email.from,
        date: email.date.toISOString(),
        afterCutoff: email.date >= trackAfter,
        ruleLikelyRelated: rule.likelyRelated,
        ruleStatus: rule.status,
      };
      if (runClassify && email.date >= trackAfter) {
        row.gemini = await classifyEmail(email);
      }
      matched.push(row);
    }

    // Stage 0: every recent email (no keyword filter) — to confirm an email
    // exists at all and see its real subject/sender.
    const recentIds = await listCandidateMessages(auth, recentAllQuery(), 40);
    const matchedSet = new Set(matchedIds.map((m) => m.id));
    const recent = [];
    for (const m of recentIds.slice(0, 40)) {
      const h = await fetchHeaders(auth, m.id);
      recent.push({
        subject: h.subject,
        from: h.from,
        date: h.date.toISOString(),
        keywordMatched: matchedSet.has(m.id),
      });
    }

    return NextResponse.json({
      trackAfter: trackAfter.toISOString(),
      query,
      matchedCount: matchedIds.length,
      matched,
      recentCount: recentIds.length,
      recent,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
