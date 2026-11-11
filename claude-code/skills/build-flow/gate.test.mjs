import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { recordSession } from './session.mjs';

const GATE = path.join(import.meta.dirname, 'gate.mjs');

function gate(input) {
  const raw = typeof input === 'string' ? input : JSON.stringify(input);
  const r = spawnSync(process.execPath, [GATE], { input: raw, encoding: 'utf8' });
  if (!r.stdout.trim()) return 'allow';
  return JSON.parse(r.stdout).hookSpecificOutput.permissionDecision;
}
const bash = (command) => gate({ tool_name: 'Bash', tool_input: { command } });
// The reason the hook gives with its decision.
const reason = (input) =>
  JSON.parse(spawnSync(process.execPath, [GATE], { input: JSON.stringify(input), encoding: 'utf8' }).stdout).hookSpecificOutput
    .permissionDecisionReason;

test('asks the human on human-gate events however the command is chained', () => {
  for (const cmd of [
    'build-flow send /r APPROVE --note "ok"',
    "build-flow send /r 'REJECT' --note x",
    'node ~/.claude/skills/build-flow/flow.mjs send /r CONTINUE --note x',
    'build-flow send /r CONTINUE; echo done',
    'R=/r; build-flow send $R APPROVE|| true',
    'E=APPROVE; build-flow send /r $E --note x',
    'build-flow send /r ACCEPT --note "as it stands"',
    'build-flow send /r WORKSPACE_READY --target /wt --branch feat --note "ok"',
    "build-flow send APPROVE --note 'ok'",
    "build-flow send REJECT --note 'say \"PEAN\"'",
  ])
    assert.equal(bash(cmd), 'ask', cmd);
});

test('allows agent events and read-only commands', () => {
  for (const cmd of [
    'build-flow send /r BUILT',
    'build-flow send /r BUILT --message "feat: APPROVE flow"',
    'R=/r; build-flow send $R REVIEWED && build-flow next $R',
    'build-flow next /r',
    'build-flow status /r',
    'build-flow handoff /r',
    'build-flow send /r REPAIRED --note "then the human will APPROVE"',
    'git -C /repo add -A -N && git -C /repo diff --stat abc123',
    'git log --oneline -5',
    'git status',
    'create-flow send /r SPEC_DRAFTED',
  ])
    assert.equal(bash(cmd), 'allow', cmd);
});

test('denies init to the agent', () => {
  assert.equal(bash('build-flow init /r --target /repo --spec s --tickets t --gate end'), 'deny');
  assert.equal(bash('build-flow next ~/builds/init-screen'), 'allow');
});

test('denies committing and shipping', () => {
  for (const cmd of [
    'git commit -m x',
    'git -C /repo commit -am "Ticket 01"',
    'git add -A && git commit -m x',
    'git push origin main',
    'git merge feature',
    'git rebase main',
    'git reset --hard HEAD~1',
    'gh pr create --fill',
  ])
    assert.equal(bash(cmd), 'deny', cmd);
});

test('denies Bash that names the state files', () => {
  assert.equal(bash('cat /r/flow.json'), 'deny');
  assert.equal(bash('tail -n 3 "/r/events.jsonl"'), 'deny');
});

test('denies Edit/Write of state, input and queue inside a build-flow run; allows the rest', () => {
  const run = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-test-'));
  fs.writeFileSync(path.join(run, 'flow.json'), JSON.stringify({ flow: 'build-flow' }));
  const w = (p, tool_name = 'Write') => gate({ tool_name, tool_input: { file_path: path.join(run, p) } });
  for (const tool of ['Edit', 'Write', 'MultiEdit']) {
    assert.equal(w('flow.json', tool), 'deny', tool);
    assert.equal(w('events.jsonl', tool), 'deny', tool);
    assert.equal(w('input/SPEC.md', tool), 'deny', tool);
    assert.equal(w('input/tickets/01-A.md', tool), 'deny', tool);
  }
  assert.equal(w('build/01/IMPL.md'), 'allow');
  assert.equal(w('review/REVIEW.md'), 'allow');

  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-test-'));
  fs.writeFileSync(path.join(other, 'flow.json'), JSON.stringify({ flow: 'create-flow' }));
  assert.equal(gate({ tool_name: 'Write', tool_input: { file_path: path.join(other, 'input/x.md') } }), 'allow', 'not a build-flow run');
});

test('a gate event chained with a denied command is still denied', () => {
  assert.equal(bash("build-flow send APPROVE --note 'ok' && git push"), 'deny');
  assert.equal(bash("build-flow send /r APPROVE --note 'ok'; cat /r/flow.json"), 'deny');
});

test('from a subagent: denies moving a run, committing and the state files; allows its own work', () => {
  const sub = (command) => gate({ agent_id: 'a1', tool_name: 'Bash', tool_input: { command } });
  for (const cmd of [
    'build-flow send /r BUILT',
    'build-flow handoff /r',
    'build-flow init /r --gate end',
    'git -C /repo commit -am x',
    'git push',
    'cat /r/flow.json',
  ])
    assert.equal(sub(cmd), 'deny', cmd);
  for (const cmd of ['npm test', 'git -C /repo status', 'git diff --stat', 'build-flow status /r']) assert.equal(sub(cmd), 'allow', cmd);
  assert.match(reason({ agent_id: 'a1', tool_name: 'Bash', tool_input: { command: 'git commit -m x' } }), /never yours/);
  assert.equal(bash('build-flow handoff /r'), 'allow', 'the orchestrator may');
});

test('a gate prompt warns the human of a --gate end run in a permission mode that prompts', () => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-test-'));
  process.env.BUILD_FLOW_LAST_RUN = path.join(state, 'last-run');
  const session = (sid, gateMode) => {
    const run = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-test-'));
    fs.writeFileSync(path.join(run, 'flow.json'), JSON.stringify({ flow: 'build-flow', gate: gateMode }));
    recordSession('build-flow', sid, run, false);
  };
  session('s-end', 'end');
  session('s-ticket', 'ticket');
  const prompt = (session_id, permission_mode) =>
    reason({ session_id, permission_mode, tool_name: 'Bash', tool_input: { command: "build-flow send WORKSPACE_READY --at WORKSPACE --note 'ok'" } });

  assert.match(prompt('s-end', 'default'), /WARNING.*--gate end.*"default".*auto mode/);
  assert.match(prompt('s-end', 'acceptEdits'), /WARNING.*"acceptEdits"/);
  assert.match(prompt('s-end', undefined), /WARNING/);
  for (const mode of ['auto', 'bypassPermissions']) assert.doesNotMatch(prompt('s-end', mode), /WARNING/, mode);
  assert.doesNotMatch(prompt('s-ticket', 'default'), /WARNING/, 'gate ticket');
  assert.doesNotMatch(prompt('s-unknown', 'default'), /WARNING/, 'no run recorded');
  assert.match(prompt('s-unknown', 'default'), /^Human gate:/);
  delete process.env.BUILD_FLOW_LAST_RUN;
});

test('malformed hook input is ignored', () => {
  assert.equal(gate('not json'), 'allow');
  assert.equal(gate({}), 'allow');
});
