import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getApplicationsForUser, getSyncStateForUser } from "@/lib/queries";
import Dashboard from "@/components/Dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const allowed = process.env.ALLOWED_EMAIL?.toLowerCase();
  if (allowed && user.email?.toLowerCase() !== allowed) {
    redirect("/login?error=not_allowed");
  }

  const [applications, sync] = await Promise.all([
    getApplicationsForUser(user.id),
    getSyncStateForUser(user.id),
  ]);

  return (
    <Dashboard
      applications={applications}
      sync={sync}
      userEmail={user.email ?? ""}
    />
  );
}
