// Last-resort adapter for companies on a bespoke careers page with no JSON API.
//
// Prefer an ATS adapter whenever one applies: those diff stable ids, whereas
// this diffs whatever the markup happens to expose, so a redesign can either
// silently stop matching or fire a burst of false "new" postings. The external
// id is derived from the link href, which is the most stable thing on the page.
//
// config: {
//   url, itemSelector, company,
//   titleSelector?, linkSelector?, locationSelector?, baseUrl?
// }

import * as cheerio from "cheerio";
import { getText } from "../http.ts";
import { termFromTitle } from "../normalize.ts";
import {
  optionalString,
  requireString,
  type Adapter,
  type RawListing,
} from "../types.ts";

export const html: Adapter = async (config) => {
  const url = requireString(config, "url");
  const itemSelector = requireString(config, "itemSelector");
  const company = requireString(config, "company");
  const titleSelector = optionalString(config, "titleSelector");
  const linkSelector = optionalString(config, "linkSelector");
  const locationSelector = optionalString(config, "locationSelector");
  const baseUrl = optionalString(config, "baseUrl") ?? url;

  const $ = cheerio.load(await getText(url));
  const listings: RawListing[] = [];
  const seen = new Set<string>();

  $(itemSelector).each((_, element) => {
    const item = $(element);
    const title = (titleSelector ? item.find(titleSelector) : item)
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim();
    const href = (linkSelector ? item.find(linkSelector) : item)
      .filter("a")
      .add(item.find("a"))
      .first()
      .attr("href");
    if (!title || !href) return;

    let absolute: string;
    try {
      absolute = new URL(href, baseUrl).toString();
    } catch {
      return;
    }
    if (seen.has(absolute)) return;
    seen.add(absolute);

    const location = locationSelector
      ? item.find(locationSelector).first().text().replace(/\s+/g, " ").trim()
      : "";

    listings.push({
      externalId: absolute,
      company,
      title,
      url: absolute,
      locations: location ? [location] : null,
      term: termFromTitle(title),
      sponsorship: null,
      category: null,
      postedAt: null,
    });
  });

  if (listings.length === 0) {
    // A selector that matches nothing looks identical to "no open roles", and
    // would quietly deactivate every listing this source had. Fail loudly.
    throw new Error(
      `itemSelector "${itemSelector}" matched no rows at ${url} — the page markup probably changed`,
    );
  }
  return { listings };
};
