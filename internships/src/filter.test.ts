import { describe, expect, test } from "bun:test";
import {
  filterListing,
  graduateOnly,
  termOrdinal,
  type FilterVerdict,
} from "./filter.ts";
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

describe("graduateOnly", () => {
  test("drops titles restricted to graduate students", () => {
    for (const title of [
      "Software Engineering Intern - PhD",
      "Ph.D. Research Intern",
      "Quantitative Master's Intern",
      "Quantitative Master\u2019s Internship",
      "Software Engineering Intern, Masters",
      "M.S. Software Intern",
      "MS Intern - Machine Learning",
      "MBA Product Intern",
      "JD Legal Intern",
      "Doctoral Research Intern",
      "Postdoc Research Intern",
      "Graduate Student Researcher",
      "Grad Student Intern",
      "Graduate Intern",
      "Graduate Engineer Intern",
      "Systems Engineering Intern (Graduate)",
    ]) {
      expect(graduateOnly(title, null), title).toBe(true);
    }
  });

  test("keeps titles that also admit undergrads", () => {
    for (const title of [
      "Research Intern - BS/MS",
      "Research Intern - BS/MS/PhD",
      "B.S./M.S. Engineering Intern",
      "Intern - Bachelor's or Master's",
      "Undergraduate/Graduate Intern",
      "Undergrad & Grad Research Intern",
      "Undergraduate Intern",
    ]) {
      expect(graduateOnly(title, null), title).toBe(false);
    }
  });

  test("ignores look-alikes", () => {
    for (const title of [
      "Software Engineer Intern",
      "Scrum Master Intern",
      "Master Data Management Intern",
      "Microsoft Intern",
      "MS Office Support Intern",
      "Operations Intern - Jackson, MS",
      "Intern - Baltimore, MD",
      "Pre-Doctoral Research Intern",
      "Intern (Graduating 2027)",
      "Recent Graduate Intern",
      "University Graduate Intern",
      "Graduate Rotational Program Intern",
      "Atmospheric Programs Intern",
    ]) {
      expect(graduateOnly(title, null), title).toBe(false);
    }
  });

  test("structured degrees decide when present", () => {
    expect(graduateOnly("Software Engineer Intern", ["PhD"])).toBe(true);
    expect(graduateOnly("Software Engineer Intern", ["Master's", "PhD"])).toBe(true);
    expect(graduateOnly("Software Engineer Intern", ["MBA"])).toBe(true);
    expect(graduateOnly("Data Intern - BS/MS", ["Master's"])).toBe(false);
    expect(graduateOnly("Technician Intern", ["Associate's"])).toBe(false);
  });

  test("an explicit graduate degree in the title beats the tags", () => {
    expect(
      graduateOnly("Software Engineer Intern - MS/PhD", ["Bachelor's", "Master's", "PhD"]),
    ).toBe(true);
    expect(graduateOnly("Applied Scientist PhD Intern", ["Bachelor's"])).toBe(true);
    expect(graduateOnly("Research Intern - BS/MS/PhD", ["Bachelor's", "Master's", "PhD"])).toBe(
      false,
    );
    expect(graduateOnly("Research Intern - BS/MS/PhD", null)).toBe(false);
  });

  test("a bare Graduate defers to the tags when they name a degree", () => {
    expect(graduateOnly("Technical Graduate Intern", ["Bachelor's"])).toBe(false);
    expect(graduateOnly("Graduate Intern", ["Master's"])).toBe(true);
    expect(graduateOnly("Graduate Intern", null)).toBe(true);
    expect(graduateOnly("Graduate Intern", [])).toBe(true);
  });

  test("falls back to the title when degrees are empty or non-degree", () => {
    expect(graduateOnly("PhD Intern", [])).toBe(true);
    expect(graduateOnly("PhD Intern", ["Certificate"])).toBe(true);
    expect(graduateOnly("Software Intern", [])).toBe(false);
  });

  test("filterListing reports graduate-only", () => {
    const listing: RawListing = {
      externalId: "1",
      company: "Acme",
      title: "Machine Learning Intern",
      url: "https://example.com/1",
      locations: null,
      term: "Summer 2027",
      sponsorship: null,
      category: null,
      postedAt: null,
      degrees: ["Master's"],
    };
    expect(filterListing(listing, options)).toEqual({ keep: false, reason: "graduate-only" });
    expect(filterListing({ ...listing, degrees: ["Bachelor's", "Master's"] }, options)).toEqual(KEEP);
  });
});
