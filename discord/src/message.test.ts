import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDigest, resolveMentionRoleId } from "./message.ts";

const ROLE = "123456789012345678";
const ENV_ROLE = "876543210987654321";

describe("resolveMentionRoleId", () => {
  it("uses the env role when the channel has none", () => {
    const sub = { mentionRoleId: null, mentionEveryone: false };
    assert.equal(resolveMentionRoleId(sub, ENV_ROLE), ENV_ROLE);
  });

  it("prefers the channel's own role over the env role", () => {
    const sub = { mentionRoleId: ROLE, mentionEveryone: false };
    assert.equal(resolveMentionRoleId(sub, ENV_ROLE), ROLE);
  });

  it("never inherits the env role on an @everyone channel", () => {
    const sub = { mentionRoleId: null, mentionEveryone: true };
    assert.equal(resolveMentionRoleId(sub, ENV_ROLE), null);
  });

  it("keeps an explicit role on an @everyone channel", () => {
    const sub = { mentionRoleId: ROLE, mentionEveryone: true };
    assert.equal(resolveMentionRoleId(sub, ENV_ROLE), ROLE);
  });

  it("returns null with nothing configured", () => {
    const sub = { mentionRoleId: null, mentionEveryone: false };
    assert.equal(resolveMentionRoleId(sub, undefined), null);
  });
});

describe("buildDigest mentions", () => {
  const listings = Array.from({ length: 60 }, (_, i) => ({
    deliveryId: `d${i}`,
    company: `Co${i % 7}`,
    title: `${"Software Engineer Intern ".repeat(3)}${i}`,
    url: `https://example.com/${i}`,
    locations: ["NYC"],
    term: "Summer 2027",
  }));

  it("pings @everyone and the role on the first message only", () => {
    const messages = buildDigest(listings, {
      mentionRoleId: ROLE,
      mentionEveryone: true,
    });
    assert.ok(messages.length > 1);
    const [first, ...rest] = messages;
    assert.ok(first!.content.startsWith(`@everyone <@&${ROLE}> `));
    assert.equal(first!.mentionEveryone, true);
    assert.deepEqual(first!.mentionRoleIds, [ROLE]);
    for (const m of rest) {
      assert.ok(!m.content.includes("@everyone"));
      assert.equal(m.mentionEveryone, false);
      assert.deepEqual(m.mentionRoleIds, []);
    }
  });

  it("does not ping @everyone unless asked", () => {
    const messages = buildDigest(listings, { mentionRoleId: ROLE });
    assert.ok(messages.every((m) => !m.mentionEveryone));
    assert.ok(messages[0]!.content.startsWith(`<@&${ROLE}> `));
  });
});
