// Shared by the engine and flow tests: temp runs with a git repo and tickets, and engine copies with another definition.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SKILL = import.meta.dirname;
export const ENGINE = path.join(SKILL, 'flow.mjs');
export const FIXTURE = path.join(SKILL, 'fixture.definition.mjs');

// Each engine keeps its last run under <ID>_LAST_RUN: point every flow's at a temp file, so tests never touch ~/.local/state.
const state = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-last-'));
export const env = {
  ...process.env,
  BUILD_FLOW_LAST_RUN: path.join(state, 'build-flow'),
  FIXTURE_LAST_RUN: path.join(state, 'fixture'),
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_CONFIG_GLOBAL: '/dev/null',
};

// A temp copy of the engine whose definition is `source`, after an optional [from, to] text replacement.
// The real engine is never pointed at another definition, so nothing outside the tests can do it either.
export function engine(source, [from, to] = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-engine-'));
  for (const f of ['flow.mjs', 'steps.mjs', 'queue.mjs', 'session.mjs']) fs.copyFileSync(path.join(SKILL, f), path.join(dir, f));
  let src = fs.readFileSync(source, 'utf8');
  if (from !== undefined) {
    assert.ok(src.includes(from), `definition contains ${JSON.stringify(from)}`);
    src = src.replace(from, to);
  }
  fs.writeFileSync(path.join(dir, 'flow.definition.mjs'), src);
  return path.join(dir, 'flow.mjs');
}

export const run = (flowPath, ...args) => {
  const r = spawnSync(process.execPath, [flowPath, ...args], { encoding: 'utf8', env });
  return { ok: r.status === 0, out: r.stdout + r.stderr };
};

export const ticket = (blockedBy) =>
  `## Parent\n\nspec/SPEC.md\n\n## What to build\n\nA thing.\n\n## Acceptance criteria\n\n- [ ] It works\n\n## Blocked by\n\n${blockedBy}\n`;

// Three tickets whose blocker order is 01, 03, 02, plus a file that is not a ticket.
export const TICKETS = {
  '01-FIRST.md': ticket('None (can start immediately)'),
  '02-SECOND.md': ticket('- 03-THIRD'),
  '03-THIRD.md': '# 03 Third\n\n' + ticket('- Ticket 01: first'),
  'NOTES.md': 'not a ticket',
};

// A fresh run folder, a repo with one commit, a SPEC and the tickets, driven by the engine at flowPath for `def`.
export function setup(def, { flowPath = ENGINE, tickets = TICKETS } = {}) {
  // Resolved, since the system temp folder can be a symlink (macOS) and git reports real paths.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'flow-test-')));
  const t = { def, root, repo: path.join(root, 'repo'), run: path.join(root, 'run'), tdir: path.join(root, 'tickets'), spec: path.join(root, 'SPEC.md') };
  t.git = (...args) => spawnSync('git', ['-C', t.repo, ...args], { encoding: 'utf8', env });
  fs.mkdirSync(t.repo);
  t.git('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(t.repo, 'app.txt'), 'v0\n');
  t.git('add', '-A');
  t.git('commit', '-q', '-m', 'initial');
  fs.writeFileSync(t.spec, '# Spec\n');
  fs.mkdirSync(t.tdir);
  for (const [f, body] of Object.entries(tickets)) fs.writeFileSync(path.join(t.tdir, f), body);

  // The state and event with which the human chooses the workspace: the human transition carrying the workspace effect.
  const ws = Object.entries(def.states).flatMap(([state, s]) => Object.entries(s.on).filter(([, x]) => x.workspace && x.human).map(([ev]) => ({ state, ev })))[0];

  t.flow = (...args) => run(flowPath, ...args);
  // Create the run in its initial state only. With --worktree ask unless `extra` names a mode: the human picks the
  // workspace, so a test needs no ticket id. --worktree auto runs name it themselves.
  t.create = (...extra) =>
    t.flow('init', t.run, '--repo', t.repo, '--spec', t.spec, '--tickets', t.tdir, ...(extra.includes('--worktree') ? [] : ['--worktree', 'ask']), ...extra);
  // Pass the workspace state on the repo's main branch (or the given target), with no ticket id unless `extra` has --scope.
  t.ready = (target = t.repo, branch = 'main', ...extra) =>
    t.flow('send', t.run, ws.ev, '--at', ws.state, '--target', target, '--branch', branch, ...extra, '--note', 'this one');
  // Both: the run is ready to build.
  t.init = (...extra) => {
    const r = t.create(...extra);
    if (!r.ok) return r;
    const w = t.ready();
    return { ok: w.ok, out: r.out + w.out };
  };
  t.put = (p, body = `x ${Math.random()}`) => {
    fs.mkdirSync(path.dirname(path.join(t.run, p)), { recursive: true });
    fs.writeFileSync(path.join(t.run, p), body);
  };
  t.read = (p) => fs.readFileSync(path.join(t.run, p), 'utf8');
  t.has = (p) => fs.existsSync(path.join(t.run, p));
  t.st = () => JSON.parse(t.read('flow.json'));
  // Names the current gate, as the orchestrator does: --at the state, plus --ticket where the gate repeats per ticket.
  t.pin = () => {
    const s = t.st();
    return ['--at', s.state, ...(def.states[s.state]?.perTicket ? ['--ticket', s.ticket] : [])];
  };
  t.send = (ev, ...args) => t.flow('send', t.run, ev, ...t.pin(), ...args);
  // A change in the target, so a commit has something to record.
  t.edit = (body = `edit ${Math.random()}\n`) => fs.writeFileSync(path.join(t.repo, 'app.txt'), body);
  t.commits = () => t.git('rev-list', '--count', 'HEAD').stdout.trim();
  t.subject = () => t.git('log', '-1', '--format=%s').stdout.trim();
  return t;
}

// Inits the run (with initExtra) unless it exists and, for each [files, event, ...args], edits the target, writes the
// files (a path, or [path, body]) and sends the event, stopping on entering `to`. A step whose event the current state
// doesn't allow is skipped, so one table serves both gate modes and a single ticket.
export function walkTo(t, to, steps, initExtra = ['--gate', 'end']) {
  if (!t.has('flow.json')) {
    const r = t.init(...initExtra);
    assert.ok(r.ok, r.out);
  }
  for (const [files, ev, ...args] of steps) {
    const state = t.st().state;
    if (state === to) return;
    if (!(ev in t.def.states[state].on)) continue;
    t.edit(`${ev} ${Math.random()}\n`);
    for (const f of files) Array.isArray(f) ? t.put(f[0], f[1]) : t.put(f, `${ev} ${Math.random()}`);
    const s = t.send(ev, ...args, '--note', 'test');
    assert.ok(s.ok, `${ev}: ${s.out}`);
  }
  assert.equal(t.st().state, to);
}
