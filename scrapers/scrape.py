"""Scrape one company's career page and emit listings as JSON on stdout.

    python scrapers/scrape.py --company Databricks

This process only fetches and parses. Filtering (internship/co-op, term floor,
disqualifying titles), deduplication and delivery all stay in the TypeScript
poller, so there is exactly one implementation of those rules rather than one per
language.

Records match the RawListing shape the poller expects; `term` is left null
because the poller parses terms from titles itself.
"""

from __future__ import annotations

import argparse
import json
import sys

from extract import extract_generic, extract_with_selectors
from fetch import FetchError, close_browser, get_html
from registry import BY_NAME


def scrape(company: dict) -> list[dict]:
    url = company.get("careers_url")
    if not url:
        raise FetchError(
            f"{company['name']} has no careers_url — run discover.py first"
        )

    # "auto" would guess; the registry records what discovery actually measured.
    render = "always" if company.get("needs_render") else "auto"
    html = get_html(url, render=render, wait_selector=company.get("wait_selector"))

    rows = (
        extract_with_selectors(html, url, company["selectors"])
        if company.get("selectors")
        else extract_generic(html, url)
    )
    if not rows:
        # An empty result is indistinguishable from "no open roles", and would
        # deactivate every listing this source has. Fail loudly instead.
        raise FetchError(
            f"no postings parsed from {url} — page markup probably changed"
        )

    out = []
    for r in rows:
        out.append(
            {
                # The canonical posting URL is the most stable id a scraped page
                # offers; slugs and ids move, but the apply link is the posting.
                "externalId": r["url"],
                "company": company["name"],
                "title": r["title"],
                "url": r["url"],
                "locations": r.get("locations"),
                "term": None,
                "sponsorship": None,
                "category": None,
                "postedAt": None,
            }
        )
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--company", required=True)
    args = ap.parse_args()

    company = BY_NAME.get(args.company)
    if not company:
        print(f"unknown company: {args.company}", file=sys.stderr)
        return 1

    try:
        json.dump(scrape(company), sys.stdout)
        print()
        return 0
    except FetchError as e:
        print(str(e), file=sys.stderr)
        return 1
    finally:
        close_browser()


if __name__ == "__main__":
    raise SystemExit(main())
