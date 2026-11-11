#!/usr/bin/env node
// PostToolUse(Bash|Edit|Write|Agent) hook, registered by SKILL.md. See README.md.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import def from "./flow.definition.mjs";

// Single source of truth for when the orchestrator should recommend a new session.
const THRESH = 150_000;
const STEP = 25_000; // warn again every STEP tokens past THRESH

let input;
try {
  input = JSON.parse(fs.readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}
const { transcript_path: tp, session_id: sid } = input;
if (!tp || !fs.existsSync(tp)) process.exit(0);

// Context occupancy = input + cache tokens of the last assistant turn; only the transcript's tail is read.
const fd = fs.openSync(tp, "r");
const size = fs.fstatSync(fd).size;
const len = Math.min(size, 512 * 1024);
const buf = Buffer.alloc(len);
fs.readSync(fd, buf, 0, len, size - len);
fs.closeSync(fd);

let ctx = 0;
for (const line of buf.toString("utf8").split("\n").reverse()) {
  try {
    const o = JSON.parse(line);
    const u = o.type === "assistant" && o.message?.usage;
    if (!u) continue;
    ctx =
      (u.input_tokens ?? 0) +
      (u.cache_read_input_tokens ?? 0) +
      (u.cache_creation_input_tokens ?? 0);
    if (ctx) break;
  } catch {}
}
const mark = path.join(os.tmpdir(), `${def.id}-ctx-${sid}`);
// Back under the threshold (e.g. after /compact): forget the bands already warned about.
if (ctx < THRESH) {
  fs.rmSync(mark, { force: true });
  process.exit(0);
}

const band = Math.floor((ctx - THRESH) / STEP);
if (fs.existsSync(mark) && Number(fs.readFileSync(mark, "utf8")) >= band)
  process.exit(0);
fs.writeFileSync(mark, String(band));

console.log(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext:
        `[ctx] main session ≈ ${ctx.toLocaleString("en")} tokens (threshold ${THRESH / 1000}K). ` +
        `Recommend a new session to the human now; on their go-ahead, follow "Ending a session" in the ${def.id} skill.`,
    },
  }),
);
