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

// Higher rank = further along the funnel. Used only for display ordering;
// the current status of an application is always the latest event by date.
export const STATUS_RANK: Record<ApplicationStatus, number> = {
  applied: 0,
  assessment: 1,
  interview: 2,
  offer: 3,
  rejected: -1,
  withdrawn: -2,
};

export const POSITION_TYPES = [
  "Software Engineering",
  "Data / ML",
  "Product Management",
  "Hardware / Electrical",
  "Quant / Finance",
  "Design",
  "Business / Operations",
  "Research",
  "Other",
] as const;
export type PositionType = (typeof POSITION_TYPES)[number];

export const INDUSTRIES = [
  "Technology",
  "Finance",
  "Consulting",
  "Healthcare",
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
  positionType: PositionType | null;
  industry: Industry | null;
  status: ApplicationStatus | null;
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
  positionType: PositionType | null;
  industry: Industry | null;
  status: ApplicationStatus;
  appliedAt: string | null; // ISO
  lastEventAt: string | null; // ISO
  location: string | null;
  notes: string | null;
  source: string | null;
  events: ApplicationEventDTO[];
}
