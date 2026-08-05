// Posts one message to a webhook to prove the channel is wired up.
//
//   bun src/test-send.ts https://discord.com/api/webhooks/123.../abc...
//
// Separate from send-alerts.ts because a real alert only fires when a genuinely
// new posting appears, which is not something you can wait around for when you
// just want to know whether delivery works. Touches no database rows.

import { createPoster } from "./webhook.ts";
import { parseDiscordWebhook } from "../../src/lib/discordWebhook.ts";

const raw = process.argv[2];
const parsed = raw ? parseDiscordWebhook(raw) : null;
if (!parsed) {
  console.error(
    "usage: bun src/test-send.ts https://discord.com/api/webhooks/<id>/<token>\n" +
      "(copy it from the channel's Settings → Integrations → Webhooks)",
  );
  process.exit(1);
}

const poster = createPoster();
try {
  await poster.post(
    parsed.url,
    [
      "**Internship alerts are wired up.**",
      "",
      "This is a one-off test — real alerts arrive as a digest whenever new internship or co-op postings show up.",
    ].join("\n"),
  );
  console.log(`posted to webhook ${parsed.id}`);
} catch (err) {
  console.error("post failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
