import { STATUS_LABELS, type ApplicationStatus } from "@/lib/types";

const STYLES: Record<ApplicationStatus, string> = {
  applied: "bg-blue-50 text-blue-700 ring-blue-600/20",
  assessment: "bg-amber-50 text-amber-700 ring-amber-600/20",
  interview: "bg-violet-50 text-violet-700 ring-violet-600/20",
  offer: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  rejected: "bg-rose-50 text-rose-700 ring-rose-600/20",
  withdrawn: "bg-neutral-100 text-neutral-600 ring-neutral-500/20",
};

export default function StatusBadge({ status }: { status: ApplicationStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
