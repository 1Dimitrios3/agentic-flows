#!/usr/bin/env node
// PreToolUse(Bash|Edit|Write|MultiEdit) hook, registered by SKILL.md for the orchestrator and by the
// bf-code-implementer agent's frontmatter for itself (a skill's hooks don't reach subagents). See README.md.
import fs from 'node:fs';
import path from 'node:path';
import def from './flow.definition.mjs';
import { readSession } from './session.mjs';

const NAME = def.id;
const gates = new Set(
  Object.values(def.states).flatMap((s) => Object.entries(s.on).filter(([, t]) => t.human).map(([ev]) => ev)),
);
// Whole-word match, so a gate event is caught however the command is chained or quoted (APPROVE; E=APPROVE).
const GATE_WORD = new RegExp(String.raw`\b(${[...gates].join('|')})\b`);
// The CLI by its linked name or as <name>/flow.mjs; the name is escaped, so it matches literally.
const CLI = String.raw`\b${NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:/flow\.mjs)?\s+`;
const STATE_FILE = /(^|[\s/'"])(flow\.json|events\.jsonl)\b/;
// A git subcommand anywhere in one simple command (stops at ; & | and newlines).
const GIT = (sub) => new RegExp(String.raw`\bgit\b[^;&|\n]*?\s${sub}\b`);
const SHIP = [GIT('push'), GIT('merge'), GIT('rebase'), GIT('commit'), GIT(String.raw`reset\s+--hard`), /\bgh\s+pr\b/];

function decide(permissionDecision, reason) {
  console.log(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, permissionDecisionReason: reason },
  }));
  process.exit(0);
}
const deny = (reason) => decide('deny', reason);
// 'ask' puts the exact command in front of the human; the event goes through only if they accept it.
const ask = (reason) => decide('ask', reason);

// The run folder of this flow holding a file, if any.
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
// Set when the call comes from a subagent: the hook is then the one in that agent's own frontmatter.
const sub = !!input.agent_id;

// For the human, in the prompt of a gate event: after it the agents work alone, and with --gate end the human may
// leave, so a permission prompt would stall the run. Only auto and bypassPermissions never prompt.
function awayWarning() {
  if (['auto', 'bypassPermissions'].includes(input.permission_mode)) return '';
  let gateMode;
  try {
    const { run } = readSession(NAME, input.session_id);
    gateMode = JSON.parse(fs.readFileSync(path.join(run, 'flow.json'), 'utf8')).gate;
  } catch {}
  if (gateMode !== 'end') return '';
  return ` WARNING: this is a --gate end run and the session is in "${input.permission_mode ?? 'default'}" permission mode, ` +
    'so the first edit or command that needs your approval will stall the run while you are away. ' +
    'Switch to auto mode (Shift+Tab cycles the modes) before you leave.';
}

if (tool_name === 'Bash') {
  const cmd = tool_input.command ?? '';
  // A gate word inside a --note, --message or --unchanged is prose, not the event.
  const bare = cmd.replace(/--(note|message|unchanged)\s+("[^"]*"|'[^']*'|\S+)/g, '');
  if (sub && new RegExp(CLI + '(init|send|handoff)\\b').test(cmd))
    deny(`Only the orchestrator moves a ${NAME} run: report back to it instead.`);
  if (new RegExp(CLI + 'init\\b').test(cmd))
    deny(`Only the human creates a run: ask them to type \`! ${NAME} init <run> ...\` (\`${NAME}\` with no arguments prints the flags), then start again with \`/${NAME} <run>\`.`);
  if (STATE_FILE.test(cmd)) deny(`flow.json and events.jsonl change only through ${NAME}; read state with \`${NAME} status <run>\`.`);
  if (SHIP.some((r) => r.test(bare)))
    deny(
      sub
        ? 'Committing, pushing, merging, rebasing, resetting and PRs are never yours: leave the work in the working tree and report it.'
        : `${NAME} records each green ticket itself (${NAME} send); pushing, merging, rebasing, resetting and PRs are the human's.`,
    );
  // Last, so a denied command chained with a gate event is still denied.
  if (new RegExp(CLI + 'send\\b').test(cmd) && GATE_WORD.test(bare))
    ask(`Human gate: accept only if the run, the event, its options and --note match your verdict (${[...gates].join('/')}).${awayWarning()}`);
} else {
  const f = path.resolve(tool_input.file_path ?? '');
  const run = tool_input.file_path && runOf(f);
  if (run) {
    const rel = path.relative(run, f);
    if (['flow.json', 'events.jsonl'].includes(rel)) deny(`flow.json and events.jsonl change only through ${NAME} send.`);
    if (rel.startsWith(`input${path.sep}`)) deny(`${rel} is the run's fixed input; it is not edited during the build.`);
  }
}
