// create-flow's own steps, on the real definition. These are meant to fail when a step changes;
// the engine's rules are tested on a made-up flow in engine.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, walkTo } from './harness.mjs';

// Each step writes what its event needs, then sends it.
const STEPS = [
  [['sources/INDEX.md'], 'SOURCES_REGISTERED'],
  [['discovery/REQUIREMENTS.md', 'discovery/CODEBASE.md'], 'DISCOVERY_DONE'],
  [['understanding/UNDERSTANDING.md', 'understanding/OPEN-QUESTIONS.md'], 'SYNTHESIZED'],
  [['understanding/DECISIONS.md', 'understanding/UNDERSTANDING.md', 'understanding/GLOSSARY.md'], 'CLARIFIED'],
  [[], 'APPROVE'],
  [['spec/SPEC.md'], 'SPEC_DRAFTED'],
  [[], 'APPROVE'],
  [['tickets/01-FIRST.md'], 'TICKETS_DRAFTED'],
  [[], 'APPROVE'],
];
const walk = (t, to) => walkTo(t, to, STEPS);

test('walks the whole flow from INTAKE to DONE with exactly these files', () => {
  const t = setup();
  walk(t, 'DONE');
  assert.equal(t.read('events.jsonl').trim().split('\n').length, 1 + STEPS.length);
  const done = t.flow('next', t.run).out;
  assert.match(done, /^ {2}! build-flow init <build-folder> --repo <target> --spec <run>\/spec\/SPEC\.md --tickets <run>\/tickets /m);
  assert.match(done, /run "command -v flow-github"\. If it prints nothing, say nothing about GitHub\./, 'the adapter is optional');
  assert.match(done, /^ {2}! flow-github export --repo <owner\/name> --spec <run>\/spec\/SPEC\.md --tickets <run>\/tickets /m);
});

test('NEEDS_MORE_DISCOVERY: each refresh event waits for the report it names', () => {
  const t = setup();
  walk(t, 'CLARIFY');
  assert.match(t.flow('send', t.run, 'NEEDS_MORE_DISCOVERY').out, /is a human gate/, 'the round is the human\'s call');
  assert.ok(t.flow('send', t.run, 'NEEDS_MORE_DISCOVERY', '--at', 'CLARIFY', '--note', 'check the export API').ok);
  assert.equal(t.state(), 'REDISCOVERY');
  t.put('discovery/REQUIREMENTS.md', 'second pass');
  for (const ev of ['DISCOVERY_REFRESHED', 'CODEBASE_REFRESHED']) {
    const r = t.flow('send', t.run, ev);
    assert.ok(!r.ok, ev);
    assert.match(r.out, /not updated since entering REDISCOVERY: discovery\/CODEBASE.md/);
  }
  assert.ok(t.flow('send', t.run, 'REQUIREMENTS_REFRESHED').ok);
  assert.equal(t.state(), 'SYNTHESIS');
});

test('first pass: the one-report events do not exist, so the baseline is always recorded', () => {
  const t = setup();
  walk(t, 'DISCOVERY');
  for (const ev of ['DISCOVERY_REFRESHED', 'CODEBASE_REFRESHED', 'REQUIREMENTS_REFRESHED'])
    assert.match(t.flow('send', t.run, ev).out, /is not allowed in DISCOVERY; allowed: DISCOVERY_DONE\n/, ev);
});

test('drift: a refresh records a new baseline only when the code report was rewritten', () => {
  const t = setup();
  t.git('init', '-q');
  t.commit('src/cited.ts', 'v1');
  walk(t, 'DISCOVERY');
  t.put('discovery/REQUIREMENTS.md');
  t.put('discovery/CODEBASE.md', 'Reuse `src/cited.ts:12`.');
  assert.ok(t.flow('send', t.run, 'DISCOVERY_DONE').ok);
  t.commit('src/cited.ts', 'v2');
  const refresh = (file, ev) => {
    t.put('understanding/UNDERSTANDING.md', ev);
    t.put('understanding/OPEN-QUESTIONS.md');
    assert.ok(t.flow('send', t.run, 'SYNTHESIZED').ok);
    assert.ok(t.flow('send', t.run, 'NEEDS_MORE_DISCOVERY', '--at', 'CLARIFY', '--note', 'go').ok);
    t.put(file, 'Reuse `src/cited.ts:14`.');
    return t.flow('send', t.run, ev);
  };

  const r = refresh('discovery/REQUIREMENTS.md', 'REQUIREMENTS_REFRESHED');
  assert.ok(r.ok);
  assert.match(r.out, /Target drift: .*src\/cited.ts/, 'the code report is still the old one');
  const c = refresh('discovery/CODEBASE.md', 'CODEBASE_REFRESHED');
  assert.ok(c.ok);
  assert.doesNotMatch(c.out, /Target drift/);
});

test('REJECT at the understanding gate: the note lands in DECISIONS.md; CLARIFIED waits for a rewritten UNDERSTANDING.md', () => {
  const t = setup();
  walk(t, 'UNDERSTANDING_GATE');
  assert.ok(t.flow('send', t.run, 'REJECT', '--at', 'UNDERSTANDING_GATE', '--note', 'missing X').ok);
  assert.equal(t.state(), 'CLARIFY');
  assert.match(t.read('understanding/DECISIONS.md'), /\n## \S+ REJECT at UNDERSTANDING_GATE\n\nmissing X\n$/);
  const r = t.flow('send', t.run, 'CLARIFIED');
  assert.ok(!r.ok, 'the note alone is not proof of work');
  assert.match(r.out, /not updated since entering CLARIFY: understanding\/UNDERSTANDING.md/);
  assert.doesNotMatch(r.out, /DECISIONS.md/, 'the appended note counts as fresh');
  t.put('understanding/UNDERSTANDING.md', 'with X');
  assert.ok(t.flow('send', t.run, 'CLARIFIED').ok);
});

test('REJECT at the spec gate: SPEC_DRAFTED waits for a rewritten spec', () => {
  const t = setup();
  walk(t, 'SPEC_GATE');
  assert.ok(t.flow('send', t.run, 'REJECT', '--at', 'SPEC_GATE', '--note', 'max 120 lines').ok);
  assert.match(t.read('understanding/DECISIONS.md'), /REJECT at SPEC_GATE\n\nmax 120 lines/);
  assert.match(t.flow('send', t.run, 'SPEC_DRAFTED').out, /not updated since entering SPEC_DRAFTING: spec\/SPEC.md/);
  t.put('spec/SPEC.md', 'shorter');
  assert.ok(t.flow('send', t.run, 'SPEC_DRAFTED').ok);
});

test('REJECT at the tickets gate: TICKETS_DRAFTED waits for a rewritten ticket', () => {
  const t = setup();
  walk(t, 'TICKETS_GATE');
  assert.ok(t.flow('send', t.run, 'REJECT', '--at', 'TICKETS_GATE', '--note', 'split 01').ok);
  assert.match(t.flow('send', t.run, 'TICKETS_DRAFTED').out, /not updated since entering TICKETING: tickets/);
  t.put('tickets/01-FIRST.md', 'rewritten');
  assert.ok(t.flow('send', t.run, 'TICKETS_DRAFTED').ok);
});

test('drift: CLARIFY and UNDERSTANDING_GATE say how to refresh; from SPEC_DRAFTING there is no way back', () => {
  const t = setup();
  t.git('init', '-q');
  t.commit('src/cited.ts', 'v1');
  walk(t, 'DISCOVERY');
  t.put('discovery/REQUIREMENTS.md');
  t.put('discovery/CODEBASE.md', 'Reuse `src/cited.ts:12`.');
  assert.ok(t.flow('send', t.run, 'DISCOVERY_DONE').ok);
  t.commit('src/cited.ts', 'v2');

  assert.match(t.flow('next', t.run).out, /Target drift: .*cited in discovery\/CODEBASE.md: src\/cited.ts\n\n/, 'SYNTHESIS: the drift line only');
  t.put('understanding/UNDERSTANDING.md');
  t.put('understanding/OPEN-QUESTIONS.md');
  assert.ok(t.flow('send', t.run, 'SYNTHESIZED').ok);
  assert.match(t.flow('next', t.run).out, /Target drift: .*\nRefreshing discovery is the human's call: on their go-ahead, send NEEDS_MORE_DISCOVERY/);
  t.put('understanding/DECISIONS.md');
  t.put('understanding/UNDERSTANDING.md', 'clarified');
  t.put('understanding/GLOSSARY.md');
  assert.ok(t.flow('send', t.run, 'CLARIFIED').ok);
  assert.match(t.flow('next', t.run).out, /\nRefreshing discovery is the human's call: it takes a REJECT back to CLARIFY first/);
  assert.ok(t.flow('send', t.run, 'APPROVE', '--at', 'UNDERSTANDING_GATE', '--note', 'ok').ok);
  assert.match(t.flow('next', t.run).out, /\nNo way back to DISCOVERY or REDISCOVERY from SPEC_DRAFTING: /);
});
