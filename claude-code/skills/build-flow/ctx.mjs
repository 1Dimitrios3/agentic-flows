#!/usr/bin/env node
// PostToolUse(Bash|Edit|Write|Agent) hook, registered by SKILL.md. See README.md.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import def from "./flow.definition.mjs";
import { contextTokens } from "./usage.mjs";

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

const ctx = contextTokens(tp);
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
        `Don't stop or wait for a reply: keep working. Offer a new session when you next present a human gate; see "Ending a session" in the ${def.id} skill.`,
    },
  }),
);
