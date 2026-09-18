import "server-only";

const WORKFLOW_URL =
  "https://api.github.com/repos/harunkkhan/intern/actions/workflows/poll.yml";

function githubHeaders(): Record<string, string> {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) throw new Error("GITHUB_DISPATCH_TOKEN is not set");
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2026-03-10",
  };
}

export interface PollWorkflowRun {
  workflow_run_id: number;
  run_url: string;
  html_url: string;
}

// Inputs go over the API as strings, the way the Actions UI and `gh workflow run
// -f` send them; the workflow's `inputs` context still types booleans.
export async function dispatchPollWorkflow(
  inputs: Record<string, string>,
): Promise<PollWorkflowRun> {
  const res = await fetch(`${WORKFLOW_URL}/dispatches`, {
    method: "POST",
    headers: githubHeaders(),
    body: JSON.stringify({ ref: "main", inputs }),
  });
  if (!res.ok) {
    throw new Error(
      `poll.yml dispatch failed: HTTP ${res.status} ${await res.text()}`,
    );
  }
  return (await res.json()) as PollWorkflowRun;
}

// Every status that means a run has not finished. `status` takes one value per
// request, so they are asked for separately: in_progress is the loop actually
// running, and the rest are the ways a run waits — for the concurrency group,
// for a runner, for a deployment approval.
const ACTIVE_RUN_STATUSES = [
  "in_progress",
  "queued",
  "pending",
  "waiting",
  "requested",
] as const;

export interface ActivePollRun {
  id: number;
  status: string;
  event: string;
  created_at: string;
  html_url: string;
}

/**
 * poll.yml runs that are still alive. Callers check this before dispatching,
 * because `concurrency: poll-job-listings` replaces any pending run in the group
 * with the newest one: a one-shot dispatch while the weekday loop holds the
 * group would cancel the queued standby the zero-gap handoff depends on, and
 * would then sit pending itself rather than poll anything.
 */
export async function listActivePollRuns(): Promise<ActivePollRun[]> {
  const headers = githubHeaders();
  const pages = await Promise.all(
    ACTIVE_RUN_STATUSES.map(async (status) => {
      const res = await fetch(
        `${WORKFLOW_URL}/runs?status=${status}&per_page=10&exclude_pull_requests=true`,
        { headers, cache: "no-store" },
      );
      if (!res.ok) {
        throw new Error(
          `poll.yml run lookup failed: HTTP ${res.status} ${await res.text()}`,
        );
      }
      const body = (await res.json()) as { workflow_runs?: ActivePollRun[] };
      return body.workflow_runs ?? [];
    }),
  );

  // A run can be returned under more than one status only if it changes between
  // the parallel requests, but the caller shows the first one, so keep it stable.
  const byId = new Map<number, ActivePollRun>();
  for (const run of pages.flat()) {
    if (!byId.has(run.id)) byId.set(run.id, run);
  }
  return [...byId.values()].sort((a, b) =>
    a.created_at < b.created_at ? 1 : -1,
  );
}
