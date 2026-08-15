"use client";

import { format, parseISO } from "date-fns";
import type { ApplicationDTO } from "@/lib/types";
import StatusBadge from "@/components/StatusBadge";

export type SortKey =
  | "company"
  | "position"
  | "term"
  | "industry"
  | "companyType"
  | "appliedAt"
  | "status";

export type SortDir = "asc" | "desc";

interface SortColumn {
  key: SortKey;
  label: string;
  icon: React.ReactNode;
  className: string;
}

const SORT_COLUMNS: SortColumn[] = [
  { key: "company", label: "Company", icon: <BuildingIcon />, className: "w-[18%]" },
  { key: "position", label: "Position", icon: <BriefcaseIcon />, className: "w-[20%]" },
  { key: "term", label: "Term", icon: <TagIcon />, className: "w-[13%]" },
  { key: "industry", label: "Industry", icon: <LayersIcon />, className: "w-[13%]" },
  { key: "companyType", label: "Type", icon: <AwardIcon />, className: "w-[13%]" },
  { key: "appliedAt", label: "Applied", icon: <CalendarIcon />, className: "w-[11%]" },
  { key: "status", label: "Status", icon: <ActivityIcon />, className: "w-[12%]" },
];

export default function ApplicationsTable({
  applications,
  selectedId,
  onSelect,
  sortKey,
  sortDir,
  onSort,
  onClearSort,
}: {
  applications: ApplicationDTO[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  sortKey: SortKey | null;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  onClearSort: () => void;
}) {
  return (
    <>
      {/* Mobile: stacked cards */}
      <div className="md:hidden">
        {applications.length === 0 ? (
          <div className="border border-neutral-200 bg-white px-4 py-12 text-center text-sm text-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-500">
            No applications match your filters.
          </div>
        ) : (
          <>
            <MobileSortBar
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              onClearSort={onClearSort}
            />
            <ul className="flex flex-col gap-2">
              {applications.map((app, i) => (
                <li key={app.id}>
                  <button
                    onClick={() => onSelect(app.id)}
                    className={`flex w-full flex-col gap-2 overflow-hidden border p-4 text-left transition ${
                      selectedId === app.id
                        ? "border-neutral-300 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800/50"
                        : "border-neutral-200 bg-white hover:bg-neutral-50/80 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800/50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 font-medium text-neutral-900 dark:text-neutral-100">
                          <span className="shrink-0 text-xs tabular-nums text-neutral-400 dark:text-neutral-500">
                            {i + 1}
                          </span>
                          <span className="min-w-0 truncate">{app.company}</span>
                        </p>
                        <p className="mt-0.5 truncate text-sm text-neutral-600 dark:text-neutral-400">
                          {app.position}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <StatusBadge status={app.status} />
                        {app.oaCompleted && <OaDoneMark />}
                      </div>
                    </div>
                    <MetaRow app={app} />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {/* Desktop: full table */}
      <div className="hidden overflow-x-auto border border-neutral-200 bg-white md:block dark:border-neutral-800 dark:bg-neutral-900">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-[13px] font-medium text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
              <Th className="w-12 text-center text-neutral-400 dark:text-neutral-500">
                #
              </Th>
              {SORT_COLUMNS.map((column) => (
                <SortableTh
                  key={column.key}
                  column={column}
                  active={sortKey === column.key}
                  sortDir={sortDir}
                  onSort={onSort}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {applications.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-12 text-center text-sm text-neutral-400 dark:text-neutral-500"
                >
                  No applications match your filters.
                </td>
              </tr>
            ) : (
              applications.map((app, i) => (
                <tr
                  key={app.id}
                  onClick={() => onSelect(app.id)}
                  className={`group cursor-pointer border-b border-neutral-100 transition last:border-0 hover:bg-neutral-50/80 dark:border-neutral-800 dark:hover:bg-neutral-800/50 ${
                    selectedId === app.id
                      ? "bg-neutral-50 dark:bg-neutral-800/50"
                      : ""
                  }`}
                >
                  <Td className="text-center text-xs tabular-nums text-neutral-400 dark:text-neutral-500">
                    {i + 1}
                  </Td>
                  <Td className="font-medium text-neutral-900 dark:text-neutral-100">
                    {app.company}
                  </Td>
                  <Td className="text-neutral-700 dark:text-neutral-300">
                    {app.position}
                  </Td>
                  <Td className="text-neutral-500 dark:text-neutral-400">
                    {app.term ?? "—"}
                  </Td>
                  <Td className="text-neutral-500 dark:text-neutral-400">
                    {app.industry ?? "—"}
                  </Td>
                  <Td className="text-neutral-500 dark:text-neutral-400">
                    {app.companyType ?? "—"}
                  </Td>
                  <Td className="whitespace-nowrap text-neutral-500 dark:text-neutral-400">
                    {app.appliedAt
                      ? format(parseISO(app.appliedAt), "MMM d, yyyy")
                      : "—"}
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1.5">
                      <StatusBadge status={app.status} />
                      {app.oaCompleted && <OaDoneMark />}
                    </div>
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

// Marks an assessment you have already sat, so a glance at the board separates
// the OAs still on your plate from the ones waiting on the company.
function OaDoneMark() {
  return (
    <span
      title="OA completed"
      aria-label="OA completed"
      className="inline-flex shrink-0 items-center text-emerald-600 dark:text-emerald-400"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </span>
  );
}

function MobileSortBar({
  sortKey,
  sortDir,
  onSort,
  onClearSort,
}: {
  sortKey: SortKey | null;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  onClearSort: () => void;
}) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <label className="inline-flex flex-1 items-center">
        <span className="sr-only">Sort by</span>
        <select
          value={sortKey ?? ""}
          onChange={(e) => {
            const value = e.target.value;
            if (!value) onClearSort();
            else if (value !== sortKey) onSort(value as SortKey);
          }}
          className="w-full rounded-none border border-neutral-200 bg-white py-1.5 pl-3 pr-7 text-sm text-neutral-700 focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-200 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:focus:ring-neutral-700"
        >
          <option value="">Sort by…</option>
          {SORT_COLUMNS.map((column) => (
            <option key={column.key} value={column.key}>
              {column.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={() => sortKey && onSort(sortKey)}
        disabled={!sortKey}
        title={sortDir === "asc" ? "Ascending" : "Descending"}
        aria-label="Toggle sort direction"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-none border border-neutral-200 bg-white text-neutral-600 transition hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
      >
        {sortDir === "asc" ? <ChevronUpIcon /> : <ChevronDownIcon />}
      </button>
    </div>
  );
}

function SortableTh({
  column,
  active,
  sortDir,
  onSort,
}: {
  column: SortColumn;
  active: boolean;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  return (
    <th
      aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
      className={`border-r border-neutral-200 p-0 last:border-r-0 dark:border-neutral-800 ${column.className}`}
    >
      <button
        type="button"
        onClick={() => onSort(column.key)}
        className="group flex w-full items-center gap-1.5 px-4 py-3 text-left transition hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
      >
        <span className="text-neutral-400 dark:text-neutral-500">
          {column.icon}
        </span>
        <span className="truncate">{column.label}</span>
        <SortArrow active={active} dir={sortDir} />
      </button>
    </th>
  );
}

function SortArrow({ active, dir }: { active: boolean; dir: SortDir }) {
  if (active) {
    return (
      <span className="ml-auto shrink-0 text-neutral-700 dark:text-neutral-200">
        {dir === "asc" ? <ChevronUpIcon /> : <ChevronDownIcon />}
      </span>
    );
  }
  return (
    <span className="ml-auto shrink-0 text-neutral-300 opacity-0 transition group-hover:opacity-100 dark:text-neutral-600">
      <ChevronsUpDownIcon />
    </span>
  );
}

function MetaRow({ app }: { app: ApplicationDTO }) {
  const parts = [
    app.term,
    app.industry,
    app.companyType,
    app.appliedAt ? format(parseISO(app.appliedAt), "MMM d, yyyy") : null,
  ].filter(Boolean) as string[];

  if (parts.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-500 dark:text-neutral-400">
      {parts.map((part, i) => (
        <span key={i} className="flex items-center gap-x-2">
          {i > 0 && (
            <span className="text-neutral-300 dark:text-neutral-600">·</span>
          )}
          <span className="whitespace-nowrap">{part}</span>
        </span>
      ))}
    </div>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`border-r border-neutral-200 px-4 py-3 last:border-r-0 dark:border-neutral-800 ${className}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td
      className={`border-r border-neutral-100 px-4 py-3.5 align-middle last:border-r-0 dark:border-neutral-800 ${className}`}
    >
      {children}
    </td>
  );
}

function ChevronUpIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="m18 15-6-6-6 6" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function ChevronsUpDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m7 15 5 5 5-5M7 9l5-5 5 5" />
    </svg>
  );
}

function BuildingIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <path d="M9 22v-4h6v4M8 6h.01M16 6h.01M8 10h.01M16 10h.01M8 14h.01M16 14h.01" />
    </svg>
  );
}

function BriefcaseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
      <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
    </svg>
  );
}

function AwardIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" />
      <circle cx="12" cy="8" r="6" />
    </svg>
  );
}

function LayersIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 2 8.5 4.5-8.5 4.5L3.5 6.5 12 2Z" />
      <path d="m3.5 12 8.5 4.5 8.5-4.5M3.5 17.5 12 22l8.5-4.5" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

function ActivityIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}
