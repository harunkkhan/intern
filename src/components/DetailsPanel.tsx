"use client";

import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import {
  APPLICATION_STATUSES,
  INDUSTRIES,
  POSITION_TYPES,
  STATUS_LABELS,
  type ApplicationDTO,
} from "@/lib/types";
import StatusBadge from "@/components/StatusBadge";

export interface DetailsPatch {
  status: string;
  positionType: string;
  industry: string;
  notes: string;
}

export default function DetailsPanel({
  app,
  saving,
  onClose,
  onSave,
  onDelete,
}: {
  app: ApplicationDTO | null;
  saving: boolean;
  onClose: () => void;
  onSave: (patch: DetailsPatch) => void;
  onDelete: () => void;
}) {
  const [status, setStatus] = useState("applied");
  const [positionType, setPositionType] = useState("");
  const [industry, setIndustry] = useState("");
  const [notes, setNotes] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!app) return;
    setStatus(app.status);
    setPositionType(app.positionType ?? "");
    setIndustry(app.industry ?? "");
    setNotes(app.notes ?? "");
    setConfirmDelete(false);
  }, [app]);

  if (!app) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-30 bg-neutral-900/20 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className="fixed right-0 top-0 z-40 flex h-full w-full max-w-md flex-col border-l border-neutral-200 bg-white shadow-xl">
        <header className="flex items-start justify-between gap-4 border-b border-neutral-200 px-6 py-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-lg font-semibold text-neutral-900">
                {app.company}
              </h2>
              <StatusBadge status={app.status} />
            </div>
            <p className="mt-0.5 truncate text-sm text-neutral-500">
              {app.position}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700"
            aria-label="Close"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <section className="grid grid-cols-2 gap-3">
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
              <p className="px-1 py-1.5 text-sm text-neutral-700">
                {app.appliedAt
                  ? format(parseISO(app.appliedAt), "MMM d, yyyy")
                  : "—"}
              </p>
            </Field>
            <Field label="Type">
              <SelectInput
                value={positionType}
                onChange={setPositionType}
                placeholder="Unset"
                options={POSITION_TYPES.map((t) => ({ value: t, label: t }))}
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
          </section>

          <section>
            <Label>Notes</Label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Add your own notes…"
              className="mt-1 w-full resize-y rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-800 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-200"
            />
          </section>

          <section>
            <Label>Progress timeline</Label>
            <ol className="mt-3 space-y-4">
              {app.events.length === 0 && (
                <li className="text-sm text-neutral-400">No events yet.</li>
              )}
              {[...app.events]
                .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
                .map((e) => (
                  <li key={e.id} className="relative pl-5">
                    <span className="absolute left-0 top-1.5 h-2 w-2 rounded-full bg-neutral-300" />
                    <div className="flex items-center gap-2">
                      <StatusBadge status={e.status} />
                      <time className="text-xs text-neutral-400">
                        {format(parseISO(e.occurredAt), "MMM d, yyyy")}
                      </time>
                    </div>
                    {e.summary && (
                      <p className="mt-1 text-sm text-neutral-700">
                        {e.summary}
                      </p>
                    )}
                    {e.emailSubject && (
                      <p className="mt-0.5 truncate text-xs text-neutral-400">
                        {e.emailSubject}
                      </p>
                    )}
                  </li>
                ))}
            </ol>
          </section>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-neutral-200 px-6 py-4">
          {confirmDelete ? (
            <button
              onClick={onDelete}
              className="text-sm font-medium text-rose-600 hover:text-rose-700"
            >
              Confirm delete?
            </button>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-sm font-medium text-neutral-400 hover:text-rose-600"
            >
              Delete
            </button>
          )}
          <button
            onClick={() => onSave({ status, positionType, industry, notes })}
            disabled={saving}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </footer>
      </aside>
    </>
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
    <span className="text-xs font-medium uppercase tracking-wide text-neutral-400">
      {children}
    </span>
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
      className="w-full rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700 focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-200"
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
