import { describe, expect, test } from "bun:test";
import { resolveTerm } from "./githubJson.ts";

describe("resolveTerm", () => {
  test("title term wins over a conflicting tag", () => {
    expect(
      resolveTerm({
        terms: ["Summer 2026"],
        title: "Firmware Engineer Intern - Fall 2026",
      }),
    ).toBe("Fall 2026");
  });

  test("keeps the tag when the title states no term", () => {
    expect(resolveTerm({ terms: ["Summer 2027"], title: "Software Engineer Intern" })).toBe(
      "Summer 2027",
    );
  });

  test("keeps the tag when the title agrees with it", () => {
    expect(resolveTerm({ terms: ["Fall 2026"], title: "SWE Intern (Fall 2026)" })).toBe(
      "Fall 2026",
    );
  });

  test("multi-term title matching one of several tags keeps the first tag", () => {
    expect(
      resolveTerm({
        terms: ["Summer 2027", "Fall 2027"],
        title: "Software Intern - Summer/Fall 2027",
      }),
    ).toBe("Summer 2027");
  });

  test("multi-term title uses its first parsed term when no tag matches", () => {
    expect(
      resolveTerm({
        terms: ["Summer 2026"],
        title: "Intern - Fall 2026 / Spring 2027",
      }),
    ).toBe("Fall 2026");
  });

  test("falls back to the title when tags are absent or placeholders", () => {
    expect(resolveTerm({ terms: ["N/A"], title: "Intern - Summer '27" })).toBe("Summer 2027");
    expect(resolveTerm({ title: "Intern" })).toBeNull();
  });
});
