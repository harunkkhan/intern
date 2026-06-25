"use client";

import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import {
  APPLICATION_STATUSES,
  COMPANY_TYPES,
  INDUSTRIES,
  TERMS,
  STATUS_LABELS,
  type ApplicationDTO,
} from "@/lib/types";
import StatusBadge from "@/components/StatusBadge";

export interface DetailsPatch {
  company: string;
  position: string;
  status: string;
  term: string;
  industry: string;
  companyType: string;
}

export default function ApplicationDetail({
  app,
  saving,
  onBack,
  onSave,
  onDelete,
}: {
  app: ApplicationDTO;
  saving: boolean;
  onBack: () => void;
  onSave: (patch: DetailsPatch) => void;
  onDelete: () => void;
}) {
  const [company, setCompany] = useState(app.company);
  const [position, setPosition] = useState(app.position);
  const [status, setStatus] = useState<string>(app.status);
  const [term, setTerm] = useState(app.term ?? "");
  const [industry, setIndustry] = useState(app.industry ?? "");
  const [companyType, setCompanyType] = useState(app.companyType ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setCompany(app.company);
    setPosition(app.position);
    setStatus(app.status);
    setTerm(app.term ?? "");
    setIndustry(app.industry ?? "");
    setCompanyType(app.companyType ?? "");
    setConfirmDelete(false);
  }, [app]);

  return (
    <div>
      <button
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-neutral-500 transition hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
      >
        <BackArrowIcon />
        Back
      </button>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
          <button
            onClick={onBack}
            className="text-neutral-500 transition hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            Harun's Internship Tracker
          </button>
          <ChevronIcon />
          <span className="font-semibold text-neutral-900 dark:text-neutral-100">
            {app.company}
          </span>
          <StatusBadge status={app.status} />
        </nav>
        <div className="flex items-center gap-3">
          {confirmDelete ? (
            <button
              onClick={onDelete}
              className="text-sm font-medium text-rose-600 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-300"
            >
              Confirm delete?
            </button>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-sm font-medium text-neutral-400 hover:text-rose-600 dark:text-neutral-500 dark:hover:text-rose-400"
            >
              Delete
            </button>
          )}
          <button
            onClick={() =>
              onSave({
                company,
                position,
                status,
                term,
                industry,
                companyType,
              })
            }
            disabled={saving}
            className="rounded-none bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>

      <div className="mt-6 rounded-none border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <section className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
          <Field label="Company">
            <TextInput value={company} onChange={setCompany} />
          </Field>
          <Field label="Position">
            <TextInput
              value={position}
              onChange={setPosition}
              placeholder="e.g. Software Engineer Intern"
            />
          </Field>
          <Field label="Status">
            <SelectInput
              value={status}
              onChange={setStatus}
              options={APPLICATION_STATUSES.map((s) => ({
                value: s,
                label: STATUS_LABELS[s],
              }))}
            />
          </Field>
          <Field label="Applied">
            <p className="px-1 py-1.5 text-sm text-neutral-700 dark:text-neutral-300">
              {app.appliedAt
                ? format(parseISO(app.appliedAt), "MMM d, yyyy")
                : "—"}
            </p>
          </Field>
          <Field label="Term">
            <SelectInput
              value={term}
              onChange={setTerm}
              placeholder="Unset"
              options={TERMS.map((t) => ({ value: t, label: t }))}
            />
          </Field>
          <Field label="Industry">
            <SelectInput
              value={industry}
              onChange={setIndustry}
              placeholder="Unset"
              options={INDUSTRIES.map((i) => ({ value: i, label: i }))}
            />
          </Field>
          <Field label="Type">
            <SelectInput
              value={companyType}
              onChange={setCompanyType}
              placeholder="Unset"
              options={COMPANY_TYPES.map((c) => ({ value: c, label: c }))}
            />
          </Field>
        </section>
      </div>

      <div className="mt-4 rounded-none border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <Label>Progress timeline</Label>
        <ol className="mt-3 space-y-4">
          {app.events.length === 0 && (
            <li className="text-sm text-neutral-400 dark:text-neutral-500">
              No events yet.
            </li>
          )}
          {[...app.events]
            .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
            .map((e) => (
              <li key={e.id} className="relative pl-5">
                <span className="absolute left-0 top-1.5 h-2 w-2 rounded-full bg-neutral-300 dark:bg-neutral-600" />
                <div className="flex items-center gap-2">
                  <StatusBadge status={e.status} />
                  <time className="text-xs text-neutral-400 dark:text-neutral-500">
                    {format(parseISO(e.occurredAt), "MMM d, yyyy")}
                  </time>
                </div>
                {e.summary && (
                  <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
                    {e.summary}
                  </p>
                )}
                {e.emailSubject && (
                  <p className="mt-0.5 truncate text-xs text-neutral-400 dark:text-neutral-500">
                    {e.emailSubject}
                  </p>
                )}
              </li>
            ))}
        </ol>
      </div>
    </div>
  );
}

function BackArrowIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-neutral-300 dark:text-neutral-600"
      aria-hidden="true"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
      {children}
    </span>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-none border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-800 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-200 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:ring-neutral-700"
    />
  );
}

function SelectInput({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-none border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700 focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-200 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:focus:ring-neutral-700"
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
