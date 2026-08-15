// Analytics for the application funnel.
//
// Two sources of truth have to be reconciled. `status` is where an application
// stands now; `events` is how it got there. They can disagree — editing an
// application in the details drawer sets a status without writing an event, and
// the tracked data already contains an offer with no offer event behind it. The
// stages an application touched are therefore the union of the two, never one.

import type { ApplicationDTO, ApplicationStatus } from "./types";

// Everything the charts are allowed to see. The stage flags — `oaCompleted` and
// `interviewPending` — are deliberately absent: they record that you have done
// your part at a stage, not that the application moved, so a finished OA or a
// finished interview must leave every chart exactly where it was. Only a real
// event moves anything, which in practice means an offer, a new interview, or a
// rejection.
//
// This is a type, not a convention, precisely so it cannot rot: the flags are
// not on it, so nothing in this file can read one by accident. Widening it back
// to ApplicationDTO would silently give the charts access again.
export type FunnelApplication = Pick<
  ApplicationDTO,
  "status" | "events" | "appliedAt" | "lastEventAt"
>;

// Applications whose term was never parsed out of the email still belong to a
// cycle — they just didn't say which. Counting them toward the current cycle
// keeps them from vanishing out of every term-scoped view, which for the
// tracked data is 16 of 81 applications.
export const ASSUMED_TERM = "Summer 2027";

export function effectiveTerm(app: { term: string | null }): string {
  return app.term ?? ASSUMED_TERM;
}

// Days of silence after which a live application is shown as unanswered rather
// than pending. Nothing in an inbox states "ghosted", so unlike everything else
// here this is a judgment call rather than a measurement — hence a named
// constant instead of a literal buried in a predicate.
export const NO_RESPONSE_AFTER_DAYS = 30;

export type FunnelNodeId =
  | "applications"
  | "assessment"
  | "interview"
  | "offer"
  | "rejected"
  | "withdrawn"
  | "noResponse"
  | "awaiting";

export interface FunnelNode {
  id: FunnelNodeId;
  label: string;
  value: number;
  /** Column index. A terminal sits one past the deepest stage feeding it. */
  depth: number;
}

export interface FunnelLink {
  source: FunnelNodeId;
  target: FunnelNodeId;
  value: number;
}

export interface Funnel {
  nodes: FunnelNode[];
  links: FunnelLink[];
  total: number;
}

export const FUNNEL_LABELS: Record<FunnelNodeId, string> = {
  applications: "Applications",
  assessment: "OA",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  noResponse: `No response (${NO_RESPONSE_AFTER_DAYS}d+)`,
  awaiting: "Awaiting response",
};

const FIXED_DEPTHS = new Set<FunnelNodeId>([
  "applications",
  "assessment",
  "interview",
  "offer",
]);

// The stages an application advances through, in order. `applied` is absent on
// purpose: it is the source every application leaves, not a place it can stall.
const PROGRESS: { status: ApplicationStatus; id: FunnelNodeId }[] = [
  { status: "assessment", id: "assessment" },
  { status: "interview", id: "interview" },
  { status: "offer", id: "offer" },
];

/** Every stage an application has touched, from its events and its status. */
export function stagesTouched(app: FunnelApplication): Set<ApplicationStatus> {
  const touched = new Set<ApplicationStatus>(app.events.map((e) => e.status));
  touched.add(app.status);
  return touched;
}

function hasGoneQuiet(app: FunnelApplication, now: number): boolean {
  const last = app.lastEventAt ?? app.appliedAt;
  // With no date at all we cannot show it has gone quiet, so we don't claim it.
  if (!last) return false;
  const at = Date.parse(last);
  if (Number.isNaN(at)) return false;
  return now - at > NO_RESPONSE_AFTER_DAYS * 86_400_000;
}

/**
 * One application's path through the funnel: the progress stages it reached,
 * then wherever it came to rest.
 *
 * An offer is its own endpoint and gets no terminal after it. Everything else
 * either ended (rejected, withdrawn) or is still open.
 *
 * Only an application still sitting where it was submitted can go quiet. Once
 * one has reached an OA or an interview, silence is not evidence of anything —
 * you did the assessment, you know you are in the process, and the company
 * closes the loop with a rejection when it closes it. Ageing those out into
 * "no response" declared them dead on a timer and was simply wrong: it moved
 * nine of thirteen OAs into the dead column with nothing behind it but a date.
 */
function pathFor(app: FunnelApplication, now: number): FunnelNodeId[] {
  const touched = stagesTouched(app);
  const path: FunnelNodeId[] = ["applications"];
  for (const stage of PROGRESS) {
    if (touched.has(stage.status)) path.push(stage.id);
  }

  if (app.status === "rejected") path.push("rejected");
  else if (app.status === "withdrawn") path.push("withdrawn");
  else if (path[path.length - 1] !== "offer") {
    const neverProgressed = path.length === 1;
    path.push(
      neverProgressed && hasGoneQuiet(app, now) ? "noResponse" : "awaiting",
    );
  }
  return path;
}

/**
 * Builds the Sankey. Flow is conserved: each application contributes one unit
 * along exactly one path, so a node's inflow equals its outflow unless it is a
 * terminal.
 */
export function buildFunnel(
  apps: FunnelApplication[],
  now: number = Date.now(),
): Funnel {
  const links = new Map<string, FunnelLink>();

  for (const app of apps) {
    const path = pathFor(app, now);
    for (let i = 0; i < path.length - 1; i++) {
      const source = path[i]!;
      const target = path[i + 1]!;
      const key = `${source}->${target}`;
      const existing = links.get(key);
      if (existing) existing.value++;
      else links.set(key, { source, target, value: 1 });
    }
  }

  const all = [...links.values()];

  // The progress stages hold fixed columns so the chart always reads as a
  // funnel. Deriving them from the longest observed path instead would collapse
  // the stages nobody happened to take in order — with the tracked data no
  // application went OA then interview, which put Offer in the same column as
  // OA and made the whole thing read as a fan rather than a funnel.
  const depth = new Map<FunnelNodeId, number>([
    ["applications", 0],
    ["assessment", 1],
    ["interview", 2],
    ["offer", 3],
  ]);
  // A terminal has no fixed column: it belongs one past the deepest stage that
  // can reach it, which is what puts "Rejected" beside the OA it follows rather
  // than stranding every terminal together on the far right.
  for (let pass = 0; pass <= all.length; pass++) {
    let changed = false;
    for (const link of all) {
      if (depth.has(link.target) && FIXED_DEPTHS.has(link.target)) continue;
      const from = depth.get(link.source);
      if (from === undefined) continue;
      if ((depth.get(link.target) ?? -1) < from + 1) {
        depth.set(link.target, from + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const inflow = new Map<FunnelNodeId, number>();
  const outflow = new Map<FunnelNodeId, number>();
  for (const link of all) {
    inflow.set(link.target, (inflow.get(link.target) ?? 0) + link.value);
    outflow.set(link.source, (outflow.get(link.source) ?? 0) + link.value);
  }

  const nodes: FunnelNode[] = [...depth.entries()]
    .map(([id, d]) => ({
      id,
      label: FUNNEL_LABELS[id],
      value: Math.max(inflow.get(id) ?? 0, outflow.get(id) ?? 0),
      depth: d,
    }))
    .filter((n) => n.value > 0);

  // A stage nobody reached holds a fixed column that is now empty, which would
  // render as a blank gap. Squeeze the surviving columns back together.
  const used = [...new Set(nodes.map((n) => n.depth))].sort((a, b) => a - b);
  const column = new Map(used.map((d, i) => [d, i]));
  for (const node of nodes) node.depth = column.get(node.depth)!;

  return { nodes, links: all, total: apps.length };
}

export interface OutcomeStats {
  total: number;
  /** Reached the stage at some point — not "is sitting there now". */
  reachedAssessment: number;
  reachedInterview: number;
  offers: number;
  /** offers / total. Zero when there is nothing to divide by. */
  offerRate: number;
}

export function outcomeStats(apps: FunnelApplication[]): OutcomeStats {
  let reachedAssessment = 0;
  let reachedInterview = 0;
  let offers = 0;

  for (const app of apps) {
    const touched = stagesTouched(app);
    if (touched.has("assessment")) reachedAssessment++;
    if (touched.has("interview")) reachedInterview++;
    // An offer later declined or withdrawn was still an offer received, so this
    // counts the stage being touched rather than the application resting on it.
    if (touched.has("offer")) offers++;
  }

  return {
    total: apps.length,
    reachedAssessment,
    reachedInterview,
    offers,
    offerRate: apps.length ? offers / apps.length : 0,
  };
}
