"""Per-company scraping configuration.

`name` must match the watchlist entry in internships/src/watchlist-seed.ts, since
that is what joins a scraped listing to a watched company.

Only `domain` is required. discover.py walks the usual career-page paths off it
(/careers, /careers/jobs, careers.<domain>, …) and reports which one actually
holds postings, so the fragile per-company URL is discovered rather than guessed.
Set `careers_url` to pin one when discovery gets it wrong, `render` to force or
skip the browser, and `selectors` when the generic href-based extractor misses.
"""

from __future__ import annotations

# Paths tried against each domain, best-guess order. The user's own examples
# (openai.com/careers/, anthropic.com/careers/jobs) are both in here.
CANDIDATE_PATHS = [
    "/careers/jobs",
    "/careers/open-roles",
    "/careers/open-positions",
    "/careers/search",
    "/careers/jobs/",
    "/careers",
    "/jobs",
    "/company/careers/open-positions",
    "/about/careers",
]

# Subdomains tried when path candidates come up empty.
CANDIDATE_HOSTS = ["careers.{d}", "jobs.{d}", "www.{d}", "{d}"]


class Company(dict):
    """Thin dict wrapper so entries read as literals below."""


def c(name: str, domain: str, **kw) -> Company:
    return Company(name=name, domain=domain, **kw)


COMPANIES: list[Company] = [
    # ---- S+ -------------------------------------------------------------
    c("Anthropic", "anthropic.com", careers_url="https://www.anthropic.com/careers/jobs"),
    c("OpenAI", "openai.com", careers_url="https://openai.com/careers/search/"),
    c("Google DeepMind", "deepmind.google"),
    c("Renaissance Technologies", "rentec.com"),
    c("TGS", "tgsmc.com"),
    c("xAI", "x.ai"),
    c("Citadel Securities", "citadelsecurities.com"),
    c("Jane Street", "janestreet.com",
      careers_url="https://www.janestreet.com/join-jane-street/open-roles/"),
    c("Hudson River Trading", "hudsonrivertrading.com"),
    # ---- S --------------------------------------------------------------
    c("Citadel", "citadel.com"),
    c("D. E. Shaw", "deshaw.com"),
    c("Jump Trading", "jumptrading.com"),
    c("Optiver", "optiver.com"),
    c("Two Sigma", "twosigma.com"),
    c("Tesla (Autopilot)", "tesla.com"),
    c("Five Rings", "fiveringsllc.com"),
    c("SpaceX", "spacex.com", careers_url="https://www.spacex.com/careers/jobs/"),
    # ---- S- -------------------------------------------------------------
    c("IMC", "imc.com"),
    c("SIG", "sig.com"),
    c("DRW", "drw.com"),
    c("Akuna Capital", "akunacapital.com"),
    # ---- A++ ------------------------------------------------------------
    # needs_render: their HTTP response is 737 KB of text but contains no
    # postings at all, so only a rendered DOM has the job list.
    c("Databricks", "databricks.com",
      careers_url="https://www.databricks.com/company/careers/open-positions",
      needs_render=True),
    c("Netflix", "netflix.com", careers_url="https://explore.jobs.netflix.net/careers"),
    c("Anduril", "anduril.com"),
    c("Google", "google.com",
      careers_url="https://www.google.com/about/careers/applications/jobs/results/"),
    c("Meta", "metacareers.com", careers_url="https://www.metacareers.com/jobs"),
    c("Sierra AI", "sierra.ai"),
    c("Roblox", "roblox.com"),
    # ---- A+ -------------------------------------------------------------
    c("Snowflake", "snowflake.com"),
    c("Waymo", "waymo.com"),
    c("Stripe", "stripe.com", careers_url="https://stripe.com/jobs/search"),
    c("LinkedIn", "linkedin.com"),
    c("Figma", "figma.com"),
    c("Plaid", "plaid.com"),
    c("Uber", "uber.com"),
    c("Airbnb", "airbnb.com"),
    c("Block (Cash App)", "block.xyz"),
    c("Ramp", "ramp.com"),
    c("Coinbase", "coinbase.com"),
    c("Nvidia", "nvidia.com"),
    c("AWS (Annapurna)", "amazon.jobs"),
    c("Palantir", "palantir.com"),
    c("Decagon", "decagon.ai"),
    # ---- A --------------------------------------------------------------
    c("Notion", "notion.com", careers_url="https://www.notion.com/careers"),
    c("Apple", "apple.com", careers_url="https://jobs.apple.com/en-us/search"),
    c("DoorDash", "doordash.com"),
    c("Datadog", "datadoghq.com"),
    c("Robinhood", "robinhood.com"),
    c("MongoDB", "mongodb.com"),
    c("Harvey", "harvey.ai"),
    c("Pinterest", "pinterest.com"),
    c("MITRE", "mitre.org", careers_url="https://careers.mitre.org/us/en/search-results"),
    # ---- A- -------------------------------------------------------------
    c("Snap", "snap.com"),
    c("Dropbox", "dropbox.com"),
    c("YouTube", "youtube.com"),
    c("Rippling", "rippling.com"),
    c("Upstart", "upstart.com"),
    c("Vercel", "vercel.com"),
    c("Cloudflare", "cloudflare.com"),
    c("CrowdStrike", "crowdstrike.com"),
    c("Affirm", "affirm.com"),
    c("Reddit", "reddit.com"),
    c("Verkada", "verkada.com"),
    c("Rubrik", "rubrik.com"),
    c("Lyft", "lyft.com"),
    c("Instacart", "instacart.com"),
    c("Twilio", "twilio.com"),
    c("Okta", "okta.com"),
    c("Riot Games", "riotgames.com"),
    c("Circle", "circle.com"),
    c("The Trade Desk", "thetradedesk.com"),
    c("Pure Storage", "purestorage.com"),
    c("SoFi", "sofi.com"),
    # ---- B+ -------------------------------------------------------------
    c("TikTok", "tiktok.com"),
    c("Discord", "discord.com"),
    c("Amazon", "amazon.jobs"),
    c("Microsoft", "microsoft.com"),
    c("Bloomberg", "bloomberg.com", careers_url="https://careers.bloomberg.com/job/search"),
    c("AMD", "amd.com"),
    c("Adobe", "adobe.com"),
    c("Atlassian", "atlassian.com"),
    c("DocuSign", "docusign.com"),
    c("Box", "box.com"),
    c("Intuit", "intuit.com"),
    c("HubSpot", "hubspot.com"),
    # ---- B --------------------------------------------------------------
    c("Duolingo", "duolingo.com"),
    c("Asana", "asana.com"),
    c("Spotify", "spotify.com"),
    c("Epic Games", "epicgames.com"),
    c("Etsy", "etsy.com"),
    c("Twitch", "twitch.tv"),
    c("PayPal", "paypal.com"),
    c("Workday", "workday.com"),
    # ---- B- -------------------------------------------------------------
    c("Oracle", "oracle.com"),
    c("Zoom", "zoom.com"),
    c("IBM", "ibm.com"),
    c("Salesforce", "salesforce.com"),
    c("Capital One", "capitalone.com"),
    c("eBay", "ebay.com"),
    c("Shopify", "shopify.com"),
]

BY_NAME = {c["name"]: c for c in COMPANIES}


def candidate_urls(company: Company) -> list[str]:
    if company.get("careers_url"):
        return [company["careers_url"]]
    d = company["domain"]
    urls = []
    # A bare careers subdomain is common enough to try before path guessing.
    urls.append(f"https://careers.{d}")
    for path in CANDIDATE_PATHS:
        urls.append(f"https://www.{d}{path}")
    return urls
