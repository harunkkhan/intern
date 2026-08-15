import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { behavioralQuestions, behavioralSections } from "@/db/schema";

export interface BehavioralQuestionDTO {
  id: string;
  prompt: string;
  answer: string;
  updatedAt: string;
}

export interface BehavioralSectionDTO {
  id: string;
  name: string;
  questions: BehavioralQuestionDTO[];
}

// Sections oldest first so the page keeps a stable top-to-bottom order across
// refreshes, and questions likewise inside each section.
export async function getBehavioralData(
  userId: string,
): Promise<BehavioralSectionDTO[]> {
  const sections = await db
    .select()
    .from(behavioralSections)
    .where(eq(behavioralSections.userId, userId))
    .orderBy(asc(behavioralSections.createdAt));

  if (sections.length === 0) return [];

  const questions = await db
    .select()
    .from(behavioralQuestions)
    .where(eq(behavioralQuestions.userId, userId))
    .orderBy(asc(behavioralQuestions.createdAt));

  const bySection = new Map<string, BehavioralQuestionDTO[]>();
  for (const q of questions) {
    const list = bySection.get(q.sectionId) ?? [];
    list.push({
      id: q.id,
      prompt: q.prompt,
      answer: q.answer,
      updatedAt: q.updatedAt.toISOString(),
    });
    bySection.set(q.sectionId, list);
  }

  return sections.map((s) => ({
    id: s.id,
    name: s.name,
    questions: bySection.get(s.id) ?? [],
  }));
}
