// Webhook URL parsing, shared by the web app (which accepts the URL from a form)
// and discord/ (which posts to it), plus the pieces the /load slash command
// needs on the inbound side. Deliberately dependency-free and free of
// "server-only" so the Bun sender can import it the same way it imports the
// Drizzle schema — node:crypto is a builtin both Node and Bun provide.

import { createPublicKey, verify } from "node:crypto";

/** Discord's hard cap on `content` for one message. */
export const DISCORD_MAX_CONTENT = 2000;

/** SUPPRESS_EMBEDS. Keeps a digest of 40 links from unfurling into 40 cards. */
export const DISCORD_SUPPRESS_EMBEDS = 1 << 2;

const WEBHOOK_HOSTS = new Set([
  "discord.com",
  "discordapp.com",
  "canary.discord.com",
  "ptb.discord.com",
]);

export interface ParsedWebhook {
  /** Normalized to https://discord.com/api/webhooks/<id>/<token>. */
  url: string;
  id: string;
  token: string;
}

/**
 * Validates and normalizes a webhook URL copied out of Discord's channel
 * settings. Returns null for anything that isn't one.
 *
 * Normalizing matters for more than tidiness: `alert_subscriber.webhook_url` is
 * unique, and discord.com / discordapp.com / a trailing `?wait=true` are all the
 * same channel. Without this, the same webhook could be added several times and
 * the channel would get one copy of every digest per row.
 */
export function parseDiscordWebhook(raw: string): ParsedWebhook | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (!WEBHOOK_HOSTS.has(url.hostname.toLowerCase())) return null;

  const segments = url.pathname.split("/").filter(Boolean);
  // /api/webhooks/<id>/<token>, optionally with an /api/v10 version segment.
  if (segments[0] !== "api") return null;
  const rest = /^v\d+$/.test(segments[1] ?? "") ? segments.slice(2) : segments.slice(1);
  const [kind, id, token] = rest;
  if (kind !== "webhooks" || rest.length !== 3) return null;
  if (!id || !/^\d{15,25}$/.test(id)) return null;
  if (!token || token.length < 20) return null;

  return { url: `https://discord.com/api/webhooks/${id}/${token}`, id, token };
}

/**
 * A form of the URL safe to render in the dashboard. The token is a bearer
 * credential — anyone holding it can post to the channel — so only the webhook
 * id, which is not secret, is ever sent to the browser.
 */
export function redactDiscordWebhook(url: string): string {
  const parsed = parseDiscordWebhook(url);
  return parsed ? `Discord webhook · ${parsed.id}` : "Discord webhook";
}

/**
 * Verifies the Ed25519 signature Discord puts on every interaction request.
 * This is the only thing standing between the interactions endpoint and the
 * open internet, so it is the whole authentication story: a request that fails
 * it did not come from Discord.
 *
 * `publicKeyHex` is the Public Key from the application's portal page, raw
 * 32-byte Ed25519 in hex. Node has no loader for that form, so it goes in as a
 * JWK, which takes the same bytes base64url-encoded.
 *
 * Returns false rather than throwing for every kind of bad input, including a
 * malformed key in the environment. Discord validates a newly entered endpoint
 * URL by sending deliberately invalid signatures and requires a 401 — an
 * exception escaping here would be a 500 and the URL would be rejected.
 */
export function verifyDiscordSignature(
  publicKeyHex: string | undefined,
  signature: string | null,
  timestamp: string | null,
  body: string,
): boolean {
  if (!publicKeyHex || !signature || !timestamp) return false;
  // Buffer.from(…, "hex") truncates at the first bad pair instead of failing,
  // so the lengths are checked here rather than left to decode into a short key.
  if (!/^[0-9a-f]{64}$/i.test(publicKeyHex)) return false;
  if (!/^[0-9a-f]{128}$/i.test(signature)) return false;

  try {
    const key = createPublicKey({
      key: {
        kty: "OKP",
        crv: "Ed25519",
        x: Buffer.from(publicKeyHex, "hex").toString("base64url"),
      },
      format: "jwk",
    });
    return verify(
      null,
      Buffer.from(timestamp + body),
      key,
      Buffer.from(signature, "hex"),
    );
  } catch {
    return false;
  }
}

/**
 * Replaces the "thinking…" placeholder left by a deferred interaction response.
 * The interaction token authenticates the call by itself — no bot token is
 * involved — and stays valid for 15 minutes.
 */
export async function editDiscordInteractionReply(
  applicationId: string,
  interactionToken: string,
  content: string,
): Promise<void> {
  const res = await fetch(
    `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}/messages/@original`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: content.slice(0, DISCORD_MAX_CONTENT),
        // A run URL would otherwise unfurl into a card taller than the reply.
        flags: DISCORD_SUPPRESS_EMBEDS,
        allowed_mentions: { parse: [] },
      }),
    },
  );
  if (!res.ok) {
    throw new Error(
      `Discord reply edit failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`,
    );
  }
}
