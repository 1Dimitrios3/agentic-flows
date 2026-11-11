import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import def from './flow.definition.mjs';
import { blocks, current, splice } from './docs.mjs';

const states = Object.entries(def.states);
const transitions = states.flatMap(([from, s]) => Object.entries(s.on).map(([ev, t]) => ({ from, ev, ...t })));
const edge = (from, ev, target) => `${from} --${ev}--> ${target}`;
const defined = transitions.map((t) => edge(t.from, t.ev, t.target)).sort();
const read = (f) => fs.readFileSync(path.join(import.meta.dirname, f), 'utf8');

function reachable(start, edges) {
  const seen = new Set([start]);
  for (const s of seen) for (const n of edges(s)) seen.add(n);
  return seen;
}

test('every state is reachable from the initial state', () => {
  const seen = reachable(def.initial, (s) => transitions.filter((t) => t.from === s).map((t) => t.target));
  assert.deepEqual(Object.keys(def.states).filter((s) => !seen.has(s)), []);
});

test('DONE is reachable from every state (no dead ends)', () => {
  const back = reachable('DONE', (s) => transitions.filter((t) => t.target === s).map((t) => t.from));
  assert.deepEqual(Object.keys(def.states).filter((s) => !back.has(s)), []);
});

test('every guarded path, and every report a baseline cites, is a declared artifact', () => {
  const guarded = transitions.flatMap((t) => [
    ...(t.requires ?? []),
    ...(t.fresh ?? []),
    ...(t.clear ?? []),
    ...(t.baseline ? [t.baseline.cites] : []),
  ]);
  assert.deepEqual(guarded.filter((p) => !def.artifacts.includes(p)), []);
});

test('every resume file is a declared artifact', () => {
  assert.deepEqual((def.resume ?? []).filter((p) => !def.artifacts.includes(p)), []);
});

// Words that would go stale when a step is added, removed or renamed.
const stepWords = (except = []) => {
  const human = new Set(transitions.filter((t) => t.human).map((t) => t.ev));
  const names = [...Object.keys(def.states), ...transitions.map((t) => t.ev).filter((e) => !human.has(e))];
  return new RegExp(String.raw`\b(${names.filter((n) => !except.includes(n)).join('|')})\b`, 'g');
};

test('SKILL.md names no state and no event but the gate verdicts, so steps can change without editing it', () => {
  assert.deepEqual(read('SKILL.md').match(stepWords()) ?? [], []);
});

test("a state's instructions name no other state, only its own events", () => {
  for (const [name, s] of states) {
    const own = [name, ...Object.keys(s.on)];
    assert.deepEqual(s.do.match(stepWords(own)) ?? [], [], name);
  }
});

test('every artifact lives in a folder init creates', () => {
  const made = (dir) => def.dirs.some((d) => d === dir || d.startsWith(`${dir}/`));
  assert.deepEqual(def.artifacts.filter((a) => !made(a) && !made(path.posix.dirname(a))), []);
});

test('every run-folder path named in the instructions is a declared artifact', () => {
  const top = [...new Set(def.dirs.map((d) => d.split('/')[0]))].join('|');
  const named = states.flatMap(([name, s]) =>
    [...s.do.matchAll(new RegExp(String.raw`\b(?:${top})(?:\/[\w-][\w.-]*)+`, 'g'))].map((m) => ({
      name,
      p: m[0].replace(/\.+$/, ''),
    })),
  );
  const known = (p) => def.artifacts.some((a) => p === a || p.startsWith(`${a}/`));
  assert.deepEqual(named.filter(({ p }) => !known(p)), []);
});

test('events in human states are human gates, and gate names are never reused by agent events', () => {
  for (const t of transitions) if (def.states[t.from].actor === 'human') assert.ok(t.human, `${t.from} --${t.ev}`);
  const human = new Set(transitions.filter((t) => t.human).map((t) => t.ev));
  assert.deepEqual(transitions.filter((t) => !t.human && human.has(t.ev)).map((t) => t.ev), []);
});

test('LOGICAL-DIAGRAM.md draws exactly the transitions of the definition', () => {
  const doc = read('LOGICAL-DIAGRAM.md');
  const drawn = [...doc.matchAll(/^\s*(\w+) --> (\w+): (\w+)/gm)].map(([, from, target, ev]) => edge(from, ev, target));
  assert.deepEqual(drawn.sort(), defined);
  assert.match(doc, new RegExp(String.raw`\[\*\] --> ${def.initial}:`), 'initial state');
});

test('the README events table lists exactly the events of the definition', () => {
  // Rows look like: | STATE | `EV1` / `EV2` | TARGET1 / TARGET2 | guard |
  const rows = read('README.md').split('\n').map((l) => l.split('|').map((c) => c.trim())).filter((c) => def.states[c[1]]);
  const listed = rows.flatMap(([, from, evs, targets]) => {
    const to = targets.split('/').map((t) => t.trim());
    return [...evs.matchAll(/`(\w+)`/g)].map((m, i) => edge(from, m[1], to[i]));
  });
  assert.deepEqual(listed.sort(), defined);
});

test('the generated blocks in README.md and LOGICAL-DIAGRAM.md match the definition (fix: node docs.mjs --write)', () => {
  for (const [file, block] of Object.entries(blocks(def))) {
    const doc = read(file);
    assert.notEqual(current(doc), null, `${file} has the generated-block markers`);
    assert.equal(current(doc), block, file);
    assert.equal(splice(doc, block), doc, `${file}: --write changes nothing when the docs are current`);
  }
});
