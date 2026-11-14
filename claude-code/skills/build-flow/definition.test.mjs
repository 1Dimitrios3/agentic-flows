// The real definition's shape, its generated docs, and that SKILL.md names no step. See README.md, "Tests".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import def from './flow.definition.mjs';
import { blocks, current } from './docs.mjs';
import { run } from './harness.mjs';

const read = (f) => fs.readFileSync(path.join(import.meta.dirname, f), 'utf8');
const states = Object.entries(def.states);
const branches = (t) => (t.routes ? t.routes.map((r) => ({ ...t, ...r })) : [t]);
const resumes = [...new Set(states.flatMap(([, s]) => Object.values(s.on).flatMap((t) => branches(t).map((r) => r.resume))).filter(Boolean))];
// One edge per reachable target; @resume reaches every state an escalation can resume. A refusal moves nowhere.
const transitions = states.flatMap(([from, s]) =>
  Object.entries(s.on).flatMap(([ev, t]) =>
    branches(t)
      .filter((b) => !b.refuse)
      .flatMap((b) => (b.target === '@resume' ? resumes : [b.target]).map((target) => ({ from, ev, ...b, target }))),
  ),
);
const finals = states.filter(([, s]) => !Object.keys(s.on).length).map(([n]) => n);

// Every value the engine offers to the instructions, so an unknown placeholder shows up here, not at a run.
const sample = {
  ticket: '01', title: 'T', ticketFile: 'input/tickets/01-T.md', blockedBy: 'none', seedReports: 'none yet', approved: '-',
  run: '/run', repo: '/repo', base: 'abc', target: '/repo', commit: 'none', gate: 'end', worktree: 'ask', scope: null, resume: 'BUILD', reviewed: false, reviews: 0,
  fixes: 0, via: 'APPROVE', left: { RETRY: 1, REJECT: 1 }, max: { RETRY: 3, REJECT: 5 },
};
const variants = [
  sample,
  { ...sample, commit: 'ticket', reviewed: true, reviews: 1, via: 'REPAIRED' },
  { ...sample, worktree: 'ask', scope: 'ABC-1' },
  { ...sample, worktree: 'auto', scope: 'ABC-1' },
  { ...sample, worktree: 'auto', scope: 'ABC-1', via: 'WORKTREE_FAILED' },
];
// `initial` is a state name or a list of routes: every state a run can start in.
const initials = Array.isArray(def.initial) ? def.initial.map((r) => r.target) : [def.initial];
const text = (s, v) => (typeof s.do === 'function' ? s.do(v) : s.do);
const fill = (s, v) =>
  s.replace(/\{(\w+(?:\.\w+)?)\}/g, (m, k) => {
    const got = k.split('.').reduce((o, part) => (o && typeof o === 'object' ? o[part] : undefined), v);
    return got === undefined ? m : String(got);
  });

function reachable(starts, edges) {
  const seen = new Set(starts);
  for (const s of seen) for (const n of edges(s)) seen.add(n);
  return seen;
}

test('the engine accepts the definition', () => {
  const r = run(path.join(import.meta.dirname, 'flow.mjs'));
  assert.match(r.out, /^build-flow: usage:/, r.out);
});

test('every state is reachable from an initial state', () => {
  const seen = reachable(initials, (s) => transitions.filter((t) => t.from === s).map((t) => t.target));
  assert.deepEqual(Object.keys(def.states).filter((s) => !seen.has(s)), []);
});

test('a final state is reachable from every state (no dead ends)', () => {
  assert.equal(finals.length, 1);
  const back = reachable(finals, (s) => transitions.filter((t) => t.target === s).map((t) => t.from));
  assert.deepEqual(Object.keys(def.states).filter((s) => !back.has(s)), []);
});

test('every guarded path is a declared artifact', () => {
  const guarded = transitions.flatMap((t) => [
    ...(t.requires ?? []),
    ...(t.fresh ?? []),
    ...(t.verdict ? [t.verdict.file] : []),
    ...(t.noteTo ? [t.noteTo] : []),
  ]);
  assert.deepEqual(guarded.filter((p) => !def.artifacts.includes(p)), []);
});

test('every artifact lives in a declared folder or at the run root', () => {
  const roots = ['input', ...def.dirs.map((d) => d.split('/')[0])];
  for (const a of def.artifacts) if (a.includes('/')) assert.ok(roots.includes(a.split('/')[0]), a);
});

test('every run-folder path named in the instructions is a declared artifact', () => {
  const named = states.flatMap(([name, s]) =>
    variants.flatMap((v) =>
      [...text(s, v).matchAll(/\b(?:input|build|review)(?:\/[\w{}-][\w{}.-]*)+|\b(?:ESCALATION|REPORT|DECISIONS)\.md\b/g)].map((m) => ({
        name,
        p: m[0].replace(/\.+$/, ''),
      })),
    ),
  );
  const known = (p) => def.artifacts.some((a) => p === a || p.startsWith(`${a}/`)) || /^review\/repair-\{fixes\}\.patch$/.test(p);
  assert.deepEqual(named.filter(({ p }) => !known(p)), []);
});

test('every placeholder in the instructions is a value the engine offers', () => {
  for (const [name, s] of states) for (const v of variants) assert.doesNotMatch(fill(text(s, v), v), /\{\w+(?:\.\w+)?\}/, name);
});

test('events in human states are human gates, and gate names are never reused by agent events', () => {
  for (const t of transitions) if (def.states[t.from].actor === 'human') assert.ok(t.human, `${t.from} --${t.ev}`);
  const human = new Set(transitions.filter((t) => t.human).map((t) => t.ev));
  assert.deepEqual([...new Set(transitions.filter((t) => !t.human && human.has(t.ev)).map((t) => t.ev))], []);
});

test('SKILL.md names no state and no event, so a step lives entirely in the definition', () => {
  const skill = read('SKILL.md');
  const names = [...states.map(([n]) => n), ...new Set(states.flatMap(([, s]) => Object.keys(s.on)))].filter((n) => !['APPROVE', 'REJECT'].includes(n));
  assert.deepEqual(names.filter((n) => new RegExp(String.raw`\b${n}\b`).test(skill)), []);
});

test('the generated docs are current (else: node docs.mjs --write)', () => {
  for (const [file, block] of Object.entries(blocks(def))) assert.equal(current(read(file)), block, `${file} is stale: run node docs.mjs --write`);
});
