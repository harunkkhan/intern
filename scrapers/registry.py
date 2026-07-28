"""Per-company scraping configuration.

`name` must match the watchlist entry in internships/src/watchlist-seed.ts, since
that is what joins a scraped listing to a watched company.

Only `domain` is required. discover.py walks the usual career-page paths off it
(/careers, /careers/jobs, careers.<domain>, …) and reports which one actually
holds postings, so the fragile per-company URL is discovered rather than guessed.
Set `careers_url` to pin one when discovery gets it wrong, `render` to force or
skip the browser, and `selectors` when the generic href-based extractor misses.

`ats` short-circuits discovery for companies whose board is already known — for
several of these the public careers page is a thin marketing wrapper that never
lists roles, while the board behind it is unambiguous (DeepMind and Five Rings
both publish through Greenhouse). Pinning it beats probing for a listing page
that does not exist.

URLs below were looked up per company and then verified by fetching; anything
still marked unverified had no reachable public listing page.
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
    # deepmind.google/careers is a marketing page; the board is Greenhouse.
    c("Google DeepMind", "deepmind.google",
      ats={"adapter": "greenhouse", "config": {"board": "deepmind"}}),
    # Publishes no public job board — applications go through recruiters only.
    c("Renaissance Technologies", "rentec.com", unavailable="no public listings"),
    # Jobvite-hosted; no adapter for Jobvite yet.
    c("TGS", "tgsmc.com", careers_url="https://jobs.jobvite.com/tgsmc"),
    c("xAI", "x.ai", careers_url="https://x.ai/careers/open-roles"),
    c("Citadel Securities", "citadelsecurities.com",
      careers_url="https://www.citadelsecurities.com/careers/open-opportunities/"),
    # Their open-roles page renders roles without anchors, so the page yields
    # nothing — but the Greenhouse board behind it has 221 postings.
    c("Jane Street", "janestreet.com",
      ats={"adapter": "greenhouse", "config": {"board": "janestreet"}}),
    c("Hudson River Trading", "hudsonrivertrading.com",
      careers_url="https://www.hudsonrivertrading.com/careers/"),
    # ---- S --------------------------------------------------------------
    c("Citadel", "citadel.com",
      careers_url="https://www.citadel.com/careers/open-opportunities/"),
    c("D. E. Shaw", "deshaw.com", careers_url="https://www.deshaw.com/careers"),
    c("Jump Trading", "jumptrading.com",
      ats={"adapter": "greenhouse", "config": {"board": "jumptrading"}}),
    c("Optiver", "optiver.com", careers_url="https://optiver.com/join-us/jobs/"),
    # twosigma.com/careers is marketing; the board lives on careers.twosigma.com.
    c("Two Sigma", "twosigma.com",
      careers_url="https://careers.twosigma.com/careers/OpenRoles"),
    c("Tesla (Autopilot)", "tesla.com",
      careers_url="https://www.tesla.com/careers/search"),
    # Domain is fiverings.com, not fiveringsllc.com; board slug keeps the LLC.
    c("Five Rings", "fiverings.com",
      ats={"adapter": "greenhouse", "config": {"board": "fiveringsllc"}}),
    c("SpaceX", "spacex.com", careers_url="https://www.spacex.com/careers/jobs/"),
    # ---- S- -------------------------------------------------------------
    c("IMC", "imc.com", careers_url="https://www.imc.com/us/search-careers"),
    # Intern + co-op board specifically, which is narrower than their general
    # search and therefore exactly the population we alert on.
    c("SIG", "sig.com", careers_url="https://careers.sig.com/intern-co-op/jobs"),
    c("DRW", "drw.com",
      ats={"adapter": "greenhouse", "config": {"board": "drweng"}}),
    c("Akuna Capital", "akunacapital.com",
      careers_url="https://akunacapital.com/careers"),
    # ---- A++ ------------------------------------------------------------
    # needs_render: their HTTP response is 737 KB of text but contains no
    # postings at all, so only a rendered DOM has the job list.
    c("Databricks", "databricks.com",
      careers_url="https://www.databricks.com/company/careers/open-positions",
      needs_render=True),
    # Their careers page renders five anchors and no postings; the Eightfold API
    # behind it — on Netflix's own subdomain — returns the real list.
    c("Netflix", "netflix.com",
      ats={"adapter": "eightfold",
           "config": {"host": "explore.jobs.netflix.net", "domain": "netflix.com"}}),
    # Board slug carries the legal name, which plain-name guessing missed.
    c("Anduril", "anduril.com",
      ats={"adapter": "greenhouse", "config": {"board": "andurilindustries"}}),
    c("Google", "google.com",
      careers_url="https://www.google.com/about/careers/applications/jobs/results/"),
    # The jobsearch view filtered to the Internship role, which lists far more
    # than the /jobs keyword search did. needs_render because plain HTTP gets 400
    # from metacareers; postings link as /profile/job_details/<id>, which the
    # extractor now recognizes.
    c("Meta", "metacareers.com",
      careers_url="https://www.metacareers.com/jobsearch/?roles%5B0%5D=Internship",
      needs_render=True),
    c("Sierra AI", "sierra.ai"),
    c("Roblox", "roblox.com", careers_url="https://careers.roblox.com/jobs"),
    # ---- A+ -------------------------------------------------------------
    c("Snowflake", "snowflake.com",
      careers_url="https://careers.snowflake.com/us/en/search-results"),
    c("Waymo", "waymo.com"),
    c("Stripe", "stripe.com", careers_url="https://stripe.com/jobs/search"),
    # No careers_url: path probing finds their board, and pinning
    # /careers/students broke it — that page lists no roles.
    c("LinkedIn", "linkedin.com"),
    c("Figma", "figma.com"),
    c("Plaid", "plaid.com"),
    c("Uber", "uber.com", careers_url="https://www.uber.com/us/en/careers/list/"),
    c("Airbnb", "airbnb.com"),
    c("Block (Cash App)", "block.xyz"),
    c("Ramp", "ramp.com", ats={"adapter": "ashby", "config": {"board": "ramp"}}),
    c("Coinbase", "coinbase.com",
      careers_url="https://www.coinbase.com/careers/positions"),
    # Verified Workday tenant: 915 postings for searchText=intern.
    c("Nvidia", "nvidia.com",
      ats={"adapter": "workday",
           "config": {"host": "nvidia.wd5.myworkdayjobs.com", "tenant": "nvidia",
                      "site": "NVIDIAExternalCareerSite"}}),
    c("AWS (Annapurna)", "amazon.jobs",
      careers_url="https://www.amazon.jobs/en/search?base_query=intern"),
    c("Palantir", "palantir.com",
      ats={"adapter": "lever", "config": {"company": "palantir"}}),
    c("Decagon", "decagon.ai"),
    # ---- A --------------------------------------------------------------
    c("Notion", "notion.com", careers_url="https://www.notion.com/careers"),
    c("Apple", "apple.com", careers_url="https://jobs.apple.com/en-us/search"),
    c("DoorDash", "doordash.com"),
    c("Datadog", "datadoghq.com", careers_url="https://careers.datadoghq.com/all-jobs/"),
    c("Robinhood", "robinhood.com"),
    c("MongoDB", "mongodb.com",
      careers_url="https://www.mongodb.com/company/careers/see-jobs"),
    # harvey.ai/careers stopped exposing job links entirely; the Ashby board
    # behind it has 346 postings.
    c("Harvey", "harvey.ai", ats={"adapter": "ashby", "config": {"board": "harvey"}}),
    c("Pinterest", "pinterest.com"),
    c("MITRE", "mitre.org", careers_url="https://careers.mitre.org/us/en/search-results"),
    # ---- A- -------------------------------------------------------------
    c("Snap", "snap.com", careers_url="https://www.snap.com/en-US/jobs"),
    c("Dropbox", "dropbox.com", careers_url="https://jobs.dropbox.com/all-jobs"),
    c("YouTube", "youtube.com"),
    c("Rippling", "rippling.com"),
    c("Upstart", "upstart.com",
      ats={"adapter": "greenhouse", "config": {"board": "upstart"}}),
    c("Vercel", "vercel.com"),
    c("Cloudflare", "cloudflare.com"),
    c("CrowdStrike", "crowdstrike.com",
      careers_url="https://crowdstrike.wd5.myworkdayjobs.com/en-US/crowdstrikecareers"),
    c("Affirm", "affirm.com"),
    c("Reddit", "reddit.com"),
    c("Verkada", "verkada.com"),
    c("Rubrik", "rubrik.com",
      ats={"adapter": "greenhouse", "config": {"board": "rubrik"}}),
    c("Lyft", "lyft.com", ats={"adapter": "greenhouse", "config": {"board": "lyft"}}),
    c("Instacart", "instacart.com",
      ats={"adapter": "greenhouse", "config": {"board": "instacart"}}),
    c("Twilio", "twilio.com"),
    c("Okta", "okta.com", ats={"adapter": "greenhouse", "config": {"board": "okta"}}),
    c("Riot Games", "riotgames.com",
      ats={"adapter": "greenhouse", "config": {"board": "riotgames"}}),
    c("Circle", "circle.com", careers_url="https://www.circle.com/careers"),
    c("The Trade Desk", "thetradedesk.com",
      ats={"adapter": "greenhouse", "config": {"board": "thetradedesk"}}),
    c("Pure Storage", "purestorage.com",
      ats={"adapter": "greenhouse", "config": {"board": "purestorage"}}),
    c("SoFi", "sofi.com", ats={"adapter": "greenhouse", "config": {"board": "sofi"}}),
    # ---- B+ -------------------------------------------------------------
    c("TikTok", "tiktok.com", careers_url="https://lifeattiktok.com/search"),
    c("Discord", "discord.com"),
    c("Amazon", "amazon.jobs",
      careers_url="https://www.amazon.jobs/en/search?base_query=intern"),
    c("Microsoft", "microsoft.com",
      careers_url="https://jobs.careers.microsoft.com/global/en/search"),
    c("Bloomberg", "bloomberg.com", careers_url="https://careers.bloomberg.com/job/search"),
    c("AMD", "amd.com"),
    c("Adobe", "adobe.com", careers_url="https://careers.adobe.com/us/en/search-results"),
    c("Atlassian", "atlassian.com",
      careers_url="https://www.atlassian.com/company/careers/all-jobs"),
    c("DocuSign", "docusign.com", careers_url="https://careers.docusign.com/jobs"),
    c("Box", "box.com"),
    c("Intuit", "intuit.com"),
    c("HubSpot", "hubspot.com",
      ats={"adapter": "greenhouse", "config": {"board": "hubspotjobs"}}),
    # ---- B --------------------------------------------------------------
    c("Duolingo", "duolingo.com"),
    c("Asana", "asana.com"),
    # Same as LinkedIn: lifeatspotify.com/jobs yielded nothing, while probing
    # spotify.com paths resolved.
    c("Spotify", "spotify.com"),
    c("Epic Games", "epicgames.com"),
    c("Etsy", "etsy.com"),
    c("Twitch", "twitch.tv",
      ats={"adapter": "greenhouse", "config": {"board": "twitch"}}),
    c("PayPal", "paypal.com", careers_url="https://careers.pypl.com/search-results"),
    c("Workday", "workday.com",
      ats={"adapter": "workday",
           "config": {"host": "workday.wd5.myworkdayjobs.com", "tenant": "workday",
                      "site": "Workday"}}),
    # ---- B- -------------------------------------------------------------
    c("Oracle", "oracle.com", careers_url="https://careers.oracle.com/jobs/"),
    c("Zoom", "zoom.com"),
    c("IBM", "ibm.com"),
    c("Salesforce", "salesforce.com",
      careers_url="https://careers.salesforce.com/en/jobs/"),
    c("Capital One", "capitalone.com",
      careers_url="https://www.capitalonecareers.com/search-jobs"),
    c("eBay", "ebay.com", careers_url="https://jobs.ebayinc.com/us/en/search-results"),
    c("Shopify", "shopify.com", careers_url="https://www.shopify.com/careers/search"),
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
