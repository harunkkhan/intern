import "server-only";
import { GoogleGenAI, Type } from "@google/genai";
import {
  APPLICATION_STATUSES,
  COMPANY_TYPES,
  INDUSTRIES,
  TERMS,
  type ApplicationStatus,
  type ClassificationResult,
  type CompanyType,
  type Industry,
  type Term,
} from "@/lib/types";
import type { ParsedEmail } from "@/lib/gmail";

const GEMINI_MODEL = "gemini-2.5-flash";

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  if (!client) client = new GoogleGenAI({ apiKey });
  return client;
}

const systemInstruction = `You extract structured data from a single email in a job/internship applicant's inbox.

Decide whether the email concerns THIS person's own application to a company (a confirmation that they applied, an online assessment / interview invitation, an offer, or a rejection). Marketing, job-alert digests, newsletters, "jobs you may like", and account/security notices are NOT application-related.

Return:
- isApplicationRelated: true only for emails about the recipient's own application lifecycle.
- company: the hiring company's name (not the ATS/email platform like Greenhouse, Lever, Workday, iCIMS). Null if unknown.
- position: the role/title applied for. Null if unknown.
- term: the internship cycle the role is for, ONLY if explicitly stated in the email (e.g. "Summer 2027 Internship"). One of: Fall 2026, Spring 2027, Summer 2027, Winter 2027. Null if not stated.
- industry: the hiring company's primary industry.
- companyType: the single most specific/recognizable tier for the hiring company. Categories overlap, so prefer the most distinctive: FAANG (Meta, Apple, Amazon, Netflix, Google, Microsoft) > Big Tech (other large well-known tech: Nvidia, Salesforce, Adobe, Oracle, etc.) > Fortune 100 / Fortune 500 (large public companies by rank, typically non-tech-defining) > Unicorn ($1B+ private, e.g. well-funded AI/tech startups) > Startup (smaller/early private) > Enterprise (other large established firm) > Nonprofit / Government. Use "Other" only when genuinely unclear.
- status: where the application now stands based on THIS email:
    applied = application submitted/received/confirmed
    assessment = online assessment, coding challenge, take-home, or recruiter screen requested
    interview = interview invitation or scheduling
    offer = offer extended
    rejected = not moving forward / declined
    withdrawn = candidate withdrew
- summary: one concise sentence describing what this email says about the application.

Base every field only on the email content. Prefer "Other" over guessing for industry/companyType, and null for term, when genuinely unclear.`;

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    isApplicationRelated: { type: Type.BOOLEAN },
    company: { type: Type.STRING, nullable: true },
    position: { type: Type.STRING, nullable: true },
    term: { type: Type.STRING, enum: [...TERMS], nullable: true },
    industry: { type: Type.STRING, enum: [...INDUSTRIES] },
    companyType: { type: Type.STRING, enum: [...COMPANY_TYPES] },
    status: { type: Type.STRING, enum: [...APPLICATION_STATUSES] },
    summary: { type: Type.STRING, nullable: true },
  },
  required: ["isApplicationRelated"],
  propertyOrdering: [
    "isApplicationRelated",
    "company",
    "position",
    "term",
    "industry",
    "companyType",
    "status",
    "summary",
  ],
};

export async function classifyWithGemini(
  email: ParsedEmail,
): Promise<ClassificationResult> {
  const ai = getClient();
  const contents = `From: ${email.from}
Subject: ${email.subject}
Date: ${email.date.toISOString()}

${email.body || email.snippet}`;

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: GEMINI_MODEL,
      contents,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema,
        temperature: 0,
      },
    }),
  );

  const raw = parseJson(response.text);
  const isApplicationRelated = raw.isApplicationRelated === true;

  return {
    isApplicationRelated,
    company: cleanString(raw.company),
    position: cleanString(raw.position),
    term: asEnum(raw.term, TERMS) as Term | null,
    industry: asEnum(raw.industry, INDUSTRIES) as Industry | null,
    companyType: asEnum(raw.companyType, COMPANY_TYPES) as CompanyType | null,
    status: asEnum(raw.status, APPLICATION_STATUSES) as ApplicationStatus | null,
    summary: cleanString(raw.summary),
    source: "gemini",
  };
}

// Retry transient Gemini failures (503 overloaded, 429 rate limit, 500) with
// exponential backoff. Non-transient errors throw immediately.
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts - 1 || !isTransient(err)) throw err;
      const delay = 600 * 2 ** i + Math.floor(Math.random() * 250);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

function isTransient(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const status = (err as { status?: number })?.status;
  return (
    status === 429 ||
    status === 500 ||
    status === 503 ||
    /\b(429|500|503)\b/.test(msg) ||
    /UNAVAILABLE|RESOURCE_EXHAUSTED|INTERNAL|overloaded|high demand|deadline/i.test(
      msg,
    )
  );
}

function parseJson(text: string | undefined): Record<string, unknown> {
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "unknown" || trimmed.toLowerCase() === "null") {
    return null;
  }
  return trimmed;
}

function asEnum<T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] | null {
  if (typeof value !== "string") return null;
  return (allowed as readonly string[]).includes(value)
    ? (value as T[number])
    : null;
}
