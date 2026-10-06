import { describe, expect, test } from "bun:test";
import {
  classifyLocation,
  mayBeInUs,
  titleLooksCanadian,
  type Region,
} from "./location.ts";

const cases: [string, Region][] = [
  ["San Francisco, CA", "us"],
  ["US, CA, Santa Clara", "us"],
  ["Bellevue, Washington", "us"],
  ["New York, NY", "us"],
  ["NYC", "us"],
  ["SF Bay Area", "us"],
  ["United States", "us"],
  ["Remote - US", "us"],
  ["Remote - North America", "us"],
  ["North America", "us"],
  ["Remote in US or Canada", "us"],
  ["US/Canada", "us"],
  ["Ontario, CA", "us"],
  ["Ontario, California", "us"],
  ["Waterloo, IA", "us"],
  ["New Brunswick, NJ", "us"],
  ["Vancouver, WA", "us"],
  ["Cambridge, MA", "us"],
  ["Toronto, ON, CA", "canada"],
  ["Toronto, CA", "canada"],
  ["Canada (CA)", "canada"],
  ["Canada", "canada"],
  ["Remote - Canada", "canada"],
  ["Remote in Canada", "canada"],
  ["Vancouver, BC", "canada"],
  ["Montréal, QC", "canada"],
  ["Montreal", "canada"],
  ["Quebec City", "canada"],
  ["Waterloo", "canada"],
  ["Ottawa", "canada"],
  ["Kitchener", "canada"],
  ["Toronto, Ontario, Canada", "canada"],
  ["London, ON", "canada"],
  ["London, Ontario, CA", "canada"],
  ["Cambridge, ON", "canada"],
  ["Kingston, Ontario", "canada"],
  ["Hamilton, ON", "canada"],
  ["Windsor, Canada", "canada"],
  ["Victoria, BC", "canada"],
  ["London, UK", "foreign"],
  ["London", "foreign"],
  ["Bangalore", "foreign"],
  ["Costa Rica", "foreign"],
  ["Remote", "unknown"],
  ["Multiple Locations", "unknown"],
  ["3 Locations", "unknown"],
  ["Flexible - Any Site", "unknown"],
  ["Vancouver", "unknown"],
  ["Cambridge", "unknown"],
  ["Kingston", "unknown"],
  ["Hamilton", "unknown"],
  ["Windsor", "unknown"],
  ["Victoria", "unknown"],
  ["", "unknown"],
];

describe("classifyLocation", () => {
  for (const [raw, region] of cases) {
    test(`"${raw}" is ${region}`, () => {
      expect(classifyLocation(raw)).toBe(region);
    });
  }
});

describe("mayBeInUs", () => {
  test("missing or empty locations pass", () => {
    expect(mayBeInUs(null)).toBe(true);
    expect(mayBeInUs(undefined)).toBe(true);
    expect(mayBeInUs([])).toBe(true);
    expect(mayBeInUs(["  "])).toBe(true);
  });

  test("all-unknown lists pass", () => {
    expect(mayBeInUs(["Remote", "Multiple Locations"])).toBe(true);
  });

  test("a US part keeps the posting", () => {
    expect(mayBeInUs(["Toronto, ON", "New York, NY"])).toBe(true);
    expect(mayBeInUs(["London, UK; Austin, TX"])).toBe(true);
    expect(mayBeInUs(["Vancouver, BC / Seattle, WA"])).toBe(true);
  });

  test("an unknown part keeps the posting", () => {
    expect(mayBeInUs(["Toronto, ON", "Remote"])).toBe(true);
    expect(mayBeInUs(["London, UK | Flexible - Any Site"])).toBe(true);
  });

  test("Canada-only and foreign-only lists are rejected", () => {
    expect(mayBeInUs(["Toronto, ON"])).toBe(false);
    expect(mayBeInUs(["Remote - Canada"])).toBe(false);
    expect(mayBeInUs(["Waterloo; Montreal, QC"])).toBe(false);
    expect(mayBeInUs(["London, UK"])).toBe(false);
    expect(mayBeInUs(["Bangalore"])).toBe(false);
    expect(mayBeInUs(["Toronto, ON", "London, UK"])).toBe(false);
  });
});

describe("titleLooksCanadian", () => {
  test("Canadian titles", () => {
    expect(titleLooksCanadian("Software Engineering Intern (Toronto)")).toBe(true);
    expect(titleLooksCanadian("Data Science Co-op - Canada")).toBe(true);
    expect(titleLooksCanadian("Intern, Montréal")).toBe(true);
  });

  test("non-Canadian titles", () => {
    expect(titleLooksCanadian("Software Engineering Intern")).toBe(false);
    expect(titleLooksCanadian("Intern - US/Canada")).toBe(false);
    expect(titleLooksCanadian("Intern (Vancouver)")).toBe(false);
  });
});
