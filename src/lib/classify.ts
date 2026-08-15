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

// An assessment that has been SAT, not one that has been sent. The distinction
// is entirely in the verb, so these look for a completion word bound to an
// assessment word rather than for assessment words on their own — "complete your
// online assessment by Friday" is an invitation and must not match.
const ASSESSMENT_WORDS =
  "online assessment|coding (?:challenge|assessment|test)|technical assessment|skills assessment|take-?home|hackerrank|codesignal|codility|karat|hirevue|video interview";

const ASSESSMENT_DONE_PATTERNS: RegExp[] = [
  // "thank you for completing the online assessment"
  new RegExp(
    `\\b(?:thanks?|thank you)\\b[^.!?]{0,40}\\b(?:for )?(?:completing|finishing|submitting|taking)\\b[^.!?]{0,60}\\b(?:${ASSESSMENT_WORDS})\\b`,
    "i",
  ),
  // "we have received your assessment" / "your submission has been received"
  new RegExp(
    `\\b(?:we(?:'ve| have)? received|received)\\b[^.!?]{0,40}\\b(?:${ASSESSMENT_WORDS}|submission)\\b`,
    "i",
  ),
  // "your HackerRank test has been submitted" / "assessment was completed"
  new RegExp(
    `\\b(?:${ASSESSMENT_WORDS})\\b[^.!?]{0,40}\\b(?:has been|have been|was|were)\\s+(?:successfully\\s+)?(?:completed|submitted|received)\\b`,
    "i",
  ),
  // "you have completed the coding challenge"
  new RegExp(
    `\\byou(?:'ve| have)?\\s+(?:successfully\\s+)?(?:completed|submitted|finished)\\b[^.!?]{0,60}\\b(?:${ASSESSMENT_WORDS})\\b`,
    "i",
  ),
];

export function detectAssessmentCompleted(text: string): boolean {
  return ASSESSMENT_DONE_PATTERNS.some((re) => re.test(text));
}

interface RuleSignal {
  likelyRelated: boolean;
  status: ApplicationStatus | null;
  assessmentCompleted: boolean;
  fromAts: boolean;
}

function analyzeRules(email: ParsedEmail): RuleSignal {
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

  return {
    likelyRelated: fromAts || status !== null,
    status,
    assessmentCompleted: detectAssessmentCompleted(haystack),
    fromAts,
  };
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
  // Either signal is enough to mark the OA done. The flag only ever turns on —
  // nothing downstream clears it — so a miss costs a manual click while a false
  // positive costs an unclick, and the two detectors miss different things.
  if (result.isApplicationRelated && signal.assessmentCompleted) {
    result.assessmentCompleted = true;
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
    assessmentCompleted: false,
    summary: null,
    source: "rules",
  };
}
