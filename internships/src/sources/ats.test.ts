import { afterEach, describe, expect, test } from "bun:test";
import { filterListing } from "../filter.ts";
import { dedupeKeyFor } from "../normalize.ts";
import type { RawListing } from "../types.ts";
import { dejobs, eightfold, phenom } from "./ats.ts";
import pcsxPage0 from "./fixtures/eightfold-pcsx-page0.json";
import pcsxPage1 from "./fixtures/eightfold-pcsx-page1.json";
import phenomMitre from "./fixtures/phenom-mitre.json";
import saicPage1 from "./fixtures/dejobs-saic-page1.json";
import saicPage2 from "./fixtures/dejobs-saic-page2.json";

interface Call {
  url: string;
  init: RequestInit;
}

const realFetch = globalThis.fetch;
let calls: Call[] = [];

function serve(route: (url: URL, init: RequestInit) => unknown): void {
  calls = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return Response.json(route(new URL(url), init ?? {}));
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

const ctx = { lastSha: null };
const keep = (l: RawListing) =>
  filterListing(l, { requireInternToken: true, termFloor: 2026 * 12 + 10 }).keep;

const LOCKHEED = {
  host: "lockheedmartin.eightfold.ai",
  domain: "lockheedmartin.com",
  api: "pcsx",
  company: "Lockheed Martin",
  query: "",
  filters: { level_of_experience: ["co-op/summer intern"] },
  internTitlePatterns: ["^College Student\\b"],
};

describe("eightfold pcsx", () => {
  test("paginates 10 at a time and stops at count", async () => {
    serve((url) => (url.searchParams.get("start") === "0" ? pcsxPage0 : pcsxPage1));
    const { listings } = await eightfold(LOCKHEED, ctx);

    expect(calls.map((c) => new URL(c.url).searchParams.get("start"))).toEqual(["0", "10"]);
    const first = new URL(calls[0]!.url);
    expect(first.pathname).toBe("/api/pcsx/search");
    expect(first.searchParams.get("query")).toBe("");
    expect(first.searchParams.get("filter_level_of_experience")).toBe("co-op/summer intern");
    expect(listings).toHaveLength(12);
  });

  test("stops on a short page even when count says more", async () => {
    serve(() => ({ data: { count: 500, positions: pcsxPage1.data.positions } }));
    await eightfold(LOCKHEED, ctx);
    expect(calls).toHaveLength(1);
  });

  test("builds absolute URLs that key on the position id", async () => {
    serve((url) => (url.searchParams.get("start") === "0" ? pcsxPage0 : pcsxPage1));
    const { listings } = await eightfold(LOCKHEED, ctx);
    const swe = listings.find((l) => l.externalId === "18662")!;

    expect(swe.url).toBe("https://lockheedmartin.eightfold.ai/careers/job/996477278559");
    expect(swe.company).toBe("Lockheed Martin");
    expect(swe.term).toBe("Summer 2027");
    expect(swe.postedAt).toBeInstanceOf(Date);
    expect(dedupeKeyFor(swe.company, swe.title, swe.url)).toBe(
      "eightfold:lockheedmartin:996477278559",
    );
  });

  test("College Student titles are tagged as internships and pass the filter", async () => {
    serve((url) => (url.searchParams.get("start") === "0" ? pcsxPage0 : pcsxPage1));
    const { listings } = await eightfold(LOCKHEED, ctx);
    const student = listings.find((l) => l.externalId === "17537")!;

    expect(student.title).toBe("College Student - Technical - N3 (Intern)");
    expect(keep(student)).toBe(true);
    // A title that already names the internship is left alone.
    const intern = listings.find((l) => l.externalId === "19316")!;
    expect(intern.title).toBe("Systems Engineer (Cyber) - Intern");
  });

  test("College Student rule is scoped to sources that configure it", async () => {
    serve((url) => (url.searchParams.get("start") === "0" ? pcsxPage0 : pcsxPage1));
    const { internTitlePatterns: _, ...unscoped } = LOCKHEED;
    const { listings } = await eightfold(unscoped, ctx);
    const student = listings.find((l) => l.externalId === "17537")!;

    expect(student.title).toBe("College Student - Technical - N3");
    expect(keep(student)).toBe(false);
  });

  test("standardized locations let the filter drop Canada and the UK", async () => {
    serve((url) => (url.searchParams.get("start") === "0" ? pcsxPage0 : pcsxPage1));
    const { listings } = await eightfold(LOCKHEED, ctx);
    const calgary = listings.find((l) => l.externalId === "16450")!;

    expect(calgary.locations).toEqual(["Calgary, AB, CA"]);
    expect(keep(calgary)).toBe(false);
  });

  test("rejects an unknown api", async () => {
    await expect(eightfold({ ...LOCKHEED, api: "v3" }, ctx)).rejects.toThrow(/config.api/);
  });
});

describe("phenom", () => {
  const MITRE = {
    host: "careers.mitre.org",
    lang: "en_us",
    country: "us",
    company: "MITRE",
    keywords: "intern",
  };

  test("posts a refineSearch and parses jobs", async () => {
    serve(() => phenomMitre);
    const { listings } = await phenom(MITRE, ctx);

    expect(calls).toHaveLength(1);
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(calls[0]!.url).toBe("https://careers.mitre.org/widgets");
    expect(body).toMatchObject({
      ddoKey: "refineSearch",
      lang: "en_us",
      country: "us",
      keywords: "intern",
      from: 0,
      size: 100,
      jobs: true,
    });

    const tech = listings.find((l) => l.externalId === "R117376")!;
    expect(tech.url).toBe("https://careers.mitre.org/us/en/job/R117376");
    expect(tech.title).toBe("TECH Futures Intern");
    expect(tech.postedAt?.toISOString()).toBe("2026-09-08T00:00:00.000Z");
    expect(keep(tech)).toBe(true);
    expect(keep(listings.find((l) => l.externalId === "R117614")!)).toBe(false);
  });

  test("collapses repeated locations", async () => {
    serve(() => phenomMitre);
    const { listings } = await phenom(MITRE, ctx);
    const cs = listings.find((l) => l.externalId === "R117315")!;
    expect(cs.locations).toHaveLength(27);
  });

  test("derives the path from lang, or takes pathPrefix", async () => {
    serve(() => phenomMitre);
    const bae = { ...MITRE, host: "jobs.baesystems.com", lang: "en_global", country: "global" };
    expect((await phenom(bae, ctx)).listings[0]!.url).toMatch(
      /^https:\/\/jobs\.baesystems\.com\/global\/en\/job\//,
    );
    expect((await phenom({ ...bae, pathPrefix: "/careers/" }, ctx)).listings[0]!.url).toMatch(
      /^https:\/\/jobs\.baesystems\.com\/careers\/job\//,
    );
  });

  test("pages by `from` until totalHits", async () => {
    const jobs = Array.from({ length: 100 }, (_, i) => ({ jobId: `R${i}`, title: "Intern" }));
    serve((_, init) => {
      const { from } = JSON.parse(String(init.body));
      return {
        refineSearch: {
          totalHits: 150,
          data: { jobs: from === 0 ? jobs : jobs.slice(0, 50).map((j) => ({ ...j, jobId: `S${j.jobId}` })) },
        },
      };
    });
    const { listings } = await phenom(MITRE, ctx);
    expect(calls.map((c) => JSON.parse(String(c.init.body)).from)).toEqual([0, 100]);
    expect(listings).toHaveLength(150);
  });
});

describe("dejobs", () => {
  const SAIC = { origin: "saic.dejobs.org", company: "SAIC", query: "intern" };

  test("sends x-origin and pages until has_more_pages is false", async () => {
    serve((url) => (url.searchParams.get("page") === "1" ? saicPage1 : saicPage2));
    await dejobs(SAIC, ctx);

    expect(calls.map((c) => new URL(c.url).searchParams.get("page"))).toEqual(["1", "2"]);
    expect(new Headers(calls[0]!.init.headers).get("x-origin")).toBe("saic.dejobs.org");
    expect(new URL(calls[0]!.url).searchParams.get("q")).toBe("intern");
  });

  test("merges one row per location into one listing per requisition", async () => {
    serve((url) => (url.searchParams.get("page") === "1" ? saicPage1 : saicPage2));
    const { listings } = await dejobs(SAIC, ctx);

    expect(listings).toHaveLength(4);
    const contracts = listings.find((l) => l.externalId === "2617745")!;
    expect(contracts.locations).toEqual(["Remote Work, MD", "Remote Work, VA"]);
    // The lowest guid supplies the link, whichever order the rows arrive in.
    expect(contracts.url).toBe(
      "https://saic.dejobs.org/remote-work-va/contracts-principal/7CE33DE1D7124C92AB7A67C8A956244B/job/",
    );
    expect(contracts.company).toBe("SAIC");
    expect(contracts.postedAt?.toISOString()).toBe("2026-10-10T04:09:04.000Z");
  });

  test("slugs locations the way the microsite does", async () => {
    serve(() => ({
      jobs: [
        {
          guid: "A1",
          reqid: "1",
          title_exact: "Software Intern",
          title_slug: "software-intern",
          location_exact: "St. Louis, MO",
          date_new: "2026-10-01T00:00:00Z",
        },
      ],
      pagination: { has_more_pages: false },
    }));
    const { listings } = await dejobs(SAIC, ctx);
    expect(listings[0]!.url).toBe("https://saic.dejobs.org/st-louis-mo/software-intern/A1/job/");
    expect(keep(listings[0]!)).toBe(true);
  });
});
