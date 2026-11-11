import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const GATE = path.join(import.meta.dirname, 'gate.mjs');

function gate(input) {
  const raw = typeof input === 'string' ? input : JSON.stringify(input);
  const r = spawnSync(process.execPath, [GATE], { input: raw, encoding: 'utf8' });
  if (!r.stdout.trim()) return 'allow';
  return JSON.parse(r.stdout).hookSpecificOutput.permissionDecision;
}
const bash = (command) => gate({ tool_name: 'Bash', tool_input: { command } });

test('asks the human on human-gate events however the command is chained', () => {
  for (const cmd of [
    'create-flow send /r APPROVE --note "ok"',
    "create-flow send /r 'REJECT' --note x",
    'node ~/.claude/skills/create-flow/flow.mjs send /r APPROVE --note x',
    'create-flow send /r APPROVE; echo done',
    'create-flow send /r APPROVE&&true',
    'R=/r; create-flow send $R REJECT|| true',
    'E=APPROVE; create-flow send /r $E --note x',
  ])
    assert.equal(bash(cmd), 'ask', cmd);
});

test('allows agent events and read-only commands', () => {
  for (const cmd of [
    'create-flow send /r SPEC_DRAFTED',
    'R=/r; create-flow send $R DISCOVERY_DONE && create-flow next $R',
    'create-flow next /r',
    'create-flow status /r',
    'create-flow handoff /r',
    'create-flow send /r SPEC_DRAFTED --note "then the human will APPROVE"',
    'create-flow next ~/flows/init-screen',
    'grep -n init ~/.claude/skills/create-flow/flow.mjs',
    'git status',
    'build-flow send /r APPROVE --note ok',
    'node ~/.claude/skills/build-flow/flow.mjs init /r --repo x',
  ])
    assert.equal(bash(cmd), 'allow', cmd);
});

test('denies init to the agent', () => {
  assert.equal(bash('create-flow init /r --target /repo'), 'deny');
});

test('denies Bash that names the state files', () => {
  assert.equal(bash('cat /r/flow.json'), 'deny');
  assert.equal(bash('tail -n 3 "/r/events.jsonl"'), 'deny');
});

test('denies Edit/Write of the state files inside a create-flow run; allows the rest', () => {
  const run = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-test-'));
  fs.writeFileSync(path.join(run, 'flow.json'), JSON.stringify({ flow: 'create-flow' }));
  const w = (p, tool_name = 'Write') => gate({ tool_name, tool_input: { file_path: path.join(run, p) } });
  for (const tool of ['Edit', 'Write', 'MultiEdit']) {
    assert.equal(w('flow.json', tool), 'deny', tool);
    assert.equal(w('events.jsonl', tool), 'deny', tool);
  }
  assert.equal(w('understanding/DECISIONS.md'), 'allow');
  assert.equal(w('sources/flow.json'), 'allow', 'only the run root holds the state');

  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-test-'));
  fs.writeFileSync(path.join(other, 'flow.json'), JSON.stringify({ flow: 'build-flow' }));
  assert.equal(gate({ tool_name: 'Write', tool_input: { file_path: path.join(other, 'flow.json') } }), 'allow', 'not a create-flow run');
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-test-'));
  assert.equal(gate({ tool_name: 'Write', tool_input: { file_path: path.join(elsewhere, 'flow.json') } }), 'allow', 'no run');
});

test('a gate event chained with a denied command is still denied', () => {
  assert.equal(bash('create-flow send /r APPROVE --note ok; cat /r/flow.json'), 'deny');
});

test('malformed hook input is ignored', () => {
  assert.equal(gate('not json'), 'allow');
  assert.equal(gate({}), 'allow');
});
