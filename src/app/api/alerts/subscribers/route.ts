import { NextResponse } from "next/server";
import { getAllowedUser } from "@/lib/auth";
import { db } from "@/db";
import { alertSubscribers } from "@/db/schema";
import { ALERT_CHANNELS, ALERT_SCOPES, normalizePhone } from "@/lib/alerts";
import { parseDiscordWebhook } from "@/lib/discordWebhook";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await getAllowedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as Record<string, unknown>;
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const scope =
    typeof body.scope === "string" &&
    (ALERT_SCOPES as readonly string[]).includes(body.scope)
      ? body.scope
      : "watchlist";
  const channel =
    typeof body.channel === "string" &&
    (ALERT_CHANNELS as readonly string[]).includes(body.channel)
      ? body.channel
      : "imessage";

  if (!label) {
    return NextResponse.json({ error: "A name is required" }, { status: 400 });
  }

  // The two channels are inserted through the same path because they share the
  // delivery ledger; only the address column and its validation differ.
  const values =
    channel === "discord"
      ? discordValues(body)
      : imessageValues(body);
  if ("error" in values) {
    return NextResponse.json({ error: values.error }, { status: 400 });
  }

  const [created] = await db
    .insert(alertSubscribers)
    .values({ userId: user.id, label, scope, channel, ...values })
    .onConflictDoNothing({
      target:
        channel === "discord"
          ? alertSubscribers.webhookUrl
          : alertSubscribers.phone,
    })
    .returning();

  if (!created) {
    return NextResponse.json(
      {
        error:
          channel === "discord"
            ? "That channel is already subscribed."
            : "That number is already subscribed.",
      },
      { status: 409 },
    );
  }
  return NextResponse.json({ subscriber: created });
}

function imessageValues(
  body: Record<string, unknown>,
): { phone: string } | { error: string } {
  const phone = normalizePhone(typeof body.phone === "string" ? body.phone : "");
  if (!phone) {
    return {
      error: "Enter a 10-digit US number, or include a country code (e.g. +44…).",
    };
  }
  return { phone };
}

function discordValues(
  body: Record<string, unknown>,
): { webhookUrl: string } | { error: string } {
  const raw = typeof body.webhookUrl === "string" ? body.webhookUrl : "";
  const parsed = parseDiscordWebhook(raw);
  if (!parsed) {
    return {
      error:
        "Paste a Discord webhook URL from the channel's Settings → Integrations → Webhooks.",
    };
  }
  // The normalized form is stored, so the same channel added twice — once via
  // discordapp.com, once via discord.com — collides on the unique index instead
  // of quietly doubling every digest.
  return { webhookUrl: parsed.url };
}
