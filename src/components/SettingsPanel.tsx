"use client";

import SyncButton from "@/components/SyncButton";
import ThemeToggle from "@/components/ThemeToggle";

export default function SettingsPanel({
  syncing,
  onSync,
  syncStatus,
}: {
  syncing: boolean;
  onSync: () => void;
  syncStatus: string | null;
}) {
  return (
    <div className="mt-6 space-y-5">
      <Card
        title="Appearance"
        description="Switch between the light and dark color theme."
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
              Dark mode
            </p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Use a darker theme across the app.
            </p>
          </div>
          <ThemeToggle />
        </div>
      </Card>

      <Card
        title="Sync"
        description="Scan your inbox for new application emails and updates."
      >
        <div className="flex flex-wrap items-center gap-3">
          <SyncButton syncing={syncing} onClick={onSync} />
          {syncStatus && (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {syncStatus}
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}

function Card({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        {title}
      </h2>
      <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
        {description}
      </p>
      <div className="mt-4">{children}</div>
    </section>
  );
}
