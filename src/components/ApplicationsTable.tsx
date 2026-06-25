"use client";

import { format, parseISO } from "date-fns";
import type { ApplicationDTO } from "@/lib/types";
import StatusBadge from "@/components/StatusBadge";

export default function ApplicationsTable({
  applications,
  selectedId,
  onSelect,
}: {
  applications: ApplicationDTO[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="overflow-hidden border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-[13px] font-medium text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
            <Th className="w-12 text-center text-neutral-400 dark:text-neutral-500">#</Th>
            <Th className="w-[18%]">
              <HeaderLabel icon={<BuildingIcon />}>Company</HeaderLabel>
            </Th>
            <Th className="w-[20%]">
              <HeaderLabel icon={<BriefcaseIcon />}>Position</HeaderLabel>
            </Th>
            <Th className="w-[13%]">
              <HeaderLabel icon={<TagIcon />}>Term</HeaderLabel>
            </Th>
            <Th className="w-[13%]">
              <HeaderLabel icon={<LayersIcon />}>Industry</HeaderLabel>
            </Th>
            <Th className="w-[13%]">
              <HeaderLabel icon={<AwardIcon />}>Type</HeaderLabel>
            </Th>
            <Th className="w-[11%]">
              <HeaderLabel icon={<CalendarIcon />}>Applied</HeaderLabel>
            </Th>
            <Th className="w-[12%]">
              <HeaderLabel icon={<ActivityIcon />}>Status</HeaderLabel>
            </Th>
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
                  <StatusBadge status={app.status} />
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function HeaderLabel({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-neutral-400 dark:text-neutral-500">{icon}</span>
      {children}
    </span>
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
