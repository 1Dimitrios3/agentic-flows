#!/usr/bin/env node
// PreToolUse(Bash|Edit|Write|MultiEdit) hook, registered by SKILL.md. See README.md.
import fs from 'node:fs';
import path from 'node:path';
import def from './flow.definition.mjs';

const gates = new Set(
  Object.values(def.states).flatMap((s) => Object.entries(s.on).filter(([, t]) => t.human).map(([ev]) => ev)),
);
// Whole-word match, so a gate event is caught however the command is chained or quoted (APPROVE; E=APPROVE).
const GATE_WORD = new RegExp(String.raw`\b(${[...gates].join('|')})\b`);
const STATE_FILE = /(^|[\s/'"])(flow\.json|events\.jsonl)\b/;
const NAME = def.id;
// The CLI by its linked name or as <name>/flow.mjs; the name is escaped, so it matches literally.
const CLI = String.raw`\b${NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:/flow\.mjs)?\s+`;

function decide(permissionDecision, reason) {
  console.log(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, permissionDecisionReason: reason },
  }));
  process.exit(0);
}
const deny = (reason) => decide('deny', reason);
// 'ask' puts the exact command in front of the human; the event goes through only if they accept it.
const ask = (reason) => decide('ask', reason);

function runOf(file) {
  for (let d = path.dirname(file); d !== path.dirname(d); d = path.dirname(d)) {
    const f = path.join(d, 'flow.json');
    if (!fs.existsSync(f)) continue;
    try {
      return JSON.parse(fs.readFileSync(f, 'utf8')).flow === def.id ? d : null;
    } catch {
      return null;
    }
  }
  return null;
}

let input;
try {
  input = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}
const { tool_name, tool_input = {} } = input;

if (tool_name === 'Bash') {
  const cmd = tool_input.command ?? '';
  // A gate word inside a --note is prose, not the event.
  const bare = cmd.replace(/--note\s+("[^"]*"|'[^']*'|\S+)/g, '');
  if (new RegExp(CLI + String.raw`init\b`).test(cmd))
    deny(`Only the human creates a run: ask them to type \`! ${NAME} init <run> --target <repo>\`, then start again with \`/${NAME} <run>\`.`);
  if (STATE_FILE.test(cmd)) deny(`flow.json and events.jsonl change only through ${NAME}; read state with \`${NAME} status <run>\`.`);
  // Last, so a denied command chained with a gate event is still denied.
  if (new RegExp(CLI + String.raw`send\b`).test(cmd) && GATE_WORD.test(bare))
    ask(`Human gate: accept only if this event and --note match your verdict (${[...gates].join('/')}).`);
} else {
  const f = path.resolve(tool_input.file_path ?? '');
  const run = tool_input.file_path && runOf(f);
  if (run && ['flow.json', 'events.jsonl'].includes(path.relative(run, f)))
    deny(`flow.json and events.jsonl change only through ${NAME} send.`);
}
