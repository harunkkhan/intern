"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow, parseISO } from "date-fns";
import type {
  AlertChannel,
  AlertsData,
  AlertScope,
  ListSourceDTO,
  SubscriberDTO,
  WatchedCompanyDTO,
} from "@/lib/alerts";
import { ALERT_LISTS } from "@/lib/alertLists";

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

      {ALERT_LISTS.map((list) =>
        list.kind === "companies" ? (
          <Watchlist
            key={list.key}
            title={list.name}
            description={list.description}
            data={data.companies.filter((c) => c.listKey === list.key)}
            busy={busy}
            mutate={mutate}
          />
        ) : (
          <SourceList
            key={list.key}
            title={list.name}
            description={list.description}
            data={data.listSources.filter((s) => s.listKey === list.key)}
          />
        ),
      )}

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
  const [address, setAddress] = useState("");
  const [channel, setChannel] = useState<AlertChannel>("imessage");
  const [scope, setScope] = useState<AlertScope>("watchlist");

  const isDiscord = channel === "discord";

  async function add() {
    const ok = await mutate("/api/alerts/subscribers", {
      method: "POST",
      body: JSON.stringify({
        label,
        scope,
        channel,
        ...(isDiscord ? { webhookUrl: address } : { phone: address }),
      }),
    });
    if (ok) {
      setLabel("");
      setAddress("");
    }
  }

  return (
    <Card
      title="Recipients"
      description="Phone numbers that get an iMessage, and Discord channels that get a webhook post. Each one chooses whether it gets everything or only your watchlist."
    >
      <div className="space-y-3">
        {data.length === 0 && (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            No recipients yet — add a number or a Discord channel below.
          </p>
        )}

        {data.map((s) => (
          <div
            key={s.id}
            className="flex flex-wrap items-center gap-3 border-b border-neutral-100 pb-3 last:border-0 last:pb-0 dark:border-neutral-800"
          >
            <div className="min-w-0 flex-1">
              <p className="flex items-baseline gap-2 truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">
                <span className="shrink-0 border border-neutral-300 px-1 py-px text-[10px] font-semibold tracking-wide text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
                  {s.channel === "discord" ? "DISCORD" : "IMESSAGE"}
                </span>
                <span className="truncate">{s.label}</span>
              </p>
              <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                {s.destination}
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
          <select
            value={channel}
            onChange={(e) => {
              // The address field means something different per channel, so
              // switching clears it rather than leaving a phone number sitting
              // under a "webhook URL" placeholder.
              setChannel(e.target.value as AlertChannel);
              setAddress("");
            }}
            className="rounded-none border border-neutral-300 bg-white px-2 py-2 text-sm text-neutral-800 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
          >
            <option value="imessage">iMessage</option>
            <option value="discord">Discord</option>
          </select>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={isDiscord ? "#internships" : "Name"}
            className="min-w-0 flex-1 rounded-none border border-neutral-300 bg-white px-2.5 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          />
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder={
              isDiscord
                ? "https://discord.com/api/webhooks/…"
                : "(571) 461-9323"
            }
            inputMode={isDiscord ? "url" : "tel"}
            className="min-w-0 flex-[2] rounded-none border border-neutral-300 bg-white px-2.5 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
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
            disabled={busy || !label.trim() || !address.trim()}
            className="rounded-none bg-neutral-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
          >
            Add
          </button>
        </div>

        {isDiscord && (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            In Discord: channel <span className="font-medium">Settings →
            Integrations → Webhooks → New Webhook</span>, then Copy Webhook URL.
            Only the webhook id is stored in a form the dashboard will show back.
          </p>
        )}
      </div>
    </Card>
  );
}

function Watchlist({
  title,
  description,
  data,
  busy,
  mutate,
}: {
  title: string;
  description: string;
  data: WatchedCompanyDTO[];
  busy: boolean;
  mutate: Mutate;
}) {
  const [name, setName] = useState("");
  const [careersUrl, setCareersUrl] = useState("");
  const [expanded, setExpanded] = useState(false);

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

  // A hundred companies would bury the rest of the page.
  const COLLAPSED = 12;
  const shown = expanded ? data : data.slice(0, COLLAPSED);

  return (
    <Card
      title={`${title}${data.length ? ` · ${data.length}` : ""}`}
      description={description}
    >
      <div className="space-y-3">
        {data.length === 0 && (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Nothing watched yet. Recipients set to “Watchlist only” won’t receive
            anything until you add a company.
          </p>
        )}

        {shown.map((c) => (
          <div
            key={c.id}
            className="flex flex-wrap items-center gap-3 border-b border-neutral-100 pb-3 last:border-0 last:pb-0 dark:border-neutral-800"
          >
            <div className="min-w-0 flex-1">
              <p className="flex items-baseline gap-2 truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">
                {c.tier && (
                  <span className="shrink-0 border border-neutral-300 px-1 py-px text-[10px] font-semibold tracking-wide text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
                    {c.tier}
                  </span>
                )}
                <span className="truncate">{c.name}</span>
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

        {data.length > COLLAPSED && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs text-neutral-500 underline transition hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            {expanded
              ? "Show fewer"
              : `Show all ${data.length}`}
          </button>
        )}

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

/**
 * A list whose members are feeds rather than companies — the community repos.
 * Everything such a feed publishes belongs to the list, so there is nothing to
 * match by name.
 */
function SourceList({
  title,
  description,
  data,
}: {
  title: string;
  description: string;
  data: ListSourceDTO[];
}) {
  return (
    <Card
      title={`${title}${data.length ? ` · ${data.length}` : ""}`}
      description={description}
    >
      {data.length === 0 ? (
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          Nothing here yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {data.map((s) => (
            <li key={s.id} className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-sm text-neutral-800 dark:text-neutral-200">
                {s.label}
              </span>
              <span className="text-xs text-neutral-500 dark:text-neutral-400">
                {s.listingCount} active ·{" "}
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
