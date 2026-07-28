// Sends one message to a phone number to prove the Spectrum line works.
//
//   bun src/test-send.ts +15714619323
//
// Separate from poll.ts because a real alert only fires when a genuinely new
// posting appears, which is not something you can wait around for when you just
// want to know whether delivery is wired up.

import { createMessenger } from "./send.ts";

const phone = process.argv[2];
if (!phone?.startsWith("+")) {
  console.error("usage: bun src/test-send.ts +15714619323   (E.164, leading +)");
  process.exit(1);
}

const messenger = createMessenger();
try {
  await messenger.send(
    phone,
    [
      "Internship alerts are wired up.",
      "",
      "This is a one-off test — real alerts arrive as a digest whenever new internship or co-op postings show up.",
      "",
      "Reply STOP to turn these off.",
    ].join("\n"),
  );
  console.log(`sent to ${phone}`);
} catch (err) {
  console.error("send failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await messenger.close();
}
