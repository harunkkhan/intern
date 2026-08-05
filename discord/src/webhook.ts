// Discord delivery over an incoming webhook.
//
// A webhook is the whole transport: no bot token, no gateway, no always-on
// process. That is what lets this run as one more step in the 10-minute GitHub
// Action alongside the poller, instead of needing a host of its own.

import {
  DISCORD_SUPPRESS_EMBEDS,
  parseDiscordWebhook,
} from "../../src/lib/discordWebhook.ts";

/** Discord allows roughly 5 posts per 2s per webhook; stay comfortably under. */
const PACE_MS = 400;
const MAX_ATTEMPTS = 4;
/** A 429 asking for longer than this is not worth holding the Action open for. */
const MAX_BACKOFF_MS = 15_000;

export interface Poster {
  /** Posts one message. Throws if it could not be delivered. */
  post(webhookUrl: string, content: string): Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Prints instead of posting. Used by `--dry-run`. */
export function createDryRunPoster(): Poster {
  return {
    async post(webhookUrl, content) {
      const parsed = parseDiscordWebhook(webhookUrl);
      console.log(
        `\n--- would post to webhook ${parsed?.id ?? "?"} (${content.length} chars) ---\n${content}\n---`,
      );
    },
  };
}

export function createPoster(): Poster {
  // Pacing is per-webhook: two different channels don't share a bucket, and
  // making one wait on the other would be pure latency.
  const nextAllowedAt = new Map<string, number>();

  async function pace(url: string): Promise<void> {
    const earliest = nextAllowedAt.get(url) ?? 0;
    const wait = earliest - Date.now();
    if (wait > 0) await sleep(wait);
    nextAllowedAt.set(url, Date.now() + PACE_MS);
  }

  return {
    async post(webhookUrl, content) {
      const parsed = parseDiscordWebhook(webhookUrl);
      if (!parsed) {
        throw new Error("not a Discord webhook URL");
      }

      let lastError = "";
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        await pace(parsed.url);

        let res: Response;
        try {
          res = await fetch(parsed.url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              content,
              username: process.env.DISCORD_USERNAME || undefined,
              avatar_url: process.env.DISCORD_AVATAR_URL || undefined,
              // A digest is an announcement, not a summons. Without this an @here
              // that happened to appear in a job title would ping the server.
              allowed_mentions: { parse: [] },
              flags: DISCORD_SUPPRESS_EMBEDS,
            }),
          });
        } catch (err) {
          // DNS/TLS/socket. Worth retrying; a runner's network blips.
          lastError = err instanceof Error ? err.message : String(err);
          await sleep(Math.min(500 * 2 ** (attempt - 1), MAX_BACKOFF_MS));
          continue;
        }

        if (res.ok) return;

        const body = await res.text().catch(() => "");

        if (res.status === 429) {
          // retry_after is seconds (fractional) in the body; the header is the
          // same value and is the only one present on a Cloudflare-level ban.
          const fromBody = Number(
            (JSON.parse(body || "{}") as { retry_after?: number })
              .retry_after ?? NaN,
          );
          const fromHeader = Number(res.headers.get("retry-after") ?? NaN);
          const seconds = Number.isFinite(fromBody)
            ? fromBody
            : Number.isFinite(fromHeader)
              ? fromHeader
              : 1;
          const waitMs = Math.min(seconds * 1000 + 250, MAX_BACKOFF_MS);
          // Push the whole bucket out, not just this attempt, so the remaining
          // chunks of this digest don't immediately earn another 429.
          nextAllowedAt.set(parsed.url, Date.now() + waitMs);
          lastError = `rate limited (retry_after ${seconds}s)`;
          continue;
        }

        // 401/403/404 mean the webhook was deleted or its token rotated. No
        // number of retries fixes that, and the message says what to do.
        if (res.status === 401 || res.status === 403 || res.status === 404) {
          throw new Error(
            `webhook ${parsed.id} rejected (${res.status}) — it was probably deleted in Discord; re-add it in the Alerts tab`,
          );
        }

        if (res.status >= 500) {
          lastError = `Discord ${res.status}`;
          await sleep(Math.min(500 * 2 ** (attempt - 1), MAX_BACKOFF_MS));
          continue;
        }

        // A 400 is our own bad payload — too long, malformed. Retrying is futile
        // and the body says exactly what Discord objected to.
        throw new Error(`Discord ${res.status}: ${body.slice(0, 300)}`);
      }

      throw new Error(`gave up after ${MAX_ATTEMPTS} attempts: ${lastError}`);
    },
  };
}
