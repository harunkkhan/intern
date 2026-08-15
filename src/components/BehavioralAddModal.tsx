"use client";

import { useEffect, useState } from "react";
import type { BehavioralSectionDTO } from "@/lib/behavioral";

export type AddMode = "section" | "question";

export default function BehavioralAddModal({
  mode,
  sections,
  busy,
  error,
  mutate,
  onClose,
}: {
  mode: AddMode;
  sections: BehavioralSectionDTO[];
  busy: boolean;
  error: string | null;
  mutate: (url: string, init: RequestInit) => Promise<boolean>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [sectionId, setSectionId] = useState(sections[0]?.id ?? "");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const valid =
    mode === "section" ? !!name.trim() : !!prompt.trim() && !!sectionId;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    const ok =
      mode === "section"
        ? await mutate("/api/behavioral/sections", {
            method: "POST",
            body: JSON.stringify({ name }),
          })
        : await mutate("/api/behavioral/questions", {
            method: "POST",
            body: JSON.stringify({ sectionId, prompt }),
          });
    if (ok) onClose();
  }

  return (
    <>
      <div
        className="fixed inset-0 z-30 bg-neutral-900/30 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <form
        onSubmit={submit}
        className="fixed left-1/2 top-1/2 z-40 flex w-[92vw] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-900"
      >
        <header className="flex items-center justify-between gap-4 border-b border-neutral-200 px-6 py-5 dark:border-neutral-800">
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            {mode === "section" ? "New section" : "New question"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="space-y-4 px-6 py-5">
          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              {error}
            </p>
          )}

          {mode === "section" ? (
            <Field label="Title">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                placeholder="e.g. Leadership"
                className="w-full rounded-none border border-neutral-300 bg-white px-2.5 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              />
            </Field>
          ) : (
            <>
              <Field label="Section">
                <select
                  value={sectionId}
                  onChange={(e) => setSectionId(e.target.value)}
                  className="w-full rounded-none border border-neutral-300 bg-white px-2 py-2 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                >
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Question">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                      submit(e);
                    }
                  }}
                  rows={3}
                  autoFocus
                  placeholder="Tell me about a time you…"
                  className="w-full resize-y rounded-none border border-neutral-300 bg-white px-3 py-2 text-sm leading-relaxed text-neutral-900 placeholder:text-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                />
              </Field>
            </>
          )}
        </div>

        <footer className="flex items-center justify-end gap-3 border-t border-neutral-200 px-6 py-4 dark:border-neutral-800">
          <button
            type="button"
            onClick={onClose}
            className="rounded-none px-3 py-2 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !valid}
            className="rounded-none bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
          >
            {busy ? "Saving…" : mode === "section" ? "Add section" : "Add question"}
          </button>
        </footer>
      </form>
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
      <span className="text-xs font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </div>
  );
}
