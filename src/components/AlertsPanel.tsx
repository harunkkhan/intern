"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow, parseISO } from "date-fns";
import type {
  AlertsData,
  AlertScope,
  SubscriberDTO,
  WatchedCompanyDTO,
} from "@/lib/alerts";

export default function AlertsPanel({ data }: { data: AlertsData }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Every mutation funnels through here so error handling and the refresh are
  // written once rather than in each handler.
  async function mutate(
    url: string,
    init: RequestInit,
  ): Promise<boolean> {
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

  return (
    <div className="mt-6 space-y-5">
      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <Subscribers data={data.subscribers} busy={busy} mutate={mutate} />
      <Watchlist data={data.companies} busy={busy} mutate={mutate} />
      <Recent data={data.recent} />
      <Sources data={data.sources} />
    </div>
  );
}

type Mutate = (url: string, init: RequestInit) => Promise<boolean>;

function Subscribers({
  data,
  busy,
  mutate,
}: {
  data: SubscriberDTO[];
  busy: boolean;
  mutate: Mutate;
}) {
  const [label, setLabel] = useState("");
  const [phone, setPhone] = useState("");
  const [scope, setScope] = useState<AlertScope>("watchlist");

  async function add() {
    const ok = await mutate("/api/alerts/subscribers", {
      method: "POST",
      body: JSON.stringify({ label, phone, scope }),
    });
    if (ok) {
      setLabel("");
      setPhone("");
    }
  }

  return (
    <Card
      title="Recipients"
      description="Phone numbers that receive iMessage alerts. Each one chooses whether it gets everything or only your watchlist."
    >
      <div className="space-y-3">
        {data.length === 0 && (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            No recipients yet — add a number below.
          </p>
        )}

        {data.map((s) => (
          <div
            key={s.id}
            className="flex flex-wrap items-center gap-3 border-b border-neutral-100 pb-3 last:border-0 last:pb-0 dark:border-neutral-800"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">
                {s.label}
              </p>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                {s.phone}
                {!s.confirmedAt && " · intro message pending"}
              </p>
            </div>

            <select
              value={s.scope}
              disabled={busy}
              onChange={(e) =>
                mutate(`/api/alerts/subscribers/${s.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({ scope: e.target.value }),
                })
              }
              className="rounded-none border border-neutral-300 bg-white px-2 py-1.5 text-xs text-neutral-800 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
            >
              <option value="watchlist">Watchlist only</option>
              <option value="all">All job alerts</option>
            </select>

            <label className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400">
              <input
                type="checkbox"
                checked={s.enabled}
                disabled={busy}
                onChange={(e) =>
                  mutate(`/api/alerts/subscribers/${s.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ enabled: e.target.checked }),
                  })
                }
              />
              On
            </label>

            <button
              type="button"
              disabled={busy}
              onClick={() =>
                mutate(`/api/alerts/subscribers/${s.id}`, { method: "DELETE" })
              }
              className="text-xs text-neutral-500 underline transition hover:text-red-600 disabled:opacity-50 dark:text-neutral-400 dark:hover:text-red-400"
            >
              Remove
            </button>
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Name"
            className="min-w-0 flex-1 rounded-none border border-neutral-300 bg-white px-2.5 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(571) 461-9323"
            inputMode="tel"
            className="min-w-0 flex-1 rounded-none border border-neutral-300 bg-white px-2.5 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          />
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as AlertScope)}
            className="rounded-none border border-neutral-300 bg-white px-2 py-2 text-sm text-neutral-800 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
          >
            <option value="watchlist">Watchlist only</option>
            <option value="all">All job alerts</option>
          </select>
          <button
            type="button"
            onClick={add}
            disabled={busy || !label.trim() || !phone.trim()}
            className="rounded-none bg-neutral-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
          >
            Add
          </button>
        </div>
      </div>
    </Card>
  );
}

function Watchlist({
  data,
  busy,
  mutate,
}: {
  data: WatchedCompanyDTO[];
  busy: boolean;
  mutate: Mutate;
}) {
  const [name, setName] = useState("");
  const [careersUrl, setCareersUrl] = useState("");

  async function add() {
    const ok = await mutate("/api/alerts/companies", {
      method: "POST",
      body: JSON.stringify({ name, careersUrl }),
    });
    if (ok) {
      setName("");
      setCareersUrl("");
    }
  }

  return (
    <Card
      title="Watchlist"
      description="Companies to follow. A careers URL is optional — without one you still get matches from the community feeds by name."
    >
      <div className="space-y-3">
        {data.length === 0 && (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Nothing watched yet. Recipients set to “Watchlist only” won’t receive
            anything until you add a company.
          </p>
        )}

        {data.map((c) => (
          <div
            key={c.id}
            className="flex flex-wrap items-center gap-3 border-b border-neutral-100 pb-3 last:border-0 last:pb-0 dark:border-neutral-800"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">
                {c.name}
              </p>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                {c.openCount} open · {c.sourceLabel ? "direct board" : "by name"}
              </p>
            </div>
            <label className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400">
              <input
                type="checkbox"
                checked={c.enabled}
                disabled={busy}
                onChange={(e) =>
                  mutate(`/api/alerts/companies/${c.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ enabled: e.target.checked }),
                  })
                }
              />
              On
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                mutate(`/api/alerts/companies/${c.id}`, { method: "DELETE" })
              }
              className="text-xs text-neutral-500 underline transition hover:text-red-600 disabled:opacity-50 dark:text-neutral-400 dark:hover:text-red-400"
            >
              Remove
            </button>
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Company"
            className="min-w-0 flex-1 rounded-none border border-neutral-300 bg-white px-2.5 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          />
          <input
            value={careersUrl}
            onChange={(e) => setCareersUrl(e.target.value)}
            placeholder="Careers URL (optional)"
            className="min-w-0 flex-[2] rounded-none border border-neutral-300 bg-white px-2.5 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          />
          <button
            type="button"
            onClick={add}
            disabled={busy || !name.trim()}
            className="rounded-none bg-neutral-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
          >
            Add
          </button>
        </div>
      </div>
    </Card>
  );
}

function Recent({ data }: { data: AlertsData["recent"] }) {
  return (
    <Card
      title="Recent postings"
      description="The newest listings across every source, whether or not they triggered an alert."
    >
      {data.length === 0 ? (
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          Nothing recorded yet — the poller runs every 10 minutes.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {data.map((l) => (
            <li
              key={l.id}
              className="border-b border-neutral-100 pb-2.5 last:border-0 last:pb-0 dark:border-neutral-800"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-neutral-900 underline decoration-neutral-300 underline-offset-2 hover:decoration-neutral-900 dark:text-neutral-100 dark:decoration-neutral-600 dark:hover:decoration-neutral-100"
                >
                  {l.title}
                </a>
                <span className="text-xs text-neutral-400 dark:text-neutral-500">
                  {formatDistanceToNow(parseISO(l.firstSeenAt), {
                    addSuffix: true,
                  })}
                </span>
              </div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                {[
                  l.company,
                  l.term,
                  l.locations?.slice(0, 2).join(" · "),
                  l.sourceLabel,
                ]
                  .filter(Boolean)
                  .join(" — ")}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Sources({ data }: { data: AlertsData["sources"] }) {
  return (
    <Card
      title="Source health"
      description="A scraper that quietly breaks looks the same as a quiet week, so failures are surfaced here."
    >
      {data.length === 0 ? (
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          No sources yet. The community feeds register themselves on the first
          poll.
        </p>
      ) : (
        <ul className="space-y-2">
          {data.map((s) => (
            <li key={s.id} className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-sm text-neutral-800 dark:text-neutral-200">
                {s.label}
              </span>
              <span className="text-xs text-neutral-400 dark:text-neutral-500">
                {s.adapter}
              </span>
              <span className="text-xs text-neutral-500 dark:text-neutral-400">
                · {s.listingCount} active ·{" "}
                {s.lastPolledAt
                  ? formatDistanceToNow(parseISO(s.lastPolledAt), {
                      addSuffix: true,
                    })
                  : "never polled"}
              </span>
              {s.lastError && (
                <span className="text-xs text-red-600 dark:text-red-400">
                  · {s.lastError}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Card({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        {title}
      </h2>
      <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
        {description}
      </p>
      <div className="mt-4">{children}</div>
    </section>
  );
}
