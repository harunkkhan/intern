// Shared domain taxonomies and types used across the classifier, API, and UI.

export const APPLICATION_STATUSES = [
  "applied",
  "assessment",
  "interview",
  "offer",
  "rejected",
  "withdrawn",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  applied: "Applied",
  assessment: "Assessment / OA",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

// Higher rank = further along the funnel. Drives the Status column sort, so
// sorting largest-to-smallest puts an offer on top. The current status of an
// application is always the latest event by date; this is display only.
export const STATUS_RANK: Record<ApplicationStatus, number> = {
  applied: 0,
  assessment: 1,
  interview: 2,
  offer: 3,
  rejected: -1,
  withdrawn: -2,
};

// The order the table falls back to when no column sort is active. Deliberately
// not STATUS_RANK reversed: this ranks by what still needs work from you rather
// than by how far along it is. An interview is the most urgent thing on the
// board and an OA is on a clock, so both outrank a plain application — while an
// offer is already won and a rejection is closed, so neither competes for
// attention at the top. Applied date is not a factor at any level; recency only
// breaks ties inside one status group, via the query's lastEventAt ordering.
export const STATUS_DEFAULT_ORDER: Record<ApplicationStatus, number> = {
  interview: 0,
  assessment: 1,
  applied: 2,
  offer: 3,
  rejected: 4,
  withdrawn: 5,
};

// Which internship cycle the application is for. Fixed to the upcoming cycles.
// "Any" means the cycle is unknown or the role could apply to several.
export const TERMS = [
  "Any",
  "Fall 2026",
  "Spring 2027",
  "Summer 2027",
  "Winter 2027",
] as const;
export type Term = (typeof TERMS)[number];

// Company tier/category. Categories overlap (FAANG is also Fortune 500), so the
// classifier picks the single most specific/recognizable label.
export const COMPANY_TYPES = [
  "FAANG",
  "Big Tech",
  "Quant",
  "Fortune 100",
  "Fortune 500",
  "Unicorn",
  "Startup",
  "Enterprise",
  "Nonprofit / Government",
  "Other",
] as const;
export type CompanyType = (typeof COMPANY_TYPES)[number];

export const INDUSTRIES = [
  "Technology",
  "Finance",
  "Consulting",
  "Healthcare/Life Sciences",
  "Retail / E-commerce",
  "Aerospace / Defense",
  "Energy",
  "Media / Entertainment",
  "Automotive",
  "Telecom",
  "Government / Nonprofit",
  "Other",
] as const;
export type Industry = (typeof INDUSTRIES)[number];

// Result of classifying a single email. `isApplicationRelated: false` means
// the email is noise (newsletter, unrelated) and should be skipped.
export interface ClassificationResult {
  isApplicationRelated: boolean;
  company: string | null;
  position: string | null;
  term: Term | null;
  industry: Industry | null;
  companyType: CompanyType | null;
  status: ApplicationStatus | null;
  // The email says the assessment has been sat, not merely sent — "thanks for
  // completing your online assessment". Separate from `status`, which stays
  // `assessment` either way: finishing an OA doesn't move you down the funnel,
  // it just means the ball is no longer in your court.
  assessmentCompleted: boolean;
  summary: string | null;
  // How this classification was produced — useful for debugging / the UI.
  source: "rules" | "gemini";
}

// Shape returned by the applications API and consumed by the table/details UI.
export interface ApplicationEventDTO {
  id: string;
  status: ApplicationStatus;
  summary: string | null;
  emailSubject: string | null;
  emailFrom: string | null;
  occurredAt: string; // ISO
}

export interface ApplicationDTO {
  id: string;
  company: string;
  position: string;
  term: Term | null;
  industry: Industry | null;
  companyType: CompanyType | null;
  status: ApplicationStatus;
  oaCompleted: boolean;
  appliedAt: string | null; // ISO
  lastEventAt: string | null; // ISO
  location: string | null;
  notes: string | null;
  source: string | null;
  events: ApplicationEventDTO[];
}
