import { google, type gmail_v1 } from "googleapis";
import type { GoogleAuthClient } from "@/lib/google";

export interface ParsedEmail {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: Date;
  snippet: string;
  body: string;
}

// Only emails on/after this date are tracked. Defaults to 2026-06-24; override
// with TRACK_AFTER (YYYY-MM-DD). This is enforced again in the sync loop so the
// cutoff holds even if GMAIL_QUERY is customized.
const DEFAULT_TRACK_AFTER = "2026-06-24";

export function getTrackAfterDate(): Date {
  const raw = process.env.TRACK_AFTER || DEFAULT_TRACK_AFTER;
  const d = new Date(`${raw}T00:00:00Z`);
  return isNaN(d.getTime()) ? new Date(`${DEFAULT_TRACK_AFTER}T00:00:00Z`) : d;
}

function gmailDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

// Gmail search used to find candidate application emails. Intentionally broad —
// the classifier filters out noise. Override with the GMAIL_QUERY env var.
export function defaultGmailQuery(): string {
  const after = `after:${gmailDate(getTrackAfterDate())}`;
  if (process.env.GMAIL_QUERY) return `${after} (${process.env.GMAIL_QUERY})`;
  const phrases = [
    '"thank you for applying"',
    '"application received"',
    '"we received your application"',
    '"your application"',
    '"application to"',
    '"applied to"',
    '"application has been"',
    '"interview"',
    '"next steps"',
    '"online assessment"',
    '"coding challenge"',
    '"take-home"',
    '"we regret to inform"',
    '"unfortunately"',
    '"move forward with your application"',
    '"extend an offer"',
    '"offer of employment"',
  ];
  return `${after} (${phrases.join(" OR ")})`;
}

export async function listCandidateMessages(
  auth: GoogleAuthClient,
  query: string,
  cap = 500,
): Promise<Array<{ id: string; threadId: string }>> {
  const gmail = google.gmail({ version: "v1", auth });
  const out: Array<{ id: string; threadId: string }> = [];
  let pageToken: string | undefined;

  do {
    const res = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: 100,
      pageToken,
    });
    for (const m of res.data.messages ?? []) {
      if (m.id && m.threadId) out.push({ id: m.id, threadId: m.threadId });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken && out.length < cap);

  return out.slice(0, cap);
}

export async function fetchEmail(
  auth: GoogleAuthClient,
  id: string,
): Promise<ParsedEmail> {
  const gmail = google.gmail({ version: "v1", auth });
  const res = await gmail.users.messages.get({
    userId: "me",
    id,
    format: "full",
  });
  const msg = res.data;
  const headers = msg.payload?.headers ?? [];
  const header = (name: string) =>
    headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ??
    "";

  const dateHeader = header("date");
  const date = msg.internalDate
    ? new Date(Number(msg.internalDate))
    : dateHeader
      ? new Date(dateHeader)
      : new Date(0);

  return {
    id: msg.id ?? id,
    threadId: msg.threadId ?? "",
    subject: header("subject"),
    from: header("from"),
    date,
    snippet: msg.snippet ?? "",
    body: extractBody(msg.payload).slice(0, 5000),
  };
}

function decode(data?: string | null): string {
  if (!data) return "";
  return Buffer.from(data, "base64url").toString("utf8");
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findPart(
  part: gmail_v1.Schema$MessagePart,
  mime: string,
): gmail_v1.Schema$MessagePart | undefined {
  if (part.mimeType === mime && part.body?.data) return part;
  for (const p of part.parts ?? []) {
    const found = findPart(p, mime);
    if (found) return found;
  }
  return undefined;
}

function extractBody(payload?: gmail_v1.Schema$MessagePart): string {
  if (!payload) return "";
  const plain = findPart(payload, "text/plain");
  if (plain?.body?.data) return decode(plain.body.data);
  const html = findPart(payload, "text/html");
  if (html?.body?.data) return stripHtml(decode(html.body.data));
  if (payload.body?.data) return decode(payload.body.data);
  return "";
}
