"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow, parseISO } from "date-fns";
import SearchBar from "@/components/SearchBar";
import BehavioralAddModal, { type AddMode } from "@/components/BehavioralAddModal";
import type {
  BehavioralQuestionDTO,
  BehavioralSectionDTO,
} from "@/lib/behavioral";

type Mutate = (url: string, init: RequestInit) => Promise<boolean>;

export default function BehavioralPanel({
  sections,
}: {
  sections: BehavioralSectionDTO[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addMode, setAddMode] = useState<AddMode | null>(null);
  // Answers being edited, keyed by question id. Kept for every question that
  // has been touched rather than only the open one, so opening a second
  // question — or searching while one is half-written — never drops work.
  //
  // Left in place after a save: the server value catches up on the next
  // refresh, and comparing against it is what marks the row clean again.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(null);

  async function mutate(url: string, init: RequestInit): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        ...init,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? "Something went wrong");
      }
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      return false;
    } finally {
      setBusy(false);
    }
  }

  // A section matching by name keeps all of its questions; otherwise the
  // section survives only for the questions that match, so the page collapses
  // to what you searched for instead of making you scroll to it.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sections;
    const matches: BehavioralSectionDTO[] = [];
    for (const s of sections) {
      if (s.name.toLowerCase().includes(q)) {
        matches.push(s);
        continue;
      }
      const questions = s.questions.filter(
        (x) =>
          x.prompt.toLowerCase().includes(q) ||
          x.answer.toLowerCase().includes(q),
      );
      if (questions.length > 0) matches.push({ ...s, questions });
    }
    return matches;
  }, [sections, query]);

  const total = sections.reduce((n, s) => n + s.questions.length, 0);
  const answered = sections.reduce(
    (n, s) => n + s.questions.filter((q) => q.answer.trim()).length,
    0,
  );

  function openAdd(mode: AddMode) {
    setError(null);
    setAddMode(mode);
  }

  async function saveAnswer(id: string) {
    const answer = drafts[id];
    if (answer === undefined) return;
    await mutate(`/api/behavioral/questions/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ answer }),
    });
  }

  return (
    <div className="mt-6 space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full min-w-0 max-w-md">
          <SearchBar
            value={query}
            onChange={setQuery}
            placeholder="Search sections, questions, answers…"
          />
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {total > 0 && (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              {answered} of {total} answered
            </p>
          )}
          <AddMenu canAddQuestion={sections.length > 0} onPick={openAdd} />
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {sections.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-300 px-6 py-10 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
          No sections yet. Use Add to create one — “Leadership”, “Conflict”,
          “Failure” — then put questions under it.
        </p>
      ) : visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-300 px-6 py-10 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
          Nothing matches “{query}”.
        </p>
      ) : (
        visible.map((section) => (
          <Section
            key={section.id}
            section={section}
            busy={busy}
            mutate={mutate}
            drafts={drafts}
            setDrafts={setDrafts}
            openId={openId}
            setOpenId={setOpenId}
            onSaveAnswer={saveAnswer}
          />
        ))
      )}

      {addMode && (
        <BehavioralAddModal
          mode={addMode}
          sections={sections}
          busy={busy}
          error={error}
          mutate={mutate}
          onClose={() => setAddMode(null)}
        />
      )}
    </div>
  );
}

function AddMenu({
  canAddQuestion,
  onPick,
}: {
  canAddQuestion: boolean;
  onPick: (mode: AddMode) => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function pick(mode: AddMode) {
    setOpen(false);
    onPick(mode);
  }

  return (
    <div className="relative">
      {open && (
        <div
          className="fixed inset-0 z-10"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex items-center gap-1.5 rounded-none bg-neutral-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Add
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-44 border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-900"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => pick("section")}
            className="block w-full px-3 py-2 text-left text-sm text-neutral-800 transition hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            New section
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!canAddQuestion}
            title={canAddQuestion ? undefined : "Add a section first"}
            onClick={() => pick("question")}
            className="block w-full px-3 py-2 text-left text-sm text-neutral-800 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            New question
          </button>
        </div>
      )}
    </div>
  );
}

function Section({
  section,
  busy,
  mutate,
  drafts,
  setDrafts,
  openId,
  setOpenId,
  onSaveAnswer,
}: {
  section: BehavioralSectionDTO;
  busy: boolean;
  mutate: Mutate;
  drafts: Record<string, string>;
  setDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  onSaveAnswer: (id: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(section.name);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const answered = section.questions.filter((q) => q.answer.trim()).length;

  async function rename() {
    const ok = await mutate(`/api/behavioral/sections/${section.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
    if (ok) setRenaming(false);
  }

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        {renaming ? (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim() && !busy) rename();
              }}
              autoFocus
              className="min-w-0 flex-1 rounded-none border border-neutral-300 bg-white px-2.5 py-1.5 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
            />
            <button
              type="button"
              onClick={rename}
              disabled={busy || !name.trim()}
              className="rounded-none bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setName(section.name);
                setRenaming(false);
              }}
              className="text-xs text-neutral-500 underline transition hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              {section.name}
            </h2>
            <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
              {section.questions.length} question
              {section.questions.length === 1 ? "" : "s"}
              {section.questions.length > 0 && ` · ${answered} answered`}
            </p>
          </div>
        )}

        {!renaming && (
          <div className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setRenaming(true)}
              className="text-xs text-neutral-500 underline transition hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
            >
              Rename
            </button>
            {confirmDelete ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    mutate(`/api/behavioral/sections/${section.id}`, {
                      method: "DELETE",
                    })
                  }
                  className="text-xs text-red-600 underline transition hover:text-red-700 disabled:opacity-50 dark:text-red-400"
                >
                  Delete section and {section.questions.length} question
                  {section.questions.length === 1 ? "" : "s"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="text-xs text-neutral-500 underline transition hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="text-xs text-neutral-500 underline transition hover:text-red-600 dark:text-neutral-400 dark:hover:text-red-400"
              >
                Delete
              </button>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 space-y-2">
        {section.questions.length === 0 && (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            No questions yet.
          </p>
        )}
        {section.questions.map((question) => (
          <Question
            key={question.id}
            question={question}
            busy={busy}
            mutate={mutate}
            draft={drafts[question.id]}
            onDraft={(value) =>
              setDrafts((d) => ({ ...d, [question.id]: value }))
            }
            open={openId === question.id}
            onToggle={() =>
              setOpenId(openId === question.id ? null : question.id)
            }
            onSave={() => onSaveAnswer(question.id)}
          />
        ))}
      </div>
    </section>
  );
}

function Question({
  question,
  busy,
  mutate,
  draft,
  onDraft,
  open,
  onToggle,
  onSave,
}: {
  question: BehavioralQuestionDTO;
  busy: boolean;
  mutate: Mutate;
  draft: string | undefined;
  onDraft: (value: string) => void;
  open: boolean;
  onToggle: () => void;
  onSave: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const value = draft ?? question.answer;
  const dirty = draft !== undefined && draft !== question.answer;

  return (
    <div className="border-b border-neutral-100 pb-2 last:border-0 last:pb-0 dark:border-neutral-800">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start gap-2 py-1.5 text-left"
      >
        <Chevron open={open} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-neutral-800 dark:text-neutral-200">
            {question.prompt}
          </span>
          {!open && (
            <span className="mt-0.5 block truncate text-xs text-neutral-500 dark:text-neutral-400">
              {value.trim()
                ? value.trim().replace(/\s+/g, " ")
                : "No answer yet"}
            </span>
          )}
        </span>
        {dirty && (
          <span className="shrink-0 border border-neutral-300 px-1 py-px text-[10px] font-semibold tracking-wide text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
            UNSAVED
          </span>
        )}
      </button>

      {open && (
        <div className="space-y-2 pb-2 pl-6">
          <textarea
            value={value}
            onChange={(e) => onDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && dirty) {
                onSave();
              }
            }}
            rows={10}
            autoFocus
            placeholder="Situation, task, action, result…"
            className="w-full resize-y rounded-none border border-neutral-300 bg-white px-3 py-2 text-sm leading-relaxed text-neutral-900 placeholder:text-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onSave}
              disabled={busy || !dirty}
              className="rounded-none bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
            >
              Save answer
            </button>
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              {dirty
                ? "Unsaved changes · ⌘↵ to save"
                : `Saved ${formatDistanceToNow(parseISO(question.updatedAt), {
                    addSuffix: true,
                  })}`}
            </span>
            <span className="ml-auto flex items-center gap-3">
              {confirmDelete ? (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      mutate(`/api/behavioral/questions/${question.id}`, {
                        method: "DELETE",
                      })
                    }
                    className="text-xs text-red-600 underline transition hover:text-red-700 disabled:opacity-50 dark:text-red-400"
                  >
                    Delete question and answer
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="text-xs text-neutral-500 underline transition hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="text-xs text-neutral-500 underline transition hover:text-red-600 dark:text-neutral-400 dark:hover:text-red-400"
                >
                  Delete
                </button>
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
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
      className={`mt-0.5 shrink-0 text-neutral-400 transition-transform dark:text-neutral-500 ${
        open ? "rotate-90" : ""
      }`}
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
