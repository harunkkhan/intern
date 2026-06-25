"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow, parseISO } from "date-fns";
import type { ApplicationDTO } from "@/lib/types";
import type { SyncStateDTO } from "@/lib/queries";
import { doSignOut } from "@/app/actions";
import SearchBar from "@/components/SearchBar";
import Filters from "@/components/Filters";
import SyncButton from "@/components/SyncButton";
import ApplicationsTable from "@/components/ApplicationsTable";
import DetailsPanel, { type DetailsPatch } from "@/components/DetailsPanel";

export default function Dashboard({
  applications,
  sync,
  userEmail,
}: {
  applications: ApplicationDTO[];
  sync: SyncStateDTO | null;
  userEmail: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [positionType, setPositionType] = useState("all");
  const [industry, setIndustry] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const types = useMemo(
    () =>
      Array.from(
        new Set(
          applications.map((a) => a.positionType).filter(Boolean) as string[],
        ),
      ).sort(),
    [applications],
  );
  const industries = useMemo(
    () =>
      Array.from(
        new Set(
          applications.map((a) => a.industry).filter(Boolean) as string[],
        ),
      ).sort(),
    [applications],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return applications.filter((a) => {
      if (status !== "all" && a.status !== status) return false;
      if (positionType !== "all" && a.positionType !== positionType)
        return false;
      if (industry !== "all" && a.industry !== industry) return false;
      if (
        q &&
        !a.company.toLowerCase().includes(q) &&
        !a.position.toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [applications, status, positionType, industry, query]);

  const selected = applications.find((a) => a.id === selectedId) ?? null;

  async function handleSync() {
    setSyncing(true);
    setMessage(null);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sync failed");
      const parts = [`${data.created} new`, `${data.updated} updated`];
      if (data.remaining > 0)
        parts.push(`${data.remaining} more queued — sync again`);
      setMessage(parts.join(" · "));
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function handleSave(patch: DetailsPatch) {
    if (!selected) return;
    setSaving(true);
    try {
      await fetch(`/api/applications/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selected) return;
    const id = selected.id;
    setSelectedId(null);
    await fetch(`/api/applications/${id}`, { method: "DELETE" });
    router.refresh();
  }

  function resetFilters() {
    setStatus("all");
    setPositionType("all");
    setIndustry("all");
  }

  const lastSynced =
    sync?.lastSyncedAt &&
    `Synced ${formatDistanceToNow(parseISO(sync.lastSyncedAt), {
      addSuffix: true,
    })}`;

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
              Internship Tracker
            </h1>
            <p className="mt-1 text-sm text-neutral-500">
              {applications.length} application
              {applications.length === 1 ? "" : "s"}
              {userEmail ? ` · ${userEmail}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <SyncButton syncing={syncing} onClick={handleSync} />
            <form action={doSignOut}>
              <button
                type="submit"
                className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100"
              >
                Sign out
              </button>
            </form>
          </div>
        </header>

        {(message || lastSynced || sync?.status === "error") && (
          <p className="mt-3 text-xs text-neutral-500">
            {message ?? (sync?.status === "error" ? sync.lastError : lastSynced)}
          </p>
        )}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <SearchBar value={query} onChange={setQuery} />
          <Filters
            status={status}
            positionType={positionType}
            industry={industry}
            types={types}
            industries={industries}
            onStatus={setStatus}
            onType={setPositionType}
            onIndustry={setIndustry}
            onReset={resetFilters}
          />
        </div>

        <div className="mt-4">
          {applications.length === 0 ? (
            <EmptyState onSync={handleSync} syncing={syncing} />
          ) : (
            <ApplicationsTable
              applications={filtered}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          )}
        </div>
      </div>

      <DetailsPanel
        app={selected}
        saving={saving}
        onClose={() => setSelectedId(null)}
        onSave={handleSave}
        onDelete={handleDelete}
      />
    </div>
  );
}

function EmptyState({
  onSync,
  syncing,
}: {
  onSync: () => void;
  syncing: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-white px-6 py-16 text-center">
      <h2 className="text-base font-medium text-neutral-800">
        No applications yet
      </h2>
      <p className="mt-1 max-w-sm text-sm text-neutral-500">
        Sync your inbox to scan for application confirmations, assessments,
        interview invites, offers, and rejections.
      </p>
      <button
        onClick={onSync}
        disabled={syncing}
        className="mt-5 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-60"
      >
        {syncing ? "Syncing…" : "Sync inbox now"}
      </button>
    </div>
  );
}
