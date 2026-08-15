import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getApplicationsForUser,
  getSyncStateForUser,
  isEmailAllowed,
} from "@/lib/queries";
import { getAlertsData, getPostingsData } from "@/lib/alerts";
import { getBehavioralData } from "@/lib/behavioral";
import Dashboard from "@/components/Dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Signed out and "removed from the allowlist" are separate cases here so the
  // login page can explain which one happened.
  if (!user) redirect("/login");
  if (!user.email || !(await isEmailAllowed(user.email))) {
    redirect("/login?error=not_allowed");
  }

  const [applications, sync, alerts, postings, behavioral] = await Promise.all([
    getApplicationsForUser(user.id),
    getSyncStateForUser(user.id),
    getAlertsData(user.id),
    getPostingsData(),
    getBehavioralData(user.id),
  ]);

  return (
    <Dashboard
      applications={applications}
      sync={sync}
      alerts={alerts}
      postings={postings}
      behavioral={behavioral}
    />
  );
}
