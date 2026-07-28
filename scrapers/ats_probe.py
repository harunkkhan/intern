"""Find a company's ATS board by trying candidate slugs against the board APIs.

    python scrapers/ats_probe.py --unresolved discovery.json

Discovery classifies a company by the links on its careers page, which fails
whenever that page renders its listings without anchors, hides them behind
interaction, or is a pure marketing wrapper. But the board underneath usually
still exists and is addressable — so rather than fighting the page, guess the
slug and ask the API.

Cheap: one JSON request per candidate, no browser. A hit is only accepted when the
board returns actual postings, so a slug that happens to resolve to an empty or
unrelated board is not mistaken for a match.
"""

from __future__ import annotations

import argparse
import json
import re
import sys

from fetch import FetchError, fetch_http
from registry import BY_NAME, COMPANIES


def candidate_slugs(company: dict) -> list[str]:
    name = company["name"]
    # Drop parenthetical qualifiers: "Block (Cash App)" -> "Block".
    base = re.sub(r"\s*\([^)]*\)", "", name).strip()
    domain_root = company["domain"].split(".")[0]

    raw = {
        re.sub(r"[^a-z0-9]", "", base.lower()),
        re.sub(r"[^a-z0-9]+", "-", base.lower()).strip("-"),
        domain_root.lower(),
        # Trading firms often append their legal suffix to the board slug, which
        # is how Five Rings ends up as "fiveringsllc".
        re.sub(r"[^a-z0-9]", "", base.lower()) + "llc",
        re.sub(r"[^a-z0-9]", "", base.lower()) + "inc",
    }
    return [s for s in raw if len(s) >= 3]


# Each entry: url template, and a function pulling the posting count out of the
# response so an empty board can be told apart from a real one.
PROVIDERS = [
    (
        "greenhouse",
        "https://boards-api.greenhouse.io/v1/boards/{slug}/jobs",
        lambda d: len(d.get("jobs", [])) if isinstance(d, dict) else 0,
        lambda slug: {"board": slug},
    ),
    (
        "ashby",
        "https://api.ashbyhq.com/posting-api/job-board/{slug}",
        lambda d: len(d.get("jobs", [])) if isinstance(d, dict) else 0,
        lambda slug: {"board": slug},
    ),
    (
        "lever",
        "https://api.lever.co/v0/postings/{slug}?mode=json",
        lambda d: len(d) if isinstance(d, list) else 0,
        lambda slug: {"company": slug},
    ),
    (
        "smartrecruiters",
        "https://api.smartrecruiters.com/v1/companies/{slug}/postings?limit=1",
        lambda d: d.get("totalFound", 0) if isinstance(d, dict) else 0,
        lambda slug: {"company": slug},
    ),
]

# A real company board has more than a couple of postings; a handful usually means
# a stale or same-named board belonging to somebody else.
MIN_POSTINGS = 3


def probe(company: dict, verbose: bool = False) -> dict | None:
    for slug in candidate_slugs(company):
        for adapter, template, count_of, config_of in PROVIDERS:
            url = template.format(slug=slug)
            try:
                status, body = fetch_http(url)
            except FetchError:
                continue
            if status != 200:
                continue
            try:
                data = json.loads(body)
            except json.JSONDecodeError:
                continue
            n = count_of(data)
            if verbose and n:
                print(f"    {adapter}/{slug} -> {n} postings", file=sys.stderr)
            if n >= MIN_POSTINGS:
                return {
                    "adapter": adapter,
                    "config": config_of(slug),
                    "postings": n,
                    "slug": slug,
                }
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--unresolved", help="discovery.json; probe only its failures")
    ap.add_argument("--company", action="append")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    if args.company:
        targets = [BY_NAME[n] for n in args.company if n in BY_NAME]
    elif args.unresolved:
        names = {
            r["name"]
            for r in json.load(open(args.unresolved))
            if r["strategy"] == "unresolved"
        }
        targets = [c for c in COMPANIES if c["name"] in names]
    else:
        targets = COMPANIES

    found = []
    for company in targets:
        hit = probe(company, args.verbose)
        if hit:
            print(
                f"  {company['name']:24} {hit['adapter']:16} {hit['slug']:22} {hit['postings']} postings",
                file=sys.stderr,
            )
            found.append({"name": company["name"], **hit})
        else:
            print(f"  {company['name']:24} no board found", file=sys.stderr)

    json.dump(found, sys.stdout, indent=2)
    print()
    print(f"\n  matched {len(found)}/{len(targets)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
