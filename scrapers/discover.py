"""Classify each company's career page so it lands on the right code path.

    python scrapers/discover.py --tier-limit 20
    python scrapers/discover.py --company Databricks --verbose

For each company this finds the URL that actually holds postings and reports
where the apply links point. That determines the strategy:

  own-domain links  -> scrape it; there is no API to read, so Playwright +
                       BeautifulSoup is the only route (e.g. Databricks).
  greenhouse/ashby/ -> the page is a front-end for that ATS. Reading its JSON
  lever/workday        returns the same postings for a fraction of the cost, and
                       scraping the wrapper yields those same ATS URLs anyway.

Output is JSON on stdout so it can be fed straight into source configuration.
"""

from __future__ import annotations

import argparse
import json
import sys

from extract import ats_board, external_hosts, extract_generic
from fetch import FetchError, close_browser, fetch_http, fetch_rendered
from registry import BY_NAME, COMPANIES, candidate_urls

# Hosts that mean "this page is an ATS front-end", mapped to the adapter that
# reads that ATS directly.
ATS_HOSTS = {
    "boards.greenhouse.io": "greenhouse",
    "job-boards.greenhouse.io": "greenhouse",
    "jobs.ashbyhq.com": "ashby",
    "jobs.lever.co": "lever",
    "jobs.smartrecruiters.com": "smartrecruiters",
}


def classify(hosts: dict[str, int]) -> tuple[str, str | None]:
    """Return (strategy, ats_name). strategy is "scrape" or "ats"."""
    if not hosts:
        return "scrape", None
    external = {h: n for h, n in hosts.items() if h != "(own domain)"}
    own = hosts.get("(own domain)", 0)

    best_ats, best_n = None, 0
    for host, n in external.items():
        for known, adapter in ATS_HOSTS.items():
            if host.endswith(known) and n > best_n:
                best_ats, best_n = adapter, n
    if "myworkdayjobs.com" in " ".join(external) and best_n == 0:
        best_ats, best_n = "workday", max(external.values(), default=0)

    # Only call it an ATS front-end when the ATS carries most of the links.
    if best_ats and best_n >= max(own, 1):
        return "ats", best_ats
    return "scrape", None


def probe(company: dict, verbose: bool = False) -> dict:
    name = company["name"]
    attempts: list[dict] = []

    # Companies with no public job board at all. Recorded explicitly so they read
    # as a known dead end rather than as a scraper that needs fixing.
    if company.get("unavailable"):
        return {"name": name, "careers_url": None, "job_links": 0,
                "strategy": "unavailable", "ats": None,
                "note": company["unavailable"]}

    # A known board short-circuits probing. Several of these companies front their
    # ATS with a marketing page that never lists roles, so there is no listing
    # page to find — the board is the answer.
    if company.get("ats"):
        board = company["ats"]
        return {"name": name,
                "careers_url": company.get("careers_url"),
                "job_links": 0, "hosts": {}, "needs_render": False,
                "strategy": "ats", "ats": board["adapter"], "board": board,
                "sample": [], "note": "board pinned in registry"}

    for url in candidate_urls(company):
        best: dict | None = None

        def consider(html: str, rendered: bool) -> dict:
            jobs = extract_generic(html, url)
            hosts = external_hosts(html, url)
            attempts.append(
                {"url": url, "rendered": rendered, "jobs": len(jobs), "hosts": hosts}
            )
            if verbose:
                tag = "render" if rendered else "http"
                print(
                    f"    {url} [{tag}] -> {len(jobs)} jobs, hosts={hosts}",
                    file=sys.stderr,
                )
            return {
                "job_links": len(jobs),
                "hosts": hosts,
                "needs_render": rendered,
                "board": ats_board(html, url),
                "sample": [j["title"][:70] for j in jobs[:3]],
            }

        # Cheap HTTP first. Most candidate paths simply don't exist, and starting
        # a browser for a 404 is what made a full sweep take hours.
        try:
            status, body = fetch_http(url)
        except FetchError as e:
            attempts.append({"url": url, "error": str(e)})
            if verbose:
                print(f"    {url} [http] -> {e}", file=sys.stderr)
            continue

        # 403/429 is bot protection, which a real browser often satisfies, so
        # those are still worth rendering. Any other 4xx/5xx means there is no
        # page here and rendering would be pointless.
        blocked = status in (401, 403, 429)
        if status >= 400 and not blocked:
            attempts.append({"url": url, "http_status": status})
            if verbose:
                print(f"    {url} [http] -> HTTP {status}, skipping", file=sys.stderr)
            continue

        if not blocked:
            best = consider(body, rendered=False)
            if best["job_links"] >= 3:
                # HTTP was enough; no reason to pay for a browser.
                strategy, ats = classify(best["hosts"])
                return {
                    "name": name, "careers_url": url,
                    "job_links": best["job_links"], "hosts": best["hosts"],
                    "needs_render": False, "strategy": strategy, "ats": ats,
                    "board": best["board"] if strategy == "ats" else None,
                    "sample": best["sample"],
                }

        # The page exists but HTTP didn't yield a posting list — either it was
        # blocked, or the listings are client-rendered (Databricks ships 737 KB of
        # text and zero postings). This is where the browser earns its cost.
        try:
            rendered_html = fetch_rendered(url)
        except FetchError as e:
            attempts.append({"url": url, "rendered": True, "error": str(e)})
            if verbose:
                print(f"    {url} [render] -> {e}", file=sys.stderr)
            continue
        candidate = consider(rendered_html, rendered=True)
        if best is None or candidate["job_links"] > best["job_links"]:
            best = candidate

        # A page with a real posting list, not a marketing landing page.
        if best and best["job_links"] >= 3:
            strategy, ats = classify(best["hosts"])
            return {
                "name": name,
                "careers_url": url,
                "job_links": best["job_links"],
                "hosts": best["hosts"],
                "needs_render": best["needs_render"],
                "strategy": strategy,
                "ats": ats,
                # Ready-to-use adapter config when the page fronts an ATS, so
                # registration doesn't need a manual board-slug lookup.
                "board": best["board"] if strategy == "ats" else None,
                "sample": best["sample"],
            }

    return {"name": name, "careers_url": None, "job_links": 0,
            "strategy": "unresolved", "ats": None, "attempts": attempts[-3:]}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--company", action="append", help="company name (repeatable)")
    ap.add_argument("--limit", type=int, help="only probe the first N companies")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    if args.company:
        targets = []
        for n in args.company:
            if n not in BY_NAME:
                print(f"unknown company: {n}", file=sys.stderr)
                return 1
            targets.append(BY_NAME[n])
    else:
        targets = COMPANIES[: args.limit] if args.limit else COMPANIES

    results = []
    try:
        for company in targets:
            print(f"  probing {company['name']}…", file=sys.stderr)
            results.append(probe(company, args.verbose))
    finally:
        close_browser()

    json.dump(results, sys.stdout, indent=2)
    print()

    counts: dict[str, int] = {}
    for r in results:
        counts[r["strategy"]] = counts.get(r["strategy"], 0) + 1
    print(
        "\n  " + "  ".join(f"{k}={v}" for k, v in sorted(counts.items())),
        file=sys.stderr,
    )
    for r in results:
        if r["strategy"] == "unresolved":
            print(f"    unresolved: {r['name']}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
