"use client";

import { useEffect, useState } from "react";
import type { OutcomeStats } from "@/lib/analytics";

// Literal colours for the same reason as FunnelChart: this gets serialised on
// its own by the export, where a Tailwind class resolves to nothing.
const LIGHT = {
  offer: "#10b981",
  track: "#e7e5e4",
  strong: "#171717",
  muted: "#737373",
};
const DARK = {
  offer: "#34d399",
  track: "#292524",
  strong: "#f5f5f5",
  muted: "#a3a3a3",
};

const SIZE = 168;
const STROKE = 16;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function useIsDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const update = () => setDark(root.classList.contains("dark"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

/**
 * Offers as a share of applications.
 *
 * The number is tiny by nature — one offer against eighty-odd applications is
 * a normal cycle, not a bad one — so the arc is drawn with a minimum sweep. A
 * true-to-scale 1.2% arc is invisible, and an invisible arc reads as a bug
 * rather than as a small number.
 */
export default function OfferRateChart({ stats }: { stats: OutcomeStats }) {
  const dark = useIsDark();
  const c = dark ? DARK : LIGHT;

  const pct = stats.offerRate * 100;
  const swept =
    stats.offers === 0
      ? 0
      : Math.max(0.02, stats.offerRate) * CIRCUMFERENCE;
  // A decimal below 10%: rounding 1.2% to "1%" throws away most of what the
  // number says when the whole range of interest is a few percent wide.
  const label =
    pct === 0 ? "0%" : pct < 10 ? `${pct.toFixed(1)}%` : `${Math.round(pct)}%`;

  return (
    <div className="flex flex-col items-center">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width={SIZE}
        height={SIZE}
        role="img"
        aria-label={`${stats.offers} offers from ${stats.total} applications, ${label}`}
      >
        {/* Rotated so the arc starts at twelve o'clock rather than three. */}
        <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke={c.track}
            strokeWidth={STROKE}
          />
          {stats.offers > 0 && (
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke={c.offer}
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={`${swept} ${CIRCUMFERENCE - swept}`}
            />
          )}
        </g>
        <text
          x={SIZE / 2}
          y={SIZE / 2 - 2}
          textAnchor="middle"
          fill={c.strong}
          fontSize="30"
          fontWeight="600"
        >
          {label}
        </text>
        <text
          x={SIZE / 2}
          y={SIZE / 2 + 20}
          textAnchor="middle"
          fill={c.muted}
          fontSize="12"
        >
          offer rate
        </text>
      </svg>

      <p className="mt-3 text-center text-sm text-neutral-600 dark:text-neutral-300">
        <span className="font-semibold text-neutral-900 dark:text-neutral-100">
          {stats.offers}
        </span>{" "}
        offer{stats.offers === 1 ? "" : "s"} from {stats.total} application
        {stats.total === 1 ? "" : "s"}
      </p>

      <dl className="mt-4 w-full space-y-1.5 border-t border-neutral-200 pt-3 text-sm dark:border-neutral-800">
        <Row
          label="Reached OA"
          value={stats.reachedAssessment}
          total={stats.total}
        />
        <Row
          label="Reached interview"
          value={stats.reachedInterview}
          total={stats.total}
        />
      </dl>
    </div>
  );
}

function Row({
  label,
  value,
  total,
}: {
  label: string;
  value: number;
  total: number;
}) {
  const pct = total ? (value / total) * 100 : 0;
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-neutral-500 dark:text-neutral-400">{label}</dt>
      <dd className="tabular-nums text-neutral-800 dark:text-neutral-200">
        {value}
        {/* Parenthesised so the count and its share stay legible as two
            numbers even where the margin between them collapses. */}
        <span className="ml-1.5 text-xs text-neutral-400 dark:text-neutral-500">
          ({pct > 0 && pct < 10 ? pct.toFixed(1) : Math.round(pct)}%)
        </span>
      </dd>
    </div>
  );
}
