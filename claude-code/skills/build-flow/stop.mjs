#!/usr/bin/env node
// Stop hook, registered by SKILL.md. See README.md.
// Keeps a --gate end run going while the human is away: when the orchestrator ends its turn in a state that is the
// agents' to work, it is told to carry on. It never loops for ever: Claude Code itself ends the turn after 8 blocks
// in a row with no tool call in between (CLAUDE_CODE_STOP_HOOK_BLOCK_CAP).
import fs from "node:fs";
import path from "node:path";
import def from "./flow.definition.mjs";
import { readSession } from "./session.mjs";

const NAME = def.id;
const LOG = "stop-hook.log";
// A background task in one of these states will never wake the session.
const ENDED = /^(completed?|done|failed|error|killed|cancell?ed|stopped|timed_?out)$/i;

let input;
try {
  input = JSON.parse(fs.readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}

// Only the run this session drives: another session's run is not this one's to push.
const session = readSession(NAME, input.session_id);
if (!session) process.exit(0);
const { run } = session;

let st;
try {
  st = JSON.parse(fs.readFileSync(path.join(run, "flow.json"), "utf8"));
} catch {
  process.exit(0);
}
// With --gate ticket the hook does nothing at all.
if (st.flow !== NAME || st.gate !== "end") process.exit(0);

const where = `${st.state}${st.ticket ? `, ticket ${st.ticket}` : ""}`;
function done(decision, why) {
  try {
    fs.appendFileSync(
      path.join(run, LOG),
      `${new Date().toISOString()} ${decision} (${where}): ${why}\n`,
    );
  } catch {}
  process.exit(0);
}

if (def.states[st.state]?.actor !== "agents")
  done("allow", "the state is the human's");
if (session.paused) done("allow", "a handoff was written: the session is ending");
const running = (input.background_tasks ?? []).filter(
  (t) => !ENDED.test(t.status ?? ""),
);
if (running.length)
  done(
    "allow",
    `waiting on ${running.map((t) => `${t.type ?? "task"} ${t.id ?? "?"}`).join(", ")}`,
  );

console.log(
  JSON.stringify({
    decision: "block",
    reason:
      `[${NAME}] The run ${run} is in ${where}, with --gate end: the human is away and nobody will read a reply, ` +
      `so don't stop and don't wait for an answer. Run \`${NAME} next ${run}\` and carry out its instructions. ` +
      `A question goes in DECISIONS.md as an Open question, with the assumption you go on with. ` +
      `If the work truly can't go on, write ESCALATION.md and send the escalation event the state names. ` +
      `If the human has just told you to stop, run \`${NAME} handoff ${run}\` as "Ending a session" describes.`,
  }),
);
done("block", "the turn ended with work left and nothing running");
