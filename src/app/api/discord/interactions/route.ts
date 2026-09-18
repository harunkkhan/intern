import { after, NextResponse } from "next/server";
import { getEnabledSourceLabels, isEnabledSourceLabel } from "@/lib/alerts";
import {
  editDiscordInteractionReply,
  verifyDiscordSignature,
} from "@/lib/discordWebhook";
import { dispatchPollWorkflow, listActivePollRuns } from "@/lib/pollWorkflow";

// The deferred half of a /load runs in after(), inside this invocation, and a
// cold Supabase connection plus five GitHub calls plus the dispatch is more than
// the platform default allows for.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Interaction types Discord sends.
const PING = 1;
const APPLICATION_COMMAND = 2;
const APPLICATION_COMMAND_AUTOCOMPLETE = 4;

// Response types Discord expects back.
const PONG = 1;
const DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE = 5;
const APPLICATION_COMMAND_AUTOCOMPLETE_RESULT = 8;

interface InteractionOption {
  name?: string;
  value?: unknown;
  focused?: boolean;
}

interface Interaction {
  type?: number;
  token?: string;
  data?: { name?: string; options?: InteractionOption[] };
}

function stringOption(
  interaction: Interaction,
  name: string,
): string | undefined {
  const option = interaction.data?.options?.find((o) => o.name === name);
  return typeof option?.value === "string" ? option.value : undefined;
}

export async function POST(req: Request) {
  // The signature covers the bytes as sent, so the raw text is read first and
  // parsed only once it has been verified.
  const body = await req.text();
  const verified = verifyDiscordSignature(
    process.env.DISCORD_PUBLIC_KEY,
    req.headers.get("x-signature-ed25519"),
    req.headers.get("x-signature-timestamp"),
    body,
  );
  if (!verified) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let interaction: Interaction;
  try {
    interaction = JSON.parse(body) as Interaction;
  } catch {
    return NextResponse.json({ error: "Malformed body" }, { status: 400 });
  }

  if (interaction.type === PING) {
    return NextResponse.json({ type: PONG });
  }

  if (interaction.data?.name !== "load") {
    return NextResponse.json({ error: "Unknown command" }, { status: 400 });
  }

  if (interaction.type === APPLICATION_COMMAND_AUTOCOMPLETE) {
    // Autocomplete cannot be deferred: the choices have to be in this response,
    // which is why the query behind it is a single indexed read.
    const focused = interaction.data.options?.find((o) => o.focused);
    const typed = typeof focused?.value === "string" ? focused.value : "";
    const labels = await getEnabledSourceLabels(typed);
    return NextResponse.json({
      type: APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
      data: { choices: labels.map((label) => ({ name: label, value: label })) },
    });
  }

  if (interaction.type === APPLICATION_COMMAND) {
    const token = interaction.token;
    if (!token) {
      return NextResponse.json({ error: "Missing token" }, { status: 400 });
    }
    const source = stringOption(interaction, "source");
    // Nothing is awaited between here and the response: Discord invalidates the
    // interaction if the first reply takes more than three seconds, and one
    // database round-trip on a cold connection can be most of that on its own.
    after(() => runLoad(token, source));
    return NextResponse.json({ type: DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE });
  }

  return NextResponse.json(
    { error: "Unsupported interaction type" },
    { status: 400 },
  );
}

async function runLoad(token: string, source: string | undefined) {
  const applicationId = process.env.DISCORD_APP_ID;
  if (!applicationId) return;

  let reply: string;
  try {
    reply = await startPoll(source);
  } catch (err) {
    reply = `Could not start a poll: ${err instanceof Error ? err.message : "unknown error"}`;
  }

  // The interaction is already answered with a placeholder; failing to replace
  // it leaves that placeholder in the channel, which is the best available
  // outcome and not worth crashing the invocation over.
  await editDiscordInteractionReply(applicationId, token, reply).catch(
    () => {},
  );
}

async function startPoll(source: string | undefined): Promise<string> {
  if (source !== undefined && !(await isEnabledSourceLabel(source))) {
    return `No enabled source is called "${source.slice(0, 100)}". Pick one from the suggestions, or run /load with no source to poll everything.`;
  }

  const active = await listActivePollRuns();
  const running = active[0];
  if (running) {
    return `Already polling — that run posts whatever it finds, so there is nothing to start.\n${running.html_url}`;
  }

  // `loop` is deliberately not sent. The workflow declares it `type: boolean,
  // default: false`, and an omitted input takes that default as a real boolean;
  // sending the string "false" would depend on the API coercing it, and a string
  // that stayed a string is truthy and would route this to the 5h45m loop.
  const inputs: Record<string, string> = {};
  if (source !== undefined) inputs.source = source;
  const run = await dispatchPollWorkflow(inputs);

  const what = source === undefined ? "every source due" : `"${source}"`;
  return `Polling ${what} now — new postings land in this channel in a few minutes.\n${run.html_url}`;
}
