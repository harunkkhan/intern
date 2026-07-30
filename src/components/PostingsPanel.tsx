"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatDistanceToNow, parseISO } from "date-fns";
import type { PostingsData } from "@/lib/alerts";
// Values must come from the client-safe module; @/lib/alerts imports the
// database client and would end up in the browser bundle.
import { POSTINGS_PAGE_SIZES, POSTINGS_WINDOW_DAYS } from "@/lib/postings";
import SearchBar from "@/components/SearchBar";

/**
 * Every posting the poller has recorded, newest first — separate from Alerts,
 * which is about configuration.
 *
 * Paging and searching happen on the server. There are well over a thousand
 * active listings, so filtering in the browser would mean shipping all of them
 * and would silently search only what had been loaded.
 */
export default function PostingsPanel({ data }: { data: PostingsData }) {
  const [state, setState] = useState(data);
  const [query, setQuery] = useState(data.query);
  const [loading, setLoading] = useState(false);
  // Guards against an earlier request landing after a later one and overwriting it.
  const requestId = useRef(0);

  const load = useCallback(
    async (page: number, q: string, size: number) => {
      const id = ++requestId.current;
      setLoading(true);
      try {
        const res = await fetch(
          `/api/postings?page=${page}&q=${encodeURIComponent(q)}&pageSize=${size}`,
        );
        if (!res.ok) return;
        const next = (await res.json()) as PostingsData;
        if (id === requestId.current) setState(next);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [],
  );

  // Debounced search, always restarting at the first page since the result set
  // changes underneath the current offset.
  useEffect(() => {
    if (query === state.query) return;
    const timer = setTimeout(() => void load(0, query, state.pageSize), 250);
    return () => clearTimeout(timer);
  }, [query, state.query, state.pageSize, load]);

  // Changing the page size keeps the first currently-visible row on screen
  // rather than jumping back to the start — going 25→50 on page 4 lands on
  // page 2, showing the same listings plus more, which is what someone widening
  // the page is asking for.
  const changePageSize = useCallback(
    (size: number) => {
      if (size === state.pageSize) return;
      const firstRow = state.page * state.pageSize;
      void load(Math.floor(firstRow / size), state.query, size);
    },
    [state.page, state.pageSize, state.query, load],
  );

  const pageCount = Math.max(1, Math.ceil(state.total / state.pageSize));
  const canPrev = state.page > 0;
  const canNext = state.page + 1 < pageCount;

  const go = useCallback(
    (page: number) => {
      if (page < 0 || page >= pageCount || page === state.page) return;
      void load(page, state.query, state.pageSize);
    },
    [pageCount, state.page, state.query, state.pageSize, load],
  );

  // Left/right arrows page through results. Ignored while typing, so the arrow
  // keys still move the caret inside the search box.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      const tag = el?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (el as HTMLElement | null)?.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
      go(state.page + (e.key === "ArrowRight" ? 1 : -1));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [go, state.page]);

  const first = state.total === 0 ? 0 : state.page * state.pageSize + 1;
  const last = Math.min(state.total, (state.page + 1) * state.pageSize);

  return (
    <div className="mt-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full min-w-0 max-w-md">
          <SearchBar value={query} onChange={setQuery} />
        </div>
        <label className="flex shrink-0 items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
          Per page
          <select
            value={state.pageSize}
            disabled={loading}
            onChange={(e) => changePageSize(Number(e.target.value))}
            className="rounded-none border border-neutral-300 bg-white px-2 py-1.5 text-xs text-neutral-800 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
          >
            {POSTINGS_PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>

      {state.total === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-neutral-300 px-6 py-12 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
          {state.query
            ? `Nothing from the last ${POSTINGS_WINDOW_DAYS} days matches “${state.query}”.`
            : `Nothing has opened in the last ${POSTINGS_WINDOW_DAYS} days.`}
        </p>
      ) : (
        <>
          <p className="mt-4 text-xs text-neutral-500 dark:text-neutral-400">
            {first}–{last} of {state.total}
            {state.query && " matching"} · opened in the last{" "}
            {POSTINGS_WINDOW_DAYS} days
          </p>

          <ul
            className={`mt-3 divide-y divide-neutral-100 border-y border-neutral-100 transition-opacity dark:divide-neutral-800 dark:border-neutral-800 ${
              loading ? "opacity-50" : ""
            }`}
          >
            {state.rows.map((l) => (
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

          <nav className="mt-5 flex items-center justify-between gap-3">
            <PagerButton
              label="Previous page"
              disabled={!canPrev || loading}
              onClick={() => go(state.page - 1)}
            >
              <ChevronLeft />
            </PagerButton>

            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Page {state.page + 1} of {pageCount}
              <span className="ml-2 hidden text-neutral-400 sm:inline dark:text-neutral-500">
                use ← → to move
              </span>
            </p>

            <PagerButton
              label="Next page"
              disabled={!canNext || loading}
              onClick={() => go(state.page + 1)}
            >
              <ChevronRight />
            </PagerButton>
          </nav>
        </>
      )}
    </div>
  );
}

function PagerButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-9 w-9 items-center justify-center rounded-none border border-neutral-300 text-neutral-700 transition hover:bg-neutral-100 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
    >
      {children}
    </button>
  );
}

function ChevronLeft() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
