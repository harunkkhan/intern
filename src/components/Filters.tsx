"use client";

import { APPLICATION_STATUSES, STATUS_LABELS } from "@/lib/types";

interface Props {
  status: string;
  positionType: string;
  industry: string;
  types: string[];
  industries: string[];
  onStatus: (v: string) => void;
  onType: (v: string) => void;
  onIndustry: (v: string) => void;
  onReset: () => void;
}

export default function Filters({
  status,
  positionType,
  industry,
  types,
  industries,
  onStatus,
  onType,
  onIndustry,
  onReset,
}: Props) {
  const active =
    status !== "all" || positionType !== "all" || industry !== "all";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        label="Status"
        value={status}
        onChange={onStatus}
        options={[
          { value: "all", label: "All statuses" },
          ...APPLICATION_STATUSES.map((s) => ({
            value: s,
            label: STATUS_LABELS[s],
          })),
        ]}
      />
      <Select
        label="Type"
        value={positionType}
        onChange={onType}
        options={[
          { value: "all", label: "All types" },
          ...types.map((t) => ({ value: t, label: t })),
        ]}
      />
      <Select
        label="Industry"
        value={industry}
        onChange={onIndustry}
        options={[
          { value: "all", label: "All industries" },
          ...industries.map((i) => ({ value: i, label: i })),
        ]}
      />
      {active && (
        <button
          onClick={onReset}
          className="text-xs font-medium text-neutral-500 underline-offset-2 hover:text-neutral-800 hover:underline"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="inline-flex items-center">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-neutral-200 bg-white py-1.5 pl-3 pr-8 text-sm text-neutral-700 focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-200"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
