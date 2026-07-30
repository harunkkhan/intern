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
import time

from extract import extract_generic, extract_with_selectors
from fetch import FetchError, close_browser, fetch_http, fetch_rendered
from registry import BY_NAME

# Below this, an HTTP response is treated as not carrying the real listing set and
# the browser is tried instead.
MIN_ROWS = 3
# Pause between pages of a paginated source, so a twenty-page sweep doesn't look
# like an attack to the host's WAF.
PAGE_DELAY_SECONDS = 2.0


def scrape(company: dict, url: str | None = None, render: str | None = None) -> list[dict]:
    # The caller (the poller) passes the URL discovery actually resolved; the
    # registry value is only a fallback for running this by hand.
    url = url or company.get("careers_url")
    if not url:
        raise FetchError(
            f"{company['name']} has no careers_url — run discover.py first"
        )

    if render is None:
        render = "always" if company.get("needs_render") else "auto"

    def parse(html: str, base: str) -> list[dict]:
        return (
            extract_with_selectors(html, base, company["selectors"])
            if company.get("selectors")
            else extract_generic(html, base)
        )

    def fetch_one(page_url: str) -> list[dict]:
        if render == "always":
            return parse(fetch_rendered(page_url, company.get("wait_selector")), page_url)
        status, body = fetch_http(page_url)
        if status >= 400 and render == "never":
            raise FetchError(f"HTTP {status}")
        rows = parse(body, page_url) if status < 400 else []
        # Escalate on what was actually extracted, not on how much visible text
        # the page had. careers.roblox.com serves 356 KB containing nine real job
        # links but almost no prose, so a text-length heuristic calls it a shell
        # and sends it to a browser that then times out — failing a page that had
        # already succeeded.
        if len(rows) < MIN_ROWS and render != "never":
            rows = parse(fetch_rendered(page_url, company.get("wait_selector")), page_url)
        return rows

    # Paginated listings, e.g. NSF's REU search: 492 sites at 25 per page. Stops
    # early when a page adds nothing new, so the page count is an upper bound
    # rather than a fixed cost.
    pages = int(company.get("pages") or 1)
    page_param = company.get("page_param") or "page"
    rows: list[dict] = []
    seen: set[str] = set()
    for page in range(pages):
        # Pace paginated rendering. NSF sits behind an AWS WAF that starts
        # answering with empty pages when twenty browser loads arrive back to
        # back, which reads downstream as "markup changed" rather than
        # "rate limited".
        if page:
            time.sleep(PAGE_DELAY_SECONDS)
        page_url = url
        if page:
            joiner = "&" if "?" in url else "?"
            page_url = f"{url}{joiner}{page_param}={page}"
        added = 0
        for row in fetch_one(page_url):
            if row["url"] in seen:
                continue
            seen.add(row["url"])
            rows.append(row)
            added += 1
        if page and added == 0:
            break
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
    ap.add_argument("--url", help="listing page, overriding the registry")
    ap.add_argument("--render", choices=["auto", "always", "never"])
    args = ap.parse_args()

    company = BY_NAME.get(args.company)
    if not company:
        print(f"unknown company: {args.company}", file=sys.stderr)
        return 1

    try:
        json.dump(scrape(company, url=args.url, render=args.render), sys.stdout)
        print()
        return 0
    except FetchError as e:
        print(str(e), file=sys.stderr)
        return 1
    finally:
        close_browser()


if __name__ == "__main__":
    raise SystemExit(main())
