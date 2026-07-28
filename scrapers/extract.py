"""Turning a career page into listing records with BeautifulSoup.

Two modes. The generic extractor keys off anchors whose href looks like a
specific job posting, which covers most career pages without any per-company
configuration. Where that fails, a company can supply CSS selectors instead.

Selector note: many of these sites use hashed CSS-module class names — Notion's
job card is `openPositionsV2_jobCard__XdedL`, and that suffix changes on every
deploy. Configured selectors should therefore match on the stable prefix,
e.g. `[class*="openPositionsV2_jobCard"]`, never the full class.
"""

from __future__ import annotations

import re
from urllib.parse import urljoin, urlparse, urlunparse

from bs4 import BeautifulSoup, Tag

# Hrefs that point at one posting rather than at navigation. Deliberately
# includes the hosted-ATS shapes, because a company's own careers page usually
# links straight out to them.
JOB_HREF = re.compile(
    r"(/job[s]?/|/position|/opening|/vacanc|/role[s]?/[a-z0-9-]{6,}"
    # metacareers.com links postings as /profile/job_details/771948392580541 —
    # "job_details", not "job", so the plain /job/ form misses every Meta role.
    r"|/job[_-]?detail"
    r"|gh_jid=|jobId="
    # A slug ending in a long numeric requisition id. This is how career pages on
    # a company's own domain usually address a posting, e.g. Databricks'
    # /company/careers/product/product-management-intern-summer-2027-6883068002
    r"|[a-z0-9]-\d{6,}(?:[/?#]|$)"
    # Hosted-ATS UUID paths (Ashby).
    r"|/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})",
    re.I,
)

# Chrome, not content: stripped before extraction so nav labels like "Internships"
# don't get mistaken for postings.
CHROME_TAGS = ("script", "style", "noscript", "svg", "nav", "header", "footer", "form")

TRACKING_PARAM = re.compile(
    r"^(utm_\w+|gh_src|lever-source|source|src|ref|referrer|trk|mc_cid|mc_eid)$", re.I
)


def _clean_text(node: Tag | None) -> str:
    if node is None:
        return ""
    return re.sub(r"\s+", " ", node.get_text(" ", strip=True)).strip()


def _canonical(url: str) -> str:
    """Strip tracking params and fragments; keep identifying ones like gh_jid."""
    try:
        p = urlparse(url)
    except ValueError:
        return url
    kept = [
        kv
        for kv in p.query.split("&")
        if kv and not TRACKING_PARAM.match(kv.split("=")[0])
    ]
    return urlunparse(p._replace(query="&".join(kept), fragment=""))


def extract_generic(html: str, base_url: str) -> list[dict]:
    """Find postings by looking for job-shaped links. No config needed.

    Deliberately strict. A path-depth fallback ("any link deeper than the listing
    page with a hyphenated slug") was tried and removed: across the twelve
    companies whose markup defeats the strict rule it rescued exactly one, and it
    did so by reporting navigation — "Markets & Trading", "Programs & Events" —
    as job postings. Companies this misses are better served by an explicit
    `selectors` entry in registry.py than by a heuristic that invents listings.
    """
    return _extract_links(html, base_url, None)


def _extract_links(html: str, base_url: str, relaxed) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(list(CHROME_TAGS)):
        tag.decompose()

    found: dict[str, dict] = {}
    for a in soup.select("a[href]"):
        href = a.get("href") or ""
        if href.startswith(("mailto:", "tel:", "javascript:", "#")):
            continue

        absolute = urljoin(base_url, href)
        if relaxed is None:
            if not JOB_HREF.search(href):
                continue
        elif not relaxed(absolute):
            continue

        url = _canonical(absolute)
        title, location = _split_card(a)
        # Card layouts sometimes leave the anchor itself empty and put the text in
        # an ancestor row.
        if not title:
            title = _clean_text(a.find_parent(["li", "tr", "article", "div"]))
        if not (5 < len(title) < 200):
            continue
        found.setdefault(
            url,
            {"title": title, "url": url, "locations": [location] if location else None},
        )

    return list(found.values())


def _split_card(a: Tag) -> tuple[str, str]:
    """Separate title from location inside a job-card anchor.

    Card anchors commonly hold sibling elements — Databricks uses
    `<a><span>Title</span><span>City, State</span></a>` — and reading the
    anchor's whole text would produce "Product Management Intern San Francisco".
    Falls back to the anchor's flat text when there is no such structure.
    """
    # A heading inside the card is the most reliable title there is. Meta's cards
    # are <a><h3>Research Scientist Intern, …</h3><span>Internship - PhD</span>…</a>
    # and reading the anchor's whole text yields 200-260 characters of title plus
    # locations plus team plus blurb.
    heading = next(
        (
            _clean_text(h)
            for h in a.find_all(["h1", "h2", "h3", "h4", "h5"], recursive=True)
            if _clean_text(h)
        ),
        "",
    )

    # Leaf blocks only — elements that don't themselves contain another candidate
    # block. Wrappers repeat their children's text, and keeping them is what
    # previously discarded the real title: the outer div was seen first, then the
    # <h3> was dropped for being a substring of it.
    candidates = a.find_all(["span", "div", "p", "h2", "h3", "h4", "h5"], recursive=True)
    leaves: list[str] = []
    for el in candidates:
        if el.find(["span", "div", "p", "h2", "h3", "h4", "h5"]):
            continue
        text = _clean_text(el)
        if text and text not in leaves:
            leaves.append(text)

    if heading:
        location = next(
            (l for l in leaves if l != heading and l not in heading), ""
        )
        return heading, _sane_location(location, heading)
    if len(leaves) >= 2:
        return leaves[0], _sane_location(leaves[1], leaves[0])
    if len(leaves) == 1:
        return leaves[0], ""
    return _clean_text(a), ""


# Real locations are short. Anything long, or containing the title, means the card
# had no separate location element and we captured the whole blob — which then gets
# stored as a location and misread downstream. One such row put
# "Cloud Duales Studium 2027 Bachelor@IBM ... Ehningen, DE" in the location field,
# where "DE" was matched as Delaware.
_MAX_LOCATION_LEN = 80


def _sane_location(candidate: str, title: str) -> str:
    if not candidate or len(candidate) > _MAX_LOCATION_LEN:
        return ""
    if title and (title in candidate or candidate in title):
        return ""
    return candidate


def extract_with_selectors(html: str, base_url: str, cfg: dict) -> list[dict]:
    """Extract using per-company CSS selectors.

    cfg keys: item (required), title, location, link
    """
    soup = BeautifulSoup(html, "lxml")
    item_sel = cfg["item"]
    rows: dict[str, dict] = {}

    for card in soup.select(item_sel):
        title = _clean_text(card.select_one(cfg["title"])) if cfg.get("title") else _clean_text(card)
        if not title:
            continue

        anchor = card if card.name == "a" else None
        if anchor is None:
            link_sel = cfg.get("link") or "a[href]"
            anchor = card.select_one(link_sel)
        href = anchor.get("href") if isinstance(anchor, Tag) else None
        if not href:
            continue

        url = _canonical(urljoin(base_url, href))
        location = _clean_text(card.select_one(cfg["location"])) if cfg.get("location") else ""
        rows.setdefault(
            url,
            {"title": title, "url": url, "locations": [location] if location else None},
        )

    return list(rows.values())


def ats_board(html: str, base_url: str) -> dict | None:
    """Recover the ATS adapter and its config from the page's apply links.

    The board slug is in the link path — boards.greenhouse.io/<slug>/jobs/<id>,
    jobs.ashbyhq.com/<slug>/<uuid> — so it can be read directly rather than left
    for someone to look up by hand.
    """
    soup = BeautifulSoup(html, "lxml")
    for a in soup.select("a[href]"):
        href = urljoin(base_url, a.get("href") or "")
        p = urlparse(href)
        host = (p.netloc or "").lower().removeprefix("www.")
        seg = [s for s in p.path.split("/") if s]
        if not seg:
            continue

        if host in ("boards.greenhouse.io", "job-boards.greenhouse.io"):
            return {"adapter": "greenhouse", "config": {"board": seg[0]}}
        if host == "jobs.ashbyhq.com":
            return {"adapter": "ashby", "config": {"board": seg[0]}}
        if host == "jobs.lever.co":
            return {"adapter": "lever", "config": {"company": seg[0]}}
        if host == "jobs.smartrecruiters.com":
            return {"adapter": "smartrecruiters", "config": {"company": seg[0]}}
        if host.endswith(".myworkdayjobs.com"):
            tenant = host.split(".")[0]
            # Paths are /<locale>/<Site>/job/... ; the locale looks like en-US.
            site = next(
                (s for s in seg if not re.fullmatch(r"[a-z]{2}-[A-Za-z]{2}", s)), None
            )
            if site:
                return {
                    "adapter": "workday",
                    "config": {"host": host, "tenant": tenant, "site": site},
                }
    return None


def external_hosts(html: str, base_url: str) -> dict[str, int]:
    """Count the hosts that job links point to.

    This is how a career page is classified: if every posting links out to
    boards.greenhouse.io or jobs.ashbyhq.com, the page is a front-end for that
    ATS and reading its JSON returns the same data far more cheaply. If the links
    stay on the company's own domain, scraping is the only route.
    """
    soup = BeautifulSoup(html, "lxml")
    base_host = (urlparse(base_url).netloc or "").lower().removeprefix("www.")
    hosts: dict[str, int] = {}
    for a in soup.select("a[href]"):
        href = a.get("href") or ""
        if not JOB_HREF.search(href):
            continue
        host = (urlparse(urljoin(base_url, href)).netloc or "").lower().removeprefix("www.")
        if not host or host == base_host:
            host = "(own domain)"
        hosts[host] = hosts.get(host, 0) + 1
    return hosts
