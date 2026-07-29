// The named lists the Alerts tab is organized into.
//
// Kept dependency-free so the Bun poller can import it across the folder
// boundary, the same as src/lib/company.ts.
//
// Two different things get grouped here. A "companies" list holds
// watched_company rows and matches postings by employer name, whichever source
// they arrive from. A "sources" list holds job_source rows — feeds that are
// themselves the subject, like the community GitHub repos — and everything they
// publish belongs to that list.

export const ALERT_LISTS = [
  {
    key: "harun",
    name: "Harun's List",
    kind: "companies",
    description:
      "Companies followed by name. Matches postings from any source, plus their own careers page where one could be resolved.",
  },
  {
    key: "general-github",
    name: "General Github Repos",
    kind: "sources",
    description:
      "Community-maintained internship listing repos covering the whole market.",
  },
  {
    key: "underclassmen-github",
    name: "Underclassmen Github Repos",
    kind: "sources",
    description:
      "Repos focused on freshman and sophomore programs. Nothing added yet.",
  },
  {
    key: "summer-reu",
    name: "Summer REUs",
    kind: "sources",
    description:
      "NSF Research Experiences for Undergraduates and similar programs. Nothing added yet.",
  },
] as const;

export type AlertListKey = (typeof ALERT_LISTS)[number]["key"];
export type AlertListKind = (typeof ALERT_LISTS)[number]["kind"];

export const DEFAULT_COMPANY_LIST: AlertListKey = "harun";
export const DEFAULT_SOURCE_LIST: AlertListKey = "general-github";

export function alertListName(key: string | null | undefined): string {
  return ALERT_LISTS.find((l) => l.key === key)?.name ?? "Ungrouped";
}

export function isAlertListKey(value: unknown): value is AlertListKey {
  return (
    typeof value === "string" && ALERT_LISTS.some((l) => l.key === value)
  );
}
