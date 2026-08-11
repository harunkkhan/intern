"use client";

import { useMemo } from "react";
import { ASSUMED_TERM, buildFunnel, outcomeStats } from "@/lib/analytics";
import FunnelChart from "@/components/FunnelChart";
import OfferRateChart from "@/components/OfferRateChart";
import type { ApplicationDTO } from "@/lib/types";

/**
 * Analytics reads the same filtered list the table does, so whatever is scoped
 * on the Dashboard is what gets charted.
 */
export default function AnalyticsPanel({
  applications,
}: {
  applications: ApplicationDTO[];
}) {
  const assumed = applications.filter((a) => a.term === null).length;
  const funnel = useMemo(() => buildFunnel(applications), [applications]);
  const stats = useMemo(() => outcomeStats(applications), [applications]);

  if (applications.length === 0) {
    return (
      <div className="mt-4 border border-dashed border-neutral-300 bg-white px-6 py-16 text-center dark:border-neutral-700 dark:bg-neutral-900">
        <h2 className="text-base font-medium text-neutral-800 dark:text-neutral-200">
          Nothing to chart
        </h2>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          No applications match the current filters.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        Charting {applications.length} application
        {applications.length === 1 ? "" : "s"}
        {assumed > 0 && (
          <>
            {" — "}
            {assumed} with no term of their own counted as {ASSUMED_TERM}
          </>
        )}
        .
      </p>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <section className="min-w-0 border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
            Where they went
          </h2>
          {/* The chart has a fixed aspect and stops being readable when
              squeezed, so it scrolls sideways rather than shrinking. */}
          <div className="mt-2 overflow-x-auto">
            <div className="min-w-[680px]">
              <FunnelChart funnel={funnel} />
            </div>
          </div>
        </section>

        <section className="border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
            Success rate
          </h2>
          <div className="mt-4">
            <OfferRateChart stats={stats} />
          </div>
        </section>
      </div>
    </div>
  );
}
