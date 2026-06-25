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
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs font-medium uppercase tracking-wide text-neutral-500">
            <Th className="w-[24%]">Company</Th>
            <Th className="w-[28%]">Position</Th>
            <Th className="w-[16%]">Type</Th>
            <Th className="w-[16%]">Industry</Th>
            <Th className="w-[8%]">Applied</Th>
            <Th className="w-[8%]">Status</Th>
          </tr>
        </thead>
        <tbody>
          {applications.length === 0 ? (
            <tr>
              <td
                colSpan={6}
                className="px-4 py-12 text-center text-sm text-neutral-400"
              >
                No applications match your filters.
              </td>
            </tr>
          ) : (
            applications.map((app) => (
              <tr
                key={app.id}
                onClick={() => onSelect(app.id)}
                className={`cursor-pointer border-b border-neutral-100 transition last:border-0 hover:bg-neutral-50 ${
                  selectedId === app.id ? "bg-neutral-50" : ""
                }`}
              >
                <Td className="font-medium text-neutral-900">{app.company}</Td>
                <Td className="text-neutral-700">{app.position}</Td>
                <Td className="text-neutral-500">{app.positionType ?? "—"}</Td>
                <Td className="text-neutral-500">{app.industry ?? "—"}</Td>
                <Td className="whitespace-nowrap text-neutral-500">
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

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <th className={`px-4 py-2.5 ${className}`}>{children}</th>;
}

function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-4 py-3 align-middle ${className}`}>{children}</td>;
}
