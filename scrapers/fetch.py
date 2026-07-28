"""Page fetching: plain HTTP first, a real browser only when needed.

Rendering is the expensive part (~4.5s and a Chromium process per page), so it is
never the default. Plenty of career pages are server-rendered and a 50ms GET is
enough; the browser is reserved for the ones that ship an empty shell.
"""

from __future__ import annotations

import re

import requests

# A browser-shaped UA is not optional. Several of these sites (Bloomberg,
# Citadel Securities, OpenAI) return 403 to anything that looks automated.
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)

HTTP_TIMEOUT = 25
RENDER_TIMEOUT_MS = 40_000
# Time to let client-side rendering settle after DOMContentLoaded. `networkidle`
# is unusable here: pages holding analytics or websocket connections open never
# reach it, which is exactly how openai.com/careers/ hit a 45s timeout.
RENDER_SETTLE_MS = 4_000


class FetchError(RuntimeError):
    pass


def fetch_http(url: str) -> tuple[int, str]:
    """Plain GET. Returns (status, body)."""
    try:
        r = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=HTTP_TIMEOUT)
    except requests.RequestException as e:
        raise FetchError(f"{type(e).__name__}: {e}") from e
    return r.status_code, r.text


def looks_unrendered(html: str) -> bool:
    """True when a response is almost certainly a JS shell rather than content.

    Judged on the amount of visible text left after stripping scripts, not on raw
    byte count: a page can ship 300 KB of inline JS bundle and still show nothing.
    """
    if not html:
        return True
    stripped = re.sub(r"(?is)<(script|style|noscript)\b.*?</\1>", " ", html)
    text = re.sub(r"(?s)<[^>]+>", " ", stripped)
    return len(re.sub(r"\s+", " ", text).strip()) < 2_000


_browser = None
_playwright = None


def _get_browser():
    """Lazily start one Chromium and reuse it for every page in the run."""
    global _browser, _playwright
    if _browser is None:
        from playwright.sync_api import sync_playwright

        _playwright = sync_playwright().start()
        _browser = _playwright.chromium.launch(args=["--disable-dev-shm-usage"])
    return _browser


def close_browser() -> None:
    global _browser, _playwright
    if _browser is not None:
        try:
            _browser.close()
        finally:
            _browser = None
    if _playwright is not None:
        try:
            _playwright.stop()
        finally:
            _playwright = None


def fetch_rendered(url: str, wait_selector: str | None = None) -> str:
    """Load `url` in Chromium and return the DOM after client-side rendering."""
    browser = _get_browser()
    ctx = browser.new_context(user_agent=USER_AGENT, viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=RENDER_TIMEOUT_MS)
        if wait_selector:
            # Cheaper and far more reliable than a fixed sleep when the company's
            # markup gives us something specific to wait for.
            try:
                page.wait_for_selector(wait_selector, timeout=RENDER_TIMEOUT_MS)
            except Exception:
                pass
        else:
            page.wait_for_timeout(RENDER_SETTLE_MS)
        return page.content()
    except Exception as e:
        raise FetchError(f"render failed: {type(e).__name__}: {e}") from e
    finally:
        page.close()
        ctx.close()


def get_html(url: str, render: str = "auto", wait_selector: str | None = None) -> str:
    """Fetch `url`.

    render="never"  — HTTP only
    render="always" — browser only
    render="auto"   — HTTP, falling back to the browser on a block or a JS shell
    """
    if render == "always":
        return fetch_rendered(url, wait_selector)

    status, body = fetch_http(url)
    if render == "never":
        if status >= 400:
            raise FetchError(f"HTTP {status}")
        return body

    # 403/429 here means bot protection, which a real browser often satisfies.
    if status >= 400 or looks_unrendered(body):
        return fetch_rendered(url, wait_selector)
    return body
