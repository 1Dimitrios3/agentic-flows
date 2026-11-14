import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recordSession, readSession } from './session.mjs';

const STOP = path.join(import.meta.dirname, 'stop.mjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stop-test-'));
// session.mjs keeps its records beside the last-run file: point it at the temp dir, for this process and the hook's.
process.env.BUILD_FLOW_LAST_RUN = path.join(dir, 'state', 'last-run');
after(() => fs.rmSync(dir, { recursive: true, force: true }));

let n = 0;
// A run folder in the given state, driven by a new session; returns both.
function run(fields, { paused = false } = {}) {
  const sid = `sid-${++n}`;
  const folder = path.join(dir, `run-${n}`);
  fs.mkdirSync(folder);
  fs.writeFileSync(
    path.join(folder, 'flow.json'),
    JSON.stringify({ flow: 'build-flow', gate: 'end', state: 'BUILD', ticket: '03', ...fields }),
  );
  recordSession('build-flow', sid, folder, paused);
  return { sid, folder };
}

// Runs the hook; returns the block reason, or '' when it lets the stop happen.
function stop(sid, extra = {}) {
  const raw = typeof sid === 'string' ? JSON.stringify({ session_id: sid, ...extra }) : sid.raw;
  const r = spawnSync(process.execPath, [STOP], { input: raw, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  if (!r.stdout.trim()) return '';
  const out = JSON.parse(r.stdout);
  assert.equal(out.decision, 'block');
  return out.reason;
}
const log = (folder) => fs.readFileSync(path.join(folder, 'stop-hook.log'), 'utf8');

test('blocks a stop in BUILD of a --gate end run, naming the run and the next command', () => {
  const { sid, folder } = run({});
  const reason = stop(sid);
  assert.match(reason, /BUILD, ticket 03/);
  assert.ok(reason.includes(`build-flow next ${folder}`));
  assert.match(log(folder), /block \(BUILD, ticket 03\)/);
});

test('blocks in every state that is the agents to work', () => {
  for (const state of ['WORKTREE', 'BUILD', 'REVIEW', 'REPAIR']) assert.notEqual(stop(run({ state }).sid), '', state);
});

test('blocks again while already continuing from a block: the cap on blocks in a row is Claude Code’s', () => {
  assert.notEqual(stop(run({}).sid, { stop_hook_active: true }), '');
});

test('does nothing for a --gate ticket run, not even a log line', () => {
  const { sid, folder } = run({ gate: 'ticket' });
  assert.equal(stop(sid), '');
  assert.ok(!fs.existsSync(path.join(folder, 'stop-hook.log')));
});

test('lets the stop happen in the human’s states and at the end', () => {
  for (const state of ['WORKSPACE', 'TICKET_GATE', 'BUILD_GATE', 'REVIEW_GATE', 'ESCALATED', 'DONE']) {
    const { sid, folder } = run({ state });
    assert.equal(stop(sid), '', state);
    assert.match(log(folder), /allow .*the human's/);
  }
});

test('lets the stop happen while a subagent or a background shell is running', () => {
  for (const type of ['subagent', 'shell']) {
    const { sid, folder } = run({});
    assert.equal(stop(sid, { background_tasks: [{ id: 'a1', type, status: 'running' }] }), '', type);
    assert.match(log(folder), new RegExp(`allow .*waiting on ${type} a1`));
  }
});

test('a background task that has ended wakes nobody, so the stop is blocked', () => {
  for (const status of ['completed', 'failed', 'killed', 'cancelled'])
    assert.notEqual(stop(run({}).sid, { background_tasks: [{ id: 'a1', type: 'subagent', status }] }), '', status);
});

test('lets the stop happen after a handoff, until the session works on the run again', () => {
  const { sid, folder } = run({}, { paused: true });
  assert.equal(stop(sid), '');
  assert.match(log(folder), /allow .*handoff/);
  recordSession('build-flow', sid, folder, false);
  assert.notEqual(stop(sid), '');
});

test('follows the run its own session drives, not the last run named', () => {
  const ticketRun = run({ gate: 'ticket' });
  const endRun = run({});
  assert.equal(stop(ticketRun.sid), '');
  assert.notEqual(stop(endRun.sid), '');
});

test('silent for a session that drives no run, a missing run, another flow or bad input', () => {
  assert.equal(stop('sid-unknown'), '');
  assert.equal(stop('../../etc/passwd'), '');
  const gone = run({});
  fs.rmSync(gone.folder, { recursive: true });
  assert.equal(stop(gone.sid), '');
  assert.equal(stop(run({ flow: 'create-flow' }).sid), '');
  assert.equal(stop({ raw: 'not json' }), '');
  assert.equal(stop({ raw: '{}' }), '');
});

test('the engine records the session on each command and marks it paused on handoff', () => {
  const { folder } = run({});
  fs.mkdirSync(path.join(folder, 'handoffs'));
  fs.writeFileSync(path.join(folder, 'flow.json'), JSON.stringify({ flow: 'build-flow', run: folder, gate: 'end', state: 'BUILD', ticket: null, queue: [] }));
  const cli = (...args) => {
    const r = spawnSync(process.execPath, [path.join(import.meta.dirname, 'flow.mjs'), ...args], {
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_CODE_SESSION_ID: 'sid-engine' },
    });
    assert.equal(r.status, 0, r.stderr);
  };
  cli('status', folder);
  assert.deepEqual(readSession('build-flow', 'sid-engine'), { run: folder, paused: false });
  cli('handoff', folder);
  assert.equal(readSession('build-flow', 'sid-engine').paused, true);
  cli('status', folder);
  assert.equal(readSession('build-flow', 'sid-engine').paused, false);
});
