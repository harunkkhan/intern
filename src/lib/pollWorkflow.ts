import "server-only";

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
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) throw new Error("GITHUB_DISPATCH_TOKEN is not set");

  const res = await fetch(
    "https://api.github.com/repos/harunkkhan/intern/actions/workflows/poll.yml/dispatches",
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2026-03-10",
      },
      body: JSON.stringify({ ref: "main", inputs }),
    },
  );
  if (!res.ok) {
    throw new Error(
      `poll.yml dispatch failed: HTTP ${res.status} ${await res.text()}`,
    );
  }
  return (await res.json()) as PollWorkflowRun;
}
