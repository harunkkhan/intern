import "server-only";
import { GoogleGenAI, Type } from "@google/genai";
import {
  APPLICATION_STATUSES,
  INDUSTRIES,
  POSITION_TYPES,
  type ApplicationStatus,
  type ClassificationResult,
  type Industry,
  type PositionType,
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
- positionType: the best-fitting category for the role.
- industry: the hiring company's primary industry.
- status: where the application now stands based on THIS email:
    applied = application submitted/received/confirmed
    assessment = online assessment, coding challenge, take-home, or recruiter screen requested
    interview = interview invitation or scheduling
    offer = offer extended
    rejected = not moving forward / declined
    withdrawn = candidate withdrew
- summary: one concise sentence describing what this email says about the application.

Base every field only on the email content. Prefer "Other" over guessing for positionType/industry when genuinely unclear.`;

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    isApplicationRelated: { type: Type.BOOLEAN },
    company: { type: Type.STRING, nullable: true },
    position: { type: Type.STRING, nullable: true },
    positionType: { type: Type.STRING, enum: [...POSITION_TYPES] },
    industry: { type: Type.STRING, enum: [...INDUSTRIES] },
    status: { type: Type.STRING, enum: [...APPLICATION_STATUSES] },
    summary: { type: Type.STRING, nullable: true },
  },
  required: ["isApplicationRelated"],
  propertyOrdering: [
    "isApplicationRelated",
    "company",
    "position",
    "positionType",
    "industry",
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

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents,
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      responseSchema,
      temperature: 0,
    },
  });

  const raw = parseJson(response.text);
  const isApplicationRelated = raw.isApplicationRelated === true;

  return {
    isApplicationRelated,
    company: cleanString(raw.company),
    position: cleanString(raw.position),
    positionType: asEnum(raw.positionType, POSITION_TYPES) as PositionType | null,
    industry: asEnum(raw.industry, INDUSTRIES) as Industry | null,
    status: asEnum(raw.status, APPLICATION_STATUSES) as ApplicationStatus | null,
    summary: cleanString(raw.summary),
    source: "gemini",
  };
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
