// Shared by the engine and flow tests: temp runs, and engine copies with another definition.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SKILL = import.meta.dirname;
export const FIXTURE = path.join(SKILL, 'fixture.definition.mjs');

// A temp copy of the engine whose definition is `source`, after an optional [from, to] text replacement.
// The real engine is never pointed at another definition, so nothing outside the tests can do it either.
export function engine(source, [from, to] = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-engine-'));
  for (const f of ['flow.mjs', 'steps.mjs']) fs.copyFileSync(path.join(SKILL, f), path.join(dir, f));
  let src = fs.readFileSync(source, 'utf8');
  if (from !== undefined) {
    assert.ok(src.includes(from), `definition contains ${JSON.stringify(from)}`);
    src = src.replace(from, to);
  }
  fs.writeFileSync(path.join(dir, 'flow.definition.mjs'), src);
  return path.join(dir, 'flow.mjs');
}

export const run = (flowPath, ...args) => {
  const r = spawnSync(process.execPath, [flowPath, ...args], { encoding: 'utf8' });
  return { ok: r.status === 0, out: r.stdout + r.stderr };
};

// A fresh run folder and target repo, driven by the engine at flowPath.
export function setup(flowPath = path.join(SKILL, 'flow.mjs')) {
  // Resolved, since the system temp folder can be a symlink (macOS) and git reports real paths.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'flow-test-')));
  const t = { run: path.join(root, 'run'), target: path.join(root, 'repo') };
  fs.mkdirSync(t.target);
  t.flow = (...args) => run(flowPath, ...args);
  t.put = (p, body = 'x') => {
    fs.mkdirSync(path.dirname(path.join(t.run, p)), { recursive: true });
    fs.writeFileSync(path.join(t.run, p), body);
  };
  t.read = (p) => fs.readFileSync(path.join(t.run, p), 'utf8');
  t.state = () => JSON.parse(t.read('flow.json')).state;
  // A git repo as the target, with commit(file, body) to move its HEAD.
  t.git = (...a) => spawnSync('git', ['-C', t.target, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
  t.commit = (file, body) => {
    fs.mkdirSync(path.dirname(path.join(t.target, file)), { recursive: true });
    fs.writeFileSync(path.join(t.target, file), body);
    t.git('add', '-A');
    t.git('commit', '-qm', file);
  };
  return t;
}

// Inits the run, then for each [files, event] writes the files and sends the event, stopping on entering `to`.
export function walkTo(t, to, steps) {
  t.flow('init', t.run, '--target', t.target);
  for (const [files, ev] of steps) {
    if (t.state() === to) return;
    for (const f of files) t.put(f, `${ev} ${Math.random()}`);
    assert.ok(t.flow('send', t.run, ev, '--at', t.state(), '--note', 'test').ok, ev);
  }
  assert.equal(t.state(), to);
}
