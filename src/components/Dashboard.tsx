"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow, parseISO } from "date-fns";
import { STATUS_RANK, type ApplicationDTO } from "@/lib/types";
import type { SyncStateDTO } from "@/lib/queries";
import SearchBar from "@/components/SearchBar";
import Filters from "@/components/Filters";
import Sidebar, { type View } from "@/components/Sidebar";
import SettingsPanel from "@/components/SettingsPanel";
import ApplicationsTable, {
  type SortKey,
  type SortDir,
} from "@/components/ApplicationsTable";
import AddEntryModal from "@/components/AddEntryModal";
import ApplicationDetail, {
  type DetailsPatch,
} from "@/components/ApplicationDetail";
import { logoFont } from "@/components/Logo";

export default function Dashboard({
  applications,
  sync,
}: {
  applications: ApplicationDTO[];
  sync: SyncStateDTO | null;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [term, setTerm] = useState("all");
  const [industry, setIndustry] = useState("all");
  const [companyType, setCompanyType] = useState("all");
  const [view, setView] = useState<View>("dashboard");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [addOpen, setAddOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const terms = useMemo(
    () =>
      Array.from(
        new Set(applications.map((a) => a.term).filter(Boolean) as string[]),
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
  const companyTypes = useMemo(
    () =>
      Array.from(
        new Set(
          applications.map((a) => a.companyType).filter(Boolean) as string[],
        ),
      ).sort(),
    [applications],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return applications.filter((a) => {
      if (status !== "all" && a.status !== status) return false;
      if (term !== "all" && a.term !== term) return false;
      if (industry !== "all" && a.industry !== industry) return false;
      if (companyType !== "all" && a.companyType !== companyType) return false;
      if (
        q &&
        !a.company.toLowerCase().includes(q) &&
        !a.position.toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [applications, status, term, industry, companyType, query]);

  const sorted = useMemo(() => {
    const ordered = sortKey
      ? sortApplications(filtered, sortKey, sortDir)
      : filtered;
    // Rejections always sink to the bottom, regardless of recency or the active
    // column sort. Array.sort is stable, so order within each group is kept.
    return [...ordered].sort(
      (a, b) =>
        (a.status === "rejected" ? 1 : 0) - (b.status === "rejected" ? 1 : 0),
    );
  }, [filtered, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function clearSort() {
    setSortKey(null);
    setSortDir("asc");
  }

  const selected = applications.find((a) => a.id === selectedId) ?? null;

  async function handleSync() {
    setSyncing(true);
    setMessage(null);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sync failed");
      const parts = [`${data.created} new`, `${data.updated} updated`];
      if (data.failed > 0)
        parts.push(`${data.failed} failed (Gemini busy — sync again)`);
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
    setTerm("all");
    setIndustry("all");
    setCompanyType("all");
  }

  const lastSynced =
    sync?.lastSyncedAt &&
    `Synced ${formatDistanceToNow(parseISO(sync.lastSyncedAt), {
      addSuffix: true,
    })}`;

  const syncStatus =
    message ?? (sync?.status === "error" ? sync.lastError : lastSynced) ?? null;

  const filtersActive =
    status !== "all" ||
    term !== "all" ||
    industry !== "all" ||
    companyType !== "all";

  return (
    <div className="flex min-h-screen flex-col bg-white md:flex-row dark:bg-neutral-950">
      <Sidebar view={view} onNavigate={setView} />
      <div className="min-w-0 flex-1">
        <div className="px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          {view === "settings" ? (
            <>
              <header>
                <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
                  Settings
                </h1>
                <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                  Appearance and inbox sync
                </p>
              </header>
              <SettingsPanel
                syncing={syncing}
                onSync={handleSync}
                syncStatus={syncStatus}
              />
            </>
          ) : selected ? (
            <ApplicationDetail
              app={selected}
              saving={saving}
              onBack={() => setSelectedId(null)}
              onSave={handleSave}
              onDelete={handleDelete}
            />
          ) : (
            <>
              <header className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h1
                    className={`${logoFont.className} text-2xl italic tracking-tight text-neutral-900 dark:text-neutral-100`}
                  >
                    Harun's Internship Tracker
                  </h1>
                  <span className="text-neutral-400 dark:text-neutral-500">
                    •
                  </span>
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    {applications.length} application
                    {applications.length === 1 ? "" : "s"}
                  </p>
                </div>
              </header>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <SearchBar value={query} onChange={setQuery} />
                <div className="flex flex-wrap items-center gap-2">
                  <Filters
                    status={status}
                    term={term}
                    industry={industry}
                    companyType={companyType}
                    terms={terms}
                    industries={industries}
                    companyTypes={companyTypes}
                    onStatus={setStatus}
                    onTerm={setTerm}
                    onIndustry={setIndustry}
                    onCompanyType={setCompanyType}
                  />
                  {filtersActive ? (
                    <button
                      onClick={resetFilters}
                      title="Clear filters"
                      aria-label="Clear filters"
                      className="inline-flex items-center justify-center rounded-none bg-neutral-900 px-2.5 py-2 text-white transition hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M13.013 3H2l8 9.46V19l4 2v-8.54l.9-1.055" />
                        <path d="m22 3-5 5" />
                        <path d="m17 3 5 5" />
                      </svg>
                    </button>
                  ) : (
                    <button
                      onClick={() => setAddOpen(true)}
                      className="inline-flex items-center gap-1.5 rounded-none bg-neutral-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                      Add entry
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-4">
                {applications.length === 0 ? (
                  <EmptyState onSync={handleSync} syncing={syncing} />
                ) : (
                  <ApplicationsTable
                    applications={sorted}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                    onClearSort={clearSort}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <AddEntryModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={() => {
          setAddOpen(false);
          router.refresh();
        }}
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
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-white px-6 py-16 text-center dark:border-neutral-700 dark:bg-neutral-900">
      <h2 className="text-base font-medium text-neutral-800 dark:text-neutral-200">
        No applications yet
      </h2>
      <p className="mt-1 max-w-sm text-sm text-neutral-500 dark:text-neutral-400">
        Sync your inbox to scan for application confirmations, assessments,
        interview invites, offers, and rejections.
      </p>
      <button
        onClick={onSync}
        disabled={syncing}
        className="mt-5 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
      >
        {syncing ? "Syncing…" : "Sync inbox now"}
      </button>
    </div>
  );
}

// String/categorical columns sort alphabetically, Applied by date, Status by
// funnel rank. Empty values always sort to the bottom regardless of direction.
function sortValue(app: ApplicationDTO, key: SortKey): string | number | null {
  switch (key) {
    case "company":
      return app.company;
    case "position":
      return app.position;
    case "term":
      return app.term;
    case "industry":
      return app.industry;
    case "companyType":
      return app.companyType;
    case "appliedAt":
      return app.appliedAt ? parseISO(app.appliedAt).getTime() : null;
    case "status":
      return STATUS_RANK[app.status];
  }
}

function sortApplications(
  apps: ApplicationDTO[],
  key: SortKey,
  dir: SortDir,
): ApplicationDTO[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...apps].sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    const aEmpty = va === null || va === "";
    const bEmpty = vb === null || vb === "";
    if (aEmpty && bEmpty) return 0;
    if (aEmpty) return 1;
    if (bEmpty) return -1;
    if (typeof va === "number" && typeof vb === "number") {
      return (va - vb) * sign;
    }
    return (
      String(va).localeCompare(String(vb), undefined, { sensitivity: "base" }) *
      sign
    );
  });
}
