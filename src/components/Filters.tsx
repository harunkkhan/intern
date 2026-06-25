"use client";

import { APPLICATION_STATUSES, STATUS_LABELS } from "@/lib/types";

interface Props {
  status: string;
  term: string;
  industry: string;
  companyType: string;
  terms: string[];
  industries: string[];
  companyTypes: string[];
  onStatus: (v: string) => void;
  onTerm: (v: string) => void;
  onIndustry: (v: string) => void;
  onCompanyType: (v: string) => void;
}

export default function Filters({
  status,
  term,
  industry,
  companyType,
  terms,
  industries,
  companyTypes,
  onStatus,
  onTerm,
  onIndustry,
  onCompanyType,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        label="Status"
        value={status}
        onChange={onStatus}
        options={[
          { value: "all", label: "Status" },
          ...APPLICATION_STATUSES.map((s) => ({
            value: s,
            label: STATUS_LABELS[s],
          })),
        ]}
      />
      <Select
        label="Term"
        value={term}
        onChange={onTerm}
        options={[
          { value: "all", label: "Term" },
          ...terms.map((t) => ({ value: t, label: t })),
        ]}
      />
      <Select
        label="Industry"
        value={industry}
        onChange={onIndustry}
        widthClass="w-36"
        options={[
          { value: "all", label: "Industry" },
          ...industries.map((i) => ({ value: i, label: i })),
        ]}
      />
      <Select
        label="Type"
        value={companyType}
        onChange={onCompanyType}
        options={[
          { value: "all", label: "Type" },
          ...companyTypes.map((c) => ({ value: c, label: c })),
        ]}
      />
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  widthClass = "w-28",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  widthClass?: string;
}) {
  return (
    <label className="inline-flex items-center">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${widthClass} truncate rounded-none border border-neutral-200 bg-white py-1.5 pl-3 pr-7 text-sm text-neutral-700 focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-200 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:focus:ring-neutral-700`}
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
