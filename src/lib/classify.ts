import type { ClassificationResult, ApplicationStatus } from "@/lib/types";
import type { ParsedEmail } from "@/lib/gmail";
import { classifyWithGemini } from "@/lib/gemini";

// Known applicant-tracking-system (ATS) sender domains. An email from one of
// these is almost always about a real application.
const ATS_DOMAINS = [
  "greenhouse.io",
  "us.greenhouse-mail.io",
  "lever.co",
  "hire.lever.co",
  "myworkday.com",
  "workday.com",
  "icims.com",
  "smartrecruiters.com",
  "ashbyhq.com",
  "taleo.net",
  "successfactors.com",
  "jobvite.com",
  "breezy.hr",
  "bamboohr.com",
  "workable.com",
  "rippling.com",
  "gem.com",
  "paradox.ai",
  "hackerrank.com",
  "codesignal.com",
  "hireflix.com",
];

// Phrases that, in a subject line, strongly indicate an application-lifecycle
// email and hint at its status.
const STATUS_PATTERNS: Array<{ re: RegExp; status: ApplicationStatus }> = [
  { re: /\b(offer|offer of employment|pleased to offer)\b/i, status: "offer" },
  {
    re: /\b(unfortunately|we regret|not (be )?moving forward|will not be|decided not to|other candidates|no longer under consideration)\b/i,
    status: "rejected",
  },
  {
    re: /\b(interview|schedule (a|your)|meet with|phone screen|onsite|on-site|video call)\b/i,
    status: "interview",
  },
  {
    re: /\b(online assessment|coding (challenge|assessment)|take-home|hackerrank|codesignal|technical assessment|skills assessment)\b/i,
    status: "assessment",
  },
  {
    re: /\b(thank you for applying|thank(?:s| you) for your interest|application (received|submitted|complete)|we received your application|received your application|your application (to|for|has been))\b/i,
    status: "applied",
  },
];

export interface RuleSignal {
  likelyRelated: boolean;
  status: ApplicationStatus | null;
  fromAts: boolean;
}

export function analyzeRules(email: ParsedEmail): RuleSignal {
  const from = email.from.toLowerCase();
  const fromAts = ATS_DOMAINS.some((d) => from.includes(d));
  const haystack = `${email.subject} ${email.snippet}`;

  let status: ApplicationStatus | null = null;
  for (const { re, status: s } of STATUS_PATTERNS) {
    if (re.test(haystack)) {
      status = s;
      break;
    }
  }

  return { likelyRelated: fromAts || status !== null, status, fromAts };
}

// Rules decide cheaply whether an email is worth a Gemini call; Gemini does the
// authoritative extraction (company, role, type, industry) and confirms relevance.
export async function classifyEmail(
  email: ParsedEmail,
): Promise<ClassificationResult> {
  const signal = analyzeRules(email);

  if (!signal.likelyRelated) {
    return notRelated();
  }

  const result = await classifyWithGemini(email);

  // Fall back to the rule-derived status if Gemini didn't provide one.
  if (result.isApplicationRelated && !result.status && signal.status) {
    result.status = signal.status;
  }
  return result;
}

function notRelated(): ClassificationResult {
  return {
    isApplicationRelated: false,
    company: null,
    position: null,
    term: null,
    industry: null,
    companyType: null,
    status: null,
    summary: null,
    source: "rules",
  };
}
