"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import {
  APPLICATION_STATUSES,
  COMPANY_TYPES,
  INDUSTRIES,
  TERMS,
  STATUS_LABELS,
  type ApplicationDTO,
} from "@/lib/types";
import { splitCandidates, type SplitCandidate, type SplitPlan } from "@/lib/split";
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
  siblings,
  saving,
  error,
  onBack,
  onSave,
  onDelete,
  onSplit,
  onMerge,
  onOaCompleted,
}: {
  app: ApplicationDTO;
  // Other entries at the same company — the candidates this one can absorb.
  siblings: ApplicationDTO[];
  saving: boolean;
  error: string | null;
  onBack: () => void;
  onSave: (patch: DetailsPatch) => void;
  onDelete: () => void;
  onSplit: (plan: SplitPlan) => void;
  onMerge: (sourceId: string) => void;
  onOaCompleted: (completed: boolean) => void;
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
            Internship Tracker
          </button>
          <ChevronIcon />
          <span className="font-semibold text-neutral-900 dark:text-neutral-100">
            {app.company}
          </span>
          <StatusBadge status={app.status} />
        </nav>
        <div className="flex items-center gap-3">
          <SeparateMenu app={app} disabled={saving} onSplit={onSplit} />
          <MergeMenu
            siblings={siblings}
            disabled={saving}
            onMerge={onMerge}
          />
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

      {error && (
        <p className="mt-4 border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300">
          {error}
        </p>
      )}

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
          {/* Only where there is an assessment to have finished. Applies
              immediately rather than waiting on Save — it is a one-click fact,
              not a form field being drafted. */}
          {hasAssessment(app) && (
            <Field label="Online assessment">
              <OaToggle
                completed={app.oaCompleted}
                disabled={saving}
                onChange={onOaCompleted}
              />
            </Field>
          )}
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

const GROUP_LABELS: Record<SplitCandidate["group"], string> = {
  term: "Separate by term",
  role: "Separate by role",
  event: "Move one event out",
};

const GROUP_ORDER: SplitCandidate["group"][] = ["term", "role", "event"];

// True when there is an assessment to have finished: one sat now, one somewhere
// in the history, or one already marked done. Reading the timeline as well as
// the current status keeps the control visible on an application that has since
// moved to interview, where the fact that you did the OA is still part of it.
function hasAssessment(app: ApplicationDTO): boolean {
  return (
    app.oaCompleted ||
    app.status === "assessment" ||
    app.events.some((e) => e.status === "assessment")
  );
}

function OaToggle({
  completed,
  disabled,
  onChange,
}: {
  completed: boolean;
  disabled: boolean;
  onChange: (completed: boolean) => void;
}) {
  if (completed) {
    return (
      <p className="flex items-center gap-2 py-1.5 text-sm">
        <span className="inline-flex items-center gap-1.5 border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
          <CheckIcon />
          Completed
        </span>
        <button
          onClick={() => onChange(false)}
          disabled={disabled}
          className="text-xs text-neutral-400 underline-offset-2 transition hover:text-neutral-700 hover:underline disabled:opacity-60 dark:text-neutral-500 dark:hover:text-neutral-200"
        >
          Undo
        </button>
      </p>
    );
  }
  return (
    <button
      onClick={() => onChange(true)}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 border border-neutral-200 px-3 py-1.5 text-sm font-medium text-neutral-700 transition hover:border-neutral-400 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-200 dark:hover:border-neutral-500"
    >
      Mark as completed
    </button>
  );
}

// Pulls part of this entry out into its own application.
function SeparateMenu({
  app,
  disabled,
  onSplit,
}: {
  app: ApplicationDTO;
  disabled: boolean;
  onSplit: (plan: SplitPlan) => void;
}) {
  const candidates = useMemo(() => splitCandidates(app), [app]);

  return (
    <Dropdown label="Separate" disabled={disabled} resetKey={app.id}>
      {(close) =>
        candidates.length === 0 ? (
          <MenuEmpty>
            Nothing to separate — one role, one term, one email.
          </MenuEmpty>
        ) : (
          GROUP_ORDER.map((group) => {
            const items = candidates.filter((c) => c.group === group);
            if (items.length === 0) return null;
            return (
              <div key={group}>
                <MenuHeading>{GROUP_LABELS[group]}</MenuHeading>
                {items.map((c) => (
                  <MenuItem
                    key={c.key}
                    label={c.label}
                    detail={c.detail}
                    onClick={() => {
                      close();
                      onSplit({
                        position: c.position,
                        term: c.term,
                        eventIds: c.eventIds,
                        keepPosition: c.keepPosition,
                      });
                    }}
                  />
                ))}
              </div>
            );
          })
        )
      }
    </Dropdown>
  );
}

// Folds another entry at the same company into this one. Merging deletes the
// entry it absorbs, so it takes a second click on the same row.
function MergeMenu({
  siblings,
  disabled,
  onMerge,
}: {
  siblings: ApplicationDTO[];
  disabled: boolean;
  onMerge: (sourceId: string) => void;
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null);

  return (
    <Dropdown
      label="Merge"
      disabled={disabled}
      resetKey={siblings.map((s) => s.id).join()}
      onClose={() => setConfirmId(null)}
    >
      {(close) =>
        siblings.length === 0 ? (
          <MenuEmpty>No other entries at this company.</MenuEmpty>
        ) : (
          <>
            <MenuHeading>Merge into this entry</MenuHeading>
            {siblings.map((s) => (
              <MenuItem
                key={s.id}
                label={s.position}
                detail={
                  confirmId === s.id
                    ? "Click again to merge — this deletes that entry"
                    : [s.term ?? "No term", STATUS_LABELS[s.status]].join(" · ")
                }
                danger={confirmId === s.id}
                onClick={() => {
                  if (confirmId !== s.id) {
                    setConfirmId(s.id);
                    return;
                  }
                  close();
                  onMerge(s.id);
                }}
              />
            ))}
          </>
        )
      }
    </Dropdown>
  );
}

// Button + anchored panel, closing on outside click, Escape, or a change of
// `resetKey` (which is what shuts a stale menu when the entry behind it moves).
function Dropdown({
  label,
  disabled,
  resetKey,
  onClose,
  children,
}: {
  label: string;
  disabled: boolean;
  resetKey: string;
  onClose?: () => void;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const close = useCallback(() => {
    setOpen(false);
    closeRef.current?.();
  }, []);

  useEffect(() => {
    setOpen(false);
    closeRef.current?.();
  }, [resetKey]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) close();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => (open ? close() : setOpen(true))}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex items-center gap-1.5 border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-700 transition hover:border-neutral-400 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-200 dark:hover:border-neutral-500"
      >
        {label}
        <ChevronDownIcon />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 max-h-96 w-80 overflow-y-auto border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}

function MenuEmpty({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 py-2 text-sm text-neutral-400 dark:text-neutral-500">
      {children}
    </p>
  );
}

function CheckIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function MenuHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
      {children}
    </p>
  );
}

function MenuItem({
  label,
  detail,
  danger,
  onClick,
}: {
  label: string;
  detail: string | null;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="block w-full px-3 py-1.5 text-left transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
    >
      <span
        className={`block truncate text-sm ${
          danger
            ? "text-rose-600 dark:text-rose-400"
            : "text-neutral-800 dark:text-neutral-100"
        }`}
      >
        {label}
      </span>
      {detail && (
        <span
          className={`block truncate text-xs ${
            danger
              ? "text-rose-500 dark:text-rose-400"
              : "text-neutral-400 dark:text-neutral-500"
          }`}
        >
          {detail}
        </span>
      )}
    </button>
  );
}

function ChevronDownIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
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
