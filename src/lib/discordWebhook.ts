// Webhook URL parsing, shared by the web app (which accepts the URL from a form)
// and discord/ (which posts to it). Deliberately dependency-free and free of
// "server-only" so the Bun sender can import it the same way it imports the
// Drizzle schema.

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
