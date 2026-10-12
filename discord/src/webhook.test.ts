import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createPoster } from "./webhook.ts";

const URL_ =
  "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-abcdefghij";
const realFetch = globalThis.fetch;

function capture(): { allowed: unknown[] } {
  const seen = { allowed: [] as unknown[] };
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    seen.allowed.push(JSON.parse(String(init?.body)).allowed_mentions);
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  return seen;
}

describe("allowed_mentions", () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("stays locked down by default", async () => {
    const seen = capture();
    await createPoster().post(URL_, "hi @everyone");
    assert.deepEqual(seen.allowed, [{ parse: [], roles: [] }]);
  });

  it("permits everyone only when asked", async () => {
    const seen = capture();
    await createPoster().post(URL_, "@everyone hi", {
      mentionRoleIds: ["123456789012345678"],
      mentionEveryone: true,
    });
    assert.deepEqual(seen.allowed, [
      { parse: ["everyone"], roles: ["123456789012345678"] },
    ]);
  });
});
