// Inbound listener: turns a text into a subscription.
//
//   bun src/listen.ts
//
// Spectrum has no recipient directory to sync from (see subscribe.ts), so this
// is the automatic path onto the alert list: anyone who texts the line is
// recorded in `alert_subscriber` and starts receiving digests on the next poll.
// It also honours STOP/START, which the poller advertises but nothing was
// listening for.
//
// This has to be a long-running process. The provider's stream does support
// server-side catch-up (`client.events.catchUp(since)`), but the cursor driving
// it starts undefined on every process start and can't be seeded from config —
// so a fresh process only ever sees messages that arrive while it is connected.
// A short cron run would miss everything sent between invocations.

import { closeDb } from "./db.ts";
import { formatResumed, formatStopped, formatSubscribed } from "./message.ts";
import { connect, readCredentials, type App } from "./send.ts";
import {
  importSubscriber,
  findByPhone,
  normalizePhone,
  retryFailed,
  setEnabled,
} from "./subscribe.ts";
import { imessage } from "spectrum-ts/providers/imessage";

// Carriers treat these as opt-out/opt-in keywords, so people already expect
// them to work. Matched only when the whole message is the word — "stop by the
// career fair" is a sentence, not a command.
const STOP_WORDS = new Set([
  "stop",
  "stopall",
  "unsubscribe",
  "cancel",
  "end",
  "quit",
]);
const START_WORDS = new Set(["start", "unstop", "subscribe", "resume"]);

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;
// A run that lasted this long was healthy; a failure after it is a fresh
// problem rather than a continuing one, so the backoff starts over.
const HEALTHY_RUN_MS = 60_000;

let stopping = false;
let current: App | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The bare keyword, or "" when the message isn't a single word. */
function keyword(text: string): string {
  const stripped = text.trim().toLowerCase().replace(/[^a-z]/g, "");
  return stripped.length <= 12 ? stripped : "";
}

async function handleStop(phone: string): Promise<string | null> {
  const updated = await setEnabled(phone, false);
  if (!updated) {
    // Never subscribed. Confirming anyway costs nothing and beats leaving
    // someone unsure whether their opt-out landed.
    console.log(`  ${phone}: STOP from a number that wasn't subscribed`);
    return formatStopped();
  }
  console.log(`  ${phone}: STOP — alerts disabled`);
  return formatStopped();
}

async function handleStart(phone: string): Promise<string | null> {
  const { status, subscriber } = await importSubscriber(phone, {
    confirmed: true,
  });
  console.log(`  ${phone}: START — ${status}`);
  if (status === "known") return null;
  return status === "created"
    ? formatSubscribed(subscriber.scope)
    : formatResumed(subscriber.scope);
}

async function handleFirstContact(phone: string): Promise<string | null> {
  const { status, subscriber } = await importSubscriber(phone, {
    confirmed: true,
  });
  if (status === "known") return null;
  console.log(`  ${phone}: ${status} from an inbound message`);
  return status === "created"
    ? formatSubscribed(subscriber.scope)
    : formatResumed(subscriber.scope);
}

/**
 * A reply is what lifts Spectrum's new-contact send cap, so it's also the
 * moment a backlog blocked by that cap becomes deliverable again. Off by
 * default: the backlog can be large, and releasing it turns one reply into a
 * burst of texts.
 */
async function maybeRetryBacklog(phone: string): Promise<void> {
  if (process.env.ALERT_RETRY_ON_REPLY !== "1") return;
  const reset = await retryFailed(phone);
  if (reset > 0) {
    console.log(`  ${phone}: requeued ${reset} failed delivery(ies)`);
  }
}

async function handle(space: { type: string }, message: {
  direction: string;
  sender?: { id: string };
  content: { type: string; text?: string };
}): Promise<string | null> {
  if (message.direction !== "inbound") return null;
  // Auto-subscribing everyone in a group chat is not consent.
  if (space.type !== "dm") return null;

  const handle = message.sender?.id;
  if (!handle) return null;

  const phone = normalizePhone(handle);
  if (!phone) {
    // iMessage handles can be email addresses, which the alert pipeline has no
    // way to deliver to.
    console.log(`  ignoring inbound from non-phone handle ${handle}`);
    return null;
  }

  const word =
    message.content.type === "text" ? keyword(message.content.text ?? "") : "";

  if (STOP_WORDS.has(word)) return handleStop(phone);

  const known = await findByPhone(phone);
  if (known?.enabled) {
    await maybeRetryBacklog(phone);
    if (START_WORDS.has(word)) return null;
    // An ordinary message from an active subscriber. Nothing to do, and
    // replying to it would start a conversation this process can't hold up.
    return null;
  }

  await maybeRetryBacklog(phone);
  return START_WORDS.has(word) ? handleStart(phone) : handleFirstContact(phone);
}

/** Consumes the inbound stream until it ends or throws. */
async function runOnce(): Promise<void> {
  const { projectId, projectSecret } = readCredentials();
  const app = await connect(projectId, projectSecret);
  current = app;
  console.log("listening for inbound messages");

  try {
    for await (const [space, message] of imessage(app).messages) {
      if (stopping) break;
      try {
        const reply = await handle(space, message);
        if (reply) await space.send(reply);
      } catch (err) {
        // One malformed message must not take down the listener.
        const detail = err instanceof Error ? err.message : String(err);
        console.error(`  failed to handle inbound message: ${detail}`);
      }
    }
  } finally {
    current = null;
    try {
      await app.stop();
    } catch {
      // Already down, or never fully up. Either way the reconnect below builds
      // a fresh client.
    }
  }
}

async function main(): Promise<void> {
  let backoff = RECONNECT_MIN_MS;

  while (!stopping) {
    const startedAt = Date.now();
    try {
      await runOnce();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`stream failed: ${detail}`);
    }
    if (stopping) break;

    if (Date.now() - startedAt >= HEALTHY_RUN_MS) backoff = RECONNECT_MIN_MS;
    console.log(`reconnecting in ${Math.round(backoff / 1000)}s`);
    await sleep(backoff);
    backoff = Math.min(backoff * 2, RECONNECT_MAX_MS);
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log(`\n${signal} — shutting down`);
    // Closing the app ends the `for await`, which unwinds `runOnce` normally.
    void current?.stop().catch(() => {});
  });
}

try {
  await main();
} finally {
  await closeDb();
}
