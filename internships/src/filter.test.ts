import { describe, expect, test } from "bun:test";
import { filterListing, termOrdinal, type FilterVerdict } from "./filter.ts";
import type { RawListing } from "./types.ts";

const options = { requireInternToken: true, termFloor: termOrdinal("Fall 2026")! };

function verdict(title: string, locations: string[] | null) {
  const listing: RawListing = {
    externalId: "1",
    company: "Acme",
    title,
    url: "https://example.com/1",
    locations,
    term: "Summer 2027",
    sponsorship: null,
    category: null,
    postedAt: null,
  };
  return filterListing(listing, options);
}

const KEEP: FilterVerdict = { keep: true };
const LOCATION: FilterVerdict = { keep: false, reason: "location" };

describe("filterListing location rule", () => {
  test("keeps US, region-wide and unknown locations", () => {
    expect(verdict("Software Intern", ["San Francisco, CA"])).toEqual(KEEP);
    expect(verdict("Software Intern", ["Remote - North America"])).toEqual(KEEP);
    expect(verdict("Software Intern", ["Remote in US or Canada"])).toEqual(KEEP);
    expect(verdict("Software Intern", ["Ontario, CA"])).toEqual(KEEP);
    expect(verdict("Software Intern", null)).toEqual(KEEP);
    expect(verdict("Software Intern", [])).toEqual(KEEP);
    expect(verdict("Software Intern", ["Remote"])).toEqual(KEEP);
    expect(verdict("Software Intern", ["4 Locations"])).toEqual(KEEP);
    expect(verdict("Software Intern", ["Vienna, VA"])).toEqual(KEEP);
    expect(verdict("Software Intern", ["Rome, NY"])).toEqual(KEEP);
  });

  test("keeps mixed lists with a US or unknown part", () => {
    expect(verdict("Software Intern", ["Toronto, ON", "Austin, TX"])).toEqual(KEEP);
    expect(verdict("Software Intern", ["Toronto, ON", "Remote"])).toEqual(KEEP);
  });

  test("rejects Canada-only and foreign-only lists", () => {
    expect(verdict("Software Intern", ["Toronto, ON, CA"])).toEqual(LOCATION);
    expect(verdict("Software Intern", ["Vancouver, BC"])).toEqual(LOCATION);
    expect(verdict("Software Intern", ["Remote - Canada"])).toEqual(LOCATION);
    expect(verdict("Software Intern", ["London, UK"])).toEqual(LOCATION);
    expect(verdict("Software Intern", ["Bangalore"])).toEqual(LOCATION);
    expect(verdict("Software Intern", ["Toronto, ON", "London, UK"])).toEqual(LOCATION);
  });

  test("rejects Canadian titles unless a location is in the US", () => {
    expect(verdict("Software Intern (Toronto)", null)).toEqual(LOCATION);
    expect(verdict("Software Intern - Canada", ["Remote"])).toEqual(LOCATION);
    expect(verdict("Software Intern (Toronto)", ["New York, NY"])).toEqual(KEEP);
    expect(verdict("Software Intern - US/Canada", null)).toEqual(KEEP);
  });

  test("rejects foreign titles", () => {
    expect(verdict("Quant Intern (Singapore)", null)).toEqual(LOCATION);
  });
});
