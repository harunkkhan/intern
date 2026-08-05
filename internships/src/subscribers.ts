// Subscriber admin from the terminal, for numbers you already know. Numbers
// that text the line arrive on their own — see listen.ts.
//
//   bun src/subscribers.ts list
//   bun src/subscribers.ts add +15551234567 --label "Ada" --scope watchlist
//   bun src/subscribers.ts disable +15551234567
//   bun src/subscribers.ts enable +15551234567
//   bun src/subscribers.ts retry +15551234567

import { closeDb } from "./db.ts";
import {
  ALERT_SCOPES,
  destinationOf,
  importSubscriber,
  isAlertScope,
  listSubscribers,
  normalizePhone,
  retryFailed,
  setEnabled,
  type AlertScope,
} from "./subscribe.ts";

const USAGE = `usage:
  list                                 show every subscriber
  add <phone> [--label L] [--scope S]  add a number (scope: ${ALERT_SCOPES.join(" | ")})
  disable <phone>                      stop alerts without deleting the row
  enable <phone>                       resume alerts
  retry <phone>                        requeue that number's failed deliveries`;

function flag(args: string[], name: string): string | undefined {
  const inline = args.find((a) => a.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
}

/** Exits rather than guessing — a mistyped number would text a stranger. */
function requirePhone(raw: string | undefined): string {
  const phone = raw ? normalizePhone(raw) : null;
  if (!phone) {
    console.error(
      `not a usable phone number: ${raw ?? "(missing)"}\n` +
        "Give 10 digits for US/Canada, or include a country code (+44…).",
    );
    process.exit(1);
  }
  return phone;
}

async function cmdList(): Promise<void> {
  const rows = await listSubscribers();
  if (rows.length === 0) {
    console.log("no subscribers yet");
    return;
  }
  for (const row of rows) {
    const state = row.enabled ? "enabled" : "disabled";
    const confirmed = row.confirmedAt ? "confirmed" : "not yet messaged";
    console.log(
      `${row.channel.padEnd(8)} ${destinationOf(row).padEnd(22)} ${row.label}  ` +
        `scope=${row.scope}  ${state}  ${confirmed}`,
    );
  }
}

async function cmdAdd(args: string[]): Promise<void> {
  const phone = requirePhone(args[0]);
  const rawScope = flag(args, "scope");
  if (rawScope && !isAlertScope(rawScope)) {
    console.error(`unknown scope: ${rawScope} (use ${ALERT_SCOPES.join(" or ")})`);
    process.exit(1);
  }
  const scope = rawScope as AlertScope | undefined;

  // Deliberately not `confirmed` — the poller opens with its intro so the first
  // thing an unsuspecting number receives explains itself and offers STOP.
  const { status, subscriber } = await importSubscriber(phone, {
    label: flag(args, "label"),
    scope,
  });
  const outcome =
    status === "created"
      ? "added"
      : status === "reenabled"
        ? "re-enabled"
        : "already subscribed";
  console.log(`${outcome}: ${subscriber.phone} (${subscriber.label}, ${subscriber.scope})`);
}

async function cmdSetEnabled(args: string[], enabled: boolean): Promise<void> {
  const phone = requirePhone(args[0]);
  const row = await setEnabled(phone, enabled);
  if (!row) {
    console.error(`${phone} is not a subscriber`);
    process.exit(1);
  }
  console.log(`${enabled ? "enabled" : "disabled"}: ${row.phone} (${row.label})`);
}

async function cmdRetry(args: string[]): Promise<void> {
  const phone = requirePhone(args[0]);
  const reset = await retryFailed(phone);
  console.log(
    reset === 0
      ? `nothing to retry for ${phone}`
      : `requeued ${reset} delivery(ies) for ${phone} — they go out on the next poll`,
  );
}

const [command, ...rest] = process.argv.slice(2);

try {
  switch (command) {
    case "list":
      await cmdList();
      break;
    case "add":
      await cmdAdd(rest);
      break;
    case "disable":
      await cmdSetEnabled(rest, false);
      break;
    case "enable":
      await cmdSetEnabled(rest, true);
      break;
    case "retry":
      await cmdRetry(rest);
      break;
    default:
      console.log(USAGE);
      process.exitCode = command ? 1 : 0;
  }
} finally {
  await closeDb();
}
