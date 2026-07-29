"use client";

import { useMemo, useState } from "react";
import { formatDistanceToNow, parseISO } from "date-fns";
import type { PostingsData } from "@/lib/alerts";
import SearchBar from "@/components/SearchBar";

/**
 * Every posting the poller has recorded, newest first — separate from Alerts,
 * which is about configuration. Shows what was found regardless of whether it
 * triggered a notification.
 */
export default function PostingsPanel({ data }: { data: PostingsData }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return data.recent;
    return data.recent.filter(
      (l) =>
        l.company.toLowerCase().includes(q) ||
        l.title.toLowerCase().includes(q) ||
        (l.locations ?? []).some((loc) => loc.toLowerCase().includes(q)),
    );
  }, [data.recent, query]);

  return (
    <div className="mt-6">
      <div className="w-full min-w-0 max-w-md">
        <SearchBar value={query} onChange={setQuery} />
      </div>

      {data.recent.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-neutral-300 px-6 py-12 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
          Nothing recorded yet — the poller runs every 10 minutes.
        </p>
      ) : (
        <>
          <p className="mt-4 text-xs text-neutral-500 dark:text-neutral-400">
            Showing {filtered.length} of the {data.recent.length} most recent ·{" "}
            {data.total} active overall
          </p>
          <ul className="mt-3 divide-y divide-neutral-100 border-y border-neutral-100 dark:divide-neutral-800 dark:border-neutral-800">
            {filtered.map((l) => (
              <li key={l.id} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <a
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-neutral-900 underline decoration-neutral-300 underline-offset-2 hover:decoration-neutral-900 dark:text-neutral-100 dark:decoration-neutral-600 dark:hover:decoration-neutral-100"
                  >
                    {l.title}
                  </a>
                  <span className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">
                    {formatDistanceToNow(parseISO(l.firstSeenAt), {
                      addSuffix: true,
                    })}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                  {[
                    l.company,
                    l.term,
                    l.locations?.slice(0, 2).join(" · "),
                    l.sourceLabel,
                  ]
                    .filter(Boolean)
                    .join(" — ")}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
