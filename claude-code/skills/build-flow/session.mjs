// Which run a Claude Code session is driving. The engine records it on every command (Claude Code sets
// CLAUDE_CODE_SESSION_ID in the Bash tool's environment); the Stop hook reads it by the session id in its input.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The file holding the run folder last named on the command line, for the flow called `name`.
export const lastRunFile = (name) =>
  process.env[`${name.toUpperCase().replace(/-/g, "_")}_LAST_RUN`] ??
  path.join(os.homedir(), ".local", "state", name, "last-run");

// A session id is used as a file name: anything else is ignored.
const file = (name, sid) =>
  /^[\w-]+$/.test(sid ?? "")
    ? path.join(path.dirname(lastRunFile(name)), "sessions", sid)
    : null;

// `paused` is set by the command that ends a session's work on the run (handoff); any later command clears it.
export function recordSession(name, sid, run, paused) {
  const f = file(name, sid);
  if (!f) return;
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ run: path.resolve(run), paused }) + "\n");
}

// { run, paused } for the session, or null when it has driven no run.
export function readSession(name, sid) {
  const f = file(name, sid);
  if (!f || !fs.existsSync(f)) return null;
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return null;
  }
}
