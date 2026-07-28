"""Capture the JSON a careers page fetches for itself.

    python scrapers/sniff.py --company Apple --verbose

Some companies run entirely in-house recruiting stacks: no public board API, and
listings rendered into elements that are not links, so neither an ATS adapter nor
DOM extraction finds anything. Their pages do fetch their jobs from somewhere,
though — and those endpoints reject plain HTTP clients (Apple answers 401 without
a session, Meta 400, Uber 406) while answering a real browser perfectly.

So let the browser make the request and read the response. Playwright already has
the session, the cookies and the headers the endpoint wants; this listens for JSON
responses and looks for the array of postings inside them. It works regardless of
which stack the company runs, because it observes what the page actually loads
rather than assuming a shape.
"""

from __future__ import annotations

import argparse
import json
import re
import sys

from fetch import USER_AGENT, close_browser, _get_browser

# Keys that mark an object as a job posting rather than a nav item or a facet.
TITLE_KEYS = ("title", "name", "positionName", "jobTitle", "postingTitle", "text")
ID_KEYS = ("id", "jobId", "reqId", "requisitionId", "positionId", "ats_job_id",
           "externalPath", "slug", "url", "applyUrl", "canonicalPositionUrl")

# An endpoint returning fewer than this is probably facets or a single record.
MIN_ROWS = 3
# How long to let the page issue its XHRs after DOMContentLoaded.
SETTLE_MS = 9000


def _looks_like_jobs(rows: list) -> bool:
    if len(rows) < MIN_ROWS or not isinstance(rows[0], dict):
        return False
    keys = set()
    for row in rows[:5]:
        if isinstance(row, dict):
            keys |= set(row.keys())
    has_title = any(k in keys for k in TITLE_KEYS)
    has_id = any(k in keys for k in ID_KEYS)
    return has_title and has_id


def find_job_arrays(data, path: str = "") -> list[tuple[str, list]]:
    """Every array in the payload that looks like a list of postings."""
    out: list[tuple[str, list]] = []
    if isinstance(data, list):
        if _looks_like_jobs(data):
            out.append((path or "$", data))
        else:
            for i, item in enumerate(data[:3]):
                out.extend(find_job_arrays(item, f"{path}[{i}]"))
    elif isinstance(data, dict):
        for key, value in data.items():
            out.extend(find_job_arrays(value, f"{path}.{key}" if path else key))
    return out


def sniff(url: str, verbose: bool = False) -> list[dict]:
    browser = _get_browser()
    ctx = browser.new_context(user_agent=USER_AGENT,
                              viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    seen: list[dict] = []

    def on_response(response) -> None:
        try:
            if response.status >= 400:
                return
            ctype = (response.headers or {}).get("content-type", "")
            if "json" not in ctype.lower():
                return
            body = response.text()
            if len(body) < 200:
                return
            data = json.loads(body)
        except Exception:
            # Bodies can be gone by the time we ask, or not be JSON after all.
            return

        for path, rows in find_job_arrays(data):
            seen.append({
                "endpoint": response.url,
                "method": response.request.method,
                "json_path": path,
                "rows": len(rows),
                "keys": sorted(rows[0].keys())[:12],
                "sample": [
                    str(r.get(next((k for k in TITLE_KEYS if k in r), ""), ""))[:70]
                    for r in rows[:3]
                ],
            })

    page.on("response", on_response)
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=45000)
        page.wait_for_timeout(SETTLE_MS)
        # Many portals only fetch after a scroll or a search submit.
        try:
            page.mouse.wheel(0, 4000)
            page.wait_for_timeout(3000)
        except Exception:
            pass
    except Exception as e:
        if verbose:
            print(f"    navigation: {type(e).__name__}: {str(e)[:60]}", file=sys.stderr)
    finally:
        page.close()
        ctx.close()

    # Best endpoint per URL, largest row count first.
    best: dict[str, dict] = {}
    for hit in seen:
        key = re.sub(r"\d{3,}", "N", hit["endpoint"].split("?")[0])
        if key not in best or hit["rows"] > best[key]["rows"]:
            best[key] = hit
    return sorted(best.values(), key=lambda h: -h["rows"])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", action="append", required=True)
    ap.add_argument("--label", action="append")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    results = []
    try:
        for i, url in enumerate(args.url):
            label = (args.label or [])[i] if args.label and i < len(args.label) else url
            print(f"\n  === {label}", file=sys.stderr)
            hits = sniff(url, args.verbose)
            if not hits:
                print("      no job JSON observed", file=sys.stderr)
            for h in hits[:3]:
                print(f"      {h['rows']:5} rows  {h['method']} {h['endpoint'][:88]}",
                      file=sys.stderr)
                print(f"            path={h['json_path']}  keys={h['keys'][:7]}",
                      file=sys.stderr)
                for s in h["sample"]:
                    if s:
                        print(f"            * {s}", file=sys.stderr)
            results.append({"label": label, "url": url, "hits": hits})
    finally:
        close_browser()

    json.dump(results, sys.stdout, indent=2)
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
