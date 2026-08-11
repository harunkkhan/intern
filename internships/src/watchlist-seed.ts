// The watchlist, as a checked-in list rather than ad-hoc SQL, so re-seeding is
// reproducible and the tiers live in version control.
//
// `aliases` matter more than they look. Matching is by normalized company name,
// so an entry only fires when a source happens to spell the employer the same
// way. Abbreviations ("HRT", "SIG", "TTD"), brand/parent splits ("Block" vs
// "Square" vs "Cash App"), and org qualifiers ("Tesla (Autopilot)") would
// otherwise match nothing at all. Aliases are written as they appear in the
// wild; the seed script normalizes them.
//
// Parentheticals are kept in the display name but do NOT narrow matching — our
// listing data records an employer, not an internal team, so there is no way to
// tell an Autopilot posting from any other Tesla posting. Treat them as notes.

export interface SeedCompany {
  name: string;
  tier: string;
  /** Raw spellings that mean the same employer; normalized on insert. */
  aliases?: string[];
}

// Where a company appeared at several tiers in the source list, the highest one
// wins (Google: A++ over A; Meta: A++ over A+/A).
export const WATCHLIST: SeedCompany[] = [
  // S+
  { name: "Anthropic", tier: "S+" },
  { name: "OpenAI", tier: "S+" },
  { name: "Google DeepMind", tier: "S+", aliases: ["DeepMind"] },
  {
    name: "Renaissance Technologies",
    tier: "S+",
    aliases: ["Renaissance Technology", "RenTec"],
  },
  { name: "TGS", tier: "S+", aliases: ["TGS Management"] },
  { name: "xAI", tier: "S+" },
  { name: "Citadel Securities", tier: "S+" },
  { name: "Jane Street", tier: "S+", aliases: ["Jane Street Capital"] },
  { name: "Hudson River Trading", tier: "S+", aliases: ["HRT"] },

  // S
  { name: "Citadel", tier: "S" },
  { name: "D. E. Shaw", tier: "S", aliases: ["DE Shaw", "D.E. Shaw & Co."] },
  { name: "Jump Trading", tier: "S", aliases: ["Jump"] },
  { name: "Optiver", tier: "S" },
  { name: "Two Sigma", tier: "S" },
  { name: "Tesla (Autopilot)", tier: "S", aliases: ["Tesla"] },
  { name: "Five Rings", tier: "S", aliases: ["Five Rings Capital"] },
  { name: "SpaceX", tier: "S" },

  // S-
  { name: "IMC", tier: "S-", aliases: ["IMC Trading", "IMC Financial Markets"] },
  {
    name: "SIG",
    tier: "S-",
    // The parenthesised form is not redundant with the one above it:
    // normalizeCompany drops "Group" as filler but keeps "SIG", so the feeds'
    // "Susquehanna International Group (SIG)" lands on "susquehanna
    // international sig" and never matched "susquehanna international".
    aliases: [
      "Susquehanna",
      "Susquehanna International Group",
      "Susquehanna International Group (SIG)",
    ],
  },
  { name: "DRW", tier: "S-", aliases: ["DRW Trading"] },
  { name: "Akuna Capital", tier: "S-", aliases: ["Akuna"] },

  // A++
  { name: "Databricks", tier: "A++" },
  { name: "Netflix", tier: "A++" },
  { name: "Anduril", tier: "A++", aliases: ["Anduril Industries"] },
  { name: "Google", tier: "A++", aliases: ["Alphabet"] },
  { name: "Meta", tier: "A++", aliases: ["Facebook"] },
  { name: "Sierra AI", tier: "A++", aliases: ["Sierra"] },
  { name: "Roblox", tier: "A++" },

  // A+
  { name: "Snowflake", tier: "A+" },
  { name: "Waymo", tier: "A+" },
  { name: "Stripe", tier: "A+" },
  { name: "LinkedIn", tier: "A+" },
  { name: "Figma", tier: "A+" },
  { name: "Plaid", tier: "A+" },
  { name: "Uber", tier: "A+" },
  { name: "Airbnb", tier: "A+" },
  {
    name: "Block (Cash App)",
    tier: "A+",
    aliases: ["Block", "Cash App", "Square"],
  },
  { name: "Ramp", tier: "A+" },
  { name: "Coinbase", tier: "A+" },
  { name: "Nvidia", tier: "A+" },
  {
    name: "AWS (Annapurna)",
    tier: "A+",
    aliases: ["AWS", "Amazon Web Services", "Annapurna Labs"],
  },
  { name: "Palantir", tier: "A+", aliases: ["Palantir Technologies"] },
  { name: "Decagon", tier: "A+" },

  // A
  { name: "Notion", tier: "A" },
  { name: "Apple", tier: "A" },
  { name: "DoorDash", tier: "A" },
  { name: "Datadog", tier: "A" },
  { name: "Robinhood", tier: "A" },
  { name: "MongoDB", tier: "A" },
  { name: "Harvey", tier: "A", aliases: ["Harvey AI"] },
  { name: "Pinterest", tier: "A" },

  // A-
  { name: "Snap", tier: "A-", aliases: ["Snap Inc", "Snapchat"] },
  { name: "Dropbox", tier: "A-" },
  { name: "YouTube", tier: "A-", aliases: ["Google (YouTube)"] },
  { name: "Rippling", tier: "A-" },
  { name: "Upstart", tier: "A-" },
  { name: "Vercel", tier: "A-" },
  { name: "Cloudflare", tier: "A-" },
  { name: "CrowdStrike", tier: "A-" },
  { name: "Affirm", tier: "A-" },
  { name: "Reddit", tier: "A-" },
  { name: "Verkada", tier: "A-" },
  { name: "Rubrik", tier: "A-" },
  { name: "Lyft", tier: "A-" },
  { name: "Instacart", tier: "A-", aliases: ["Maplebear"] },
  { name: "Twilio", tier: "A-" },
  { name: "Okta", tier: "A-" },
  { name: "Riot Games", tier: "A-" },
  { name: "Circle", tier: "A-" },
  { name: "The Trade Desk", tier: "A-", aliases: ["TTD"] },
  { name: "Pure Storage", tier: "A-" },
  { name: "SoFi", tier: "A-", aliases: ["Social Finance"] },

  // B+
  // Tracked separately rather than ByteDance being a TikTok alias. They post
  // different roles — ByteDance's are largely Seed/foundation-model research —
  // and folding them together made the watchlist read as one 148-role employer
  // instead of two, with no way to tier or disable them independently.
  { name: "TikTok", tier: "B+" },
  { name: "ByteDance", tier: "B+" },
  { name: "Discord", tier: "B+" },
  { name: "Amazon", tier: "B+" },
  { name: "Microsoft", tier: "B+" },
  { name: "Bloomberg", tier: "B+", aliases: ["Bloomberg LP"] },
  { name: "AMD", tier: "B+", aliases: ["Advanced Micro Devices"] },
  { name: "Adobe", tier: "B+" },
  { name: "Atlassian", tier: "B+" },
  { name: "DocuSign", tier: "B+" },
  { name: "Box", tier: "B+" },
  { name: "Intuit", tier: "B+" },
  { name: "HubSpot", tier: "B+" },

  // B
  { name: "Duolingo", tier: "B" },
  { name: "Asana", tier: "B" },
  { name: "Spotify", tier: "B" },
  { name: "Epic Games", tier: "B" },
  { name: "Etsy", tier: "B" },
  { name: "Twitch", tier: "B" },
  { name: "PayPal", tier: "B" },
  { name: "Workday", tier: "B" },

  // B-
  { name: "Oracle", tier: "B-" },
  { name: "Zoom", tier: "B-", aliases: ["Zoom Video Communications"] },
  { name: "IBM", tier: "B-", aliases: ["International Business Machines"] },
  { name: "Salesforce", tier: "B-" },
  { name: "Capital One", tier: "B-" },
  { name: "eBay", tier: "B-" },
  { name: "Shopify", tier: "B-" },

  // Added separately
  { name: "MITRE", tier: "A", aliases: ["The MITRE Corporation"] },
  // Separate from Microsoft for the same reason ByteDance is separate from
  // TikTok: it hires on its own board, and what it posts there — "Research
  // Intern for <group>" — has nothing in common with the SWE internships on
  // jobs.careers.microsoft.com. Folding it into the Microsoft entry would also
  // mean it could not be tiered or disabled on its own. Without this entry the
  // msr source still records postings, but no alert would ever match them:
  // "Microsoft Research" normalizes to "microsoft research", which is not the
  // "microsoft" the parent entry is keyed on.
  {
    name: "Microsoft Research",
    tier: "A",
    aliases: [
      "MSR",
      "Microsoft Research Asia",
      "MSRA",
      "Microsoft Research India",
      "Microsoft Research Cambridge",
      "MSR Cambridge",
    ],
  },
];
