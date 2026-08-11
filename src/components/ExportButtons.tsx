"use client";

import { useState, type RefObject } from "react";
import { downloadChart, type ExportFormat } from "@/lib/exportChart";

/**
 * PNG and SVG side by side rather than behind a menu — two options do not earn
 * a popover, and both are wanted for different things: PNG to paste somewhere,
 * SVG to keep it sharp or edit it.
 */
export default function ExportButtons({
  target,
  filename,
}: {
  target: RefObject<HTMLDivElement | null>;
  filename: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<ExportFormat | null>(null);

  async function run(format: ExportFormat) {
    setError(null);
    setBusy(format);
    try {
      await downloadChart(target.current, filename, format);
    } catch (err) {
      setError(err instanceof Error ? err.message : "export failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error && (
        <span className="text-xs text-rose-600 dark:text-rose-400">
          {error}
        </span>
      )}
      {(["png", "svg"] as const).map((format) => (
        <button
          key={format}
          type="button"
          onClick={() => run(format)}
          disabled={busy !== null}
          title={`Download as ${format.toUpperCase()}`}
          className="rounded-none border border-neutral-200 bg-white px-2 py-1 text-xs font-medium uppercase tracking-wide text-neutral-600 transition hover:bg-neutral-50 hover:text-neutral-900 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
        >
          {busy === format ? "…" : format}
        </button>
      ))}
    </div>
  );
}
