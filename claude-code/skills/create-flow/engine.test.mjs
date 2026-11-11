// The engine's rules, tested on the made-up flow in fixture.definition.mjs, so create-flow's steps can change freely.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { FIXTURE, engine, run, setup, walkTo } from './harness.mjs';

const FLOW = engine(FIXTURE);
const NOTES = 'in/NOTES.md';
const STEPS = [
  [['in/LIST.md'], 'GO'],
  [['out/A.md', 'out/B.md'], 'DONE_IT'],
  [[NOTES, 'in/GLOSS.md'], 'CHECKED'],
  [[], 'APPROVE'],
  [['items/1.md'], 'BUILT'],
  [[], 'APPROVE'],
];
const fixture = () => setup(FLOW);
const walk = (t, to) => walkTo(t, to, STEPS);

test('walks the fixture from START to END, logging one event per move', () => {
  const t = fixture();
  walk(t, 'END');
  assert.equal(t.read('events.jsonl').trim().split('\n').length, 1 + STEPS.length);
  assert.match(t.flow('next', t.run).out, /Final state: no events\./);
});

test('refuses events the current state does not allow', () => {
  const t = fixture();
  t.flow('init', t.run, '--target', t.target);
  const r = t.flow('send', t.run, 'APPROVE', '--note', 'x');
  assert.ok(!r.ok);
  assert.match(r.out, /not allowed in START/);
  assert.equal(t.state(), 'START');
});

test('requires: blocks until the file exists and is non-empty', () => {
  const t = fixture();
  t.flow('init', t.run, '--target', t.target);
  assert.match(t.flow('send', t.run, 'GO').out, /missing or empty: in\/LIST.md/);
  t.put('in/LIST.md', '');
  assert.ok(!t.flow('send', t.run, 'GO').ok);
  t.put('in/LIST.md');
  assert.ok(t.flow('send', t.run, 'GO').ok);
});

test('fresh: files written before entering the state are stale until rewritten', () => {
  const t = fixture();
  t.flow('init', t.run, '--target', t.target);
  t.put('in/LIST.md');
  t.put('out/A.md');
  t.put('out/B.md');
  t.flow('send', t.run, 'GO');
  const r = t.flow('send', t.run, 'DONE_IT');
  assert.ok(!r.ok);
  assert.match(r.out, /not updated since entering WORK/);
  t.put('out/A.md', 'y');
  assert.match(t.flow('send', t.run, 'DONE_IT').out, /not updated since entering WORK: out\/B.md/, 'every path must be rewritten');
  t.put('out/B.md', 'y');
  assert.ok(t.flow('send', t.run, 'DONE_IT').ok);
  assert.equal(t.state(), 'CHECK');
});

test('fresh on a folder: one rewritten file refreshes it; an empty new file does not count', () => {
  const t = fixture();
  walk(t, 'BUILD_GATE');
  t.put('items/2.md');
  assert.ok(t.flow('send', t.run, 'REJECT', '--at', 'BUILD_GATE', '--note', 'split 1').ok);
  assert.match(t.flow('send', t.run, 'BUILT').out, /not updated since entering BUILD: items/);
  t.put('items/3.md', '');
  assert.ok(!t.flow('send', t.run, 'BUILT').ok, 'an empty new file is not a rewrite');
  t.put('items/2.md', 'rewritten');
  assert.ok(t.flow('send', t.run, 'BUILT').ok);
});

test('clear: top-level and indented "- [ ]" lines are open; [x], [-] and plain lines are not', () => {
  const t = fixture();
  walk(t, 'CHECK');
  t.put(NOTES);
  t.put('in/GLOSS.md');
  t.put('in/LIST.md', '- [x] a\n- [ ] b\n');
  assert.match(t.flow('send', t.run, 'CHECKED').out, /in\/LIST.md still has 1 open "- \[ \]" item/);
  t.put('in/LIST.md', '- [x] a\n  - [ ] nested\n');
  assert.match(t.flow('send', t.run, 'CHECKED').out, /1 open "- \[ \]" item/);
  t.put('in/LIST.md', '- [x] a\n- [-] b\n\n## Dropped\n\n- c: out of scope\n');
  assert.ok(t.flow('send', t.run, 'CHECKED').ok);
});

test("blockers print in the engine's guard order, whatever the order in the definition", () => {
  const t = fixture();
  walk(t, 'CHECK');
  // CHECKED lists fresh before requires; requires still prints first.
  assert.match(t.flow('next', t.run).out, /missing or empty: in\/GLOSS.md\n\s+missing or empty: in\/NOTES.md/);
});

test('human gates need --note and --at with the current state, so a replayed verdict cannot pass a later gate', () => {
  const t = fixture();
  walk(t, 'REVIEW');
  assert.match(t.flow('send', t.run, 'REJECT').out, /human gate: pass --note/);
  const missing = t.flow('send', t.run, 'APPROVE', '--note', 'ok');
  assert.ok(!missing.ok);
  assert.match(missing.out, /pass --at REVIEW/);
  const stale = t.flow('send', t.run, 'APPROVE', '--at', 'CHECK', '--note', 'ok');
  assert.ok(!stale.ok);
  assert.match(stale.out, /the run is now in REVIEW.*nothing was sent/);
  assert.equal(t.state(), 'REVIEW');
  assert.match(t.flow('next', t.run).out, /APPROVE -> BUILD \[human gate: --at REVIEW and --note required\]/);
  assert.match(t.flow('send', t.run, 'CHECKED', '--at', 'CHECK').out, /the run is now in REVIEW/, 'a wrong --at is refused on any event');
});

test('REJECT appends the note to noteTo, which then counts as rewritten in the state it returns to', () => {
  const t = fixture();
  walk(t, 'REVIEW');
  assert.ok(t.flow('send', t.run, 'REJECT', '--at', 'REVIEW', '--note', 'missing X').ok);
  assert.equal(t.state(), 'CHECK');
  assert.match(t.read(NOTES), /\n## \S+ REJECT at REVIEW\n\nmissing X\n$/);
  assert.match(t.flow('next', t.run).out, /Entered via REJECT — "missing X"/);
  assert.ok(t.flow('send', t.run, 'CHECKED').ok, 'the note is the record');
});

test('max: refused once used up, with maxHint after the count; a REJECT back does not reset it', () => {
  const t = fixture();
  walk(t, 'CHECK');
  for (let i = 1; i <= 2; i++) {
    assert.ok(t.flow('send', t.run, 'AGAIN').ok, `round ${i}`);
    t.put('out/A.md', `pass ${i}`);
    t.put('out/B.md', `pass ${i}`);
    assert.ok(t.flow('send', t.run, 'DONE_IT').ok);
  }
  assert.match(t.flow('next', t.run).out, /AGAIN -> WORK \(blocked\)\n\s+used 2 of 2 times: finish the list instead/);
  assert.ok(!t.flow('send', t.run, 'AGAIN').ok);
  t.put(NOTES);
  t.put('in/GLOSS.md');
  assert.ok(t.flow('send', t.run, 'CHECKED').ok);
  assert.ok(t.flow('send', t.run, 'REJECT', '--at', 'REVIEW', '--note', 'redo').ok);
  assert.match(t.flow('send', t.run, 'AGAIN').out, /used 2 of 2 times/);
});

test('max counts sends from the state only: the same event name in another state has its own count', () => {
  const t = fixture();
  t.flow('init', t.run, '--target', t.target);
  for (let i = 1; i <= 3; i++) assert.ok(t.flow('send', t.run, 'AGAIN').ok, `START round ${i}`);
  walk(t, 'CHECK');
  assert.match(t.flow('next', t.run).out, /AGAIN -> WORK \(ready\)/, "START's sends don't count in CHECK");
  assert.ok(t.flow('send', t.run, 'AGAIN').ok);
});

test('baseline and drift: recorded HEAD, cited files, onDrift, and the engine\'s "No way back" line', () => {
  const t = fixture();
  t.git('init', '-q');
  t.commit('src/cited.ts', 'v1');
  t.commit('src/other.ts', 'v1');
  const base = t.git('rev-parse', 'HEAD').stdout.trim();

  walk(t, 'WORK');
  t.put('out/A.md', 'Reuse `src/cited.ts:12`.');
  t.put('out/B.md');
  assert.ok(t.flow('send', t.run, 'DONE_IT').ok);
  assert.match(t.flow('status', t.run).out, new RegExp(`Baseline: ${base.slice(0, 7)}`));
  assert.doesNotMatch(t.flow('next', t.run).out, /Target drift/, 'no drift while HEAD is the baseline');
  assert.match(t.read('events.jsonl'), new RegExp(`"event":"DONE_IT".*"baseline":"${base}"`));

  t.commit('src/other.ts', 'v2');
  assert.match(t.flow('next', t.run).out, /Target drift: .*cited in out\/A.md: none\nSend AGAIN to redo the work\./, "the state's onDrift follows");
  t.commit('src/cited.ts', 'v2');
  assert.match(t.flow('status', t.run).out, /Target drift: .*cited in out\/A.md: src\/cited.ts$/m);
  t.flow('handoff', t.run);
  assert.match(t.read('handoffs/001.md'), /Target drift: .*src\/cited.ts/);

  // A baseline recorded before it kept its report falls back to the definition's.
  const st = JSON.parse(t.read('flow.json'));
  assert.equal(st.baseline.cites, 'out/A.md');
  delete st.baseline.cites;
  fs.writeFileSync(path.join(t.run, 'flow.json'), JSON.stringify(st));
  assert.match(t.flow('status', t.run).out, /Target drift: .*cited in out\/A.md: src\/cited.ts$/m);

  t.put(NOTES);
  t.put('in/GLOSS.md');
  assert.ok(t.flow('send', t.run, 'CHECKED').ok);
  assert.doesNotMatch(t.flow('next', t.run).out, /Send AGAIN|No way back/, 'REVIEW: no onDrift, and a way back exists');
  assert.ok(t.flow('send', t.run, 'APPROVE', '--at', 'REVIEW', '--note', 'ok').ok);
  assert.match(
    t.flow('next', t.run).out,
    /Target drift: .*\nNo way back to WORK from BUILD: the human weighs the changed files against the work in hand\./,
  );
});

test('baseline: a target without git commits records none and reports no drift', () => {
  const t = fixture();
  walk(t, 'WORK');
  t.put('out/A.md');
  t.put('out/B.md');
  assert.match(t.flow('send', t.run, 'DONE_IT').out, /No baseline recorded/);
  assert.match(t.flow('status', t.run).out, /Baseline: none yet/);
  assert.doesNotMatch(t.flow('next', t.run).out, /Target drift/);
});

test('status: Resume lists the newest handoff, then the resume files that exist, in order', () => {
  const t = fixture();
  t.flow('init', t.run, '--target', t.target);
  assert.match(t.flow('status', t.run).out, /^Resume: +nothing yet$/m);
  t.put('in/LIST.md');
  t.flow('handoff', t.run);
  t.flow('handoff', t.run);
  assert.match(t.flow('status', t.run).out, /^Resume: +handoffs\/002.md, in\/LIST.md$/m);
  t.put(NOTES);
  assert.match(t.flow('status', t.run).out, /^Resume: +handoffs\/002.md, in\/NOTES.md, in\/LIST.md$/m);
});

test('init creates every folder the definition declares, plus handoffs', () => {
  const t = fixture();
  assert.ok(t.flow('init', t.run, '--target', t.target).ok);
  for (const d of ['in', 'out', 'items', 'handoffs']) assert.ok(fs.statSync(path.join(t.run, d)).isDirectory(), d);
});

test('init refuses an existing run or a run inside the target; handoff numbers files', () => {
  const t = fixture();
  const root = path.dirname(t.run);
  assert.match(t.flow('init', path.join(t.target, 'run'), '--target', t.target).out, /must be outside the target repo/);
  assert.match(t.flow('init', t.run, '--target', root).out, /target outside the run folder/);
  fs.symlinkSync(t.target, path.join(root, 'link'));
  assert.match(t.flow('init', path.join(root, 'link', 'run'), '--target', t.target).out, /must be outside the target repo/, 'seen through a symlink');
  fs.writeFileSync(path.join(root, 'file'), 'x');
  assert.match(t.flow('init', t.run, '--target', path.join(root, 'file')).out, /target repo not found/);
  t.flow('init', t.run, '--target', t.target);
  assert.match(t.flow('init', t.run, '--target', t.target).out, /already holds a flow; resume it with \/fixture /);
  t.flow('handoff', t.run);
  t.flow('handoff', t.run);
  assert.deepEqual(fs.readdirSync(path.join(t.run, 'handoffs')).sort(), ['001.md', '002.md']);
  assert.match(t.read('handoffs/002.md'), /State: \*\*START\*\*/);
  fs.rmSync(path.join(t.run, 'handoffs/001.md'));
  t.flow('handoff', t.run);
  assert.deepEqual(fs.readdirSync(path.join(t.run, 'handoffs')).sort(), ['002.md', '003.md'], 'a gap never overwrites 002');
});

test('a run whose state the definition no longer has fails with a clear message', () => {
  const t = fixture();
  t.flow('init', t.run, '--target', t.target);
  fs.writeFileSync(path.join(t.run, 'flow.json'), JSON.stringify({ ...JSON.parse(t.read('flow.json')), state: 'RETIRED_STATE' }));
  for (const args of [['next', t.run], ['send', t.run, 'GO']]) {
    const r = t.flow(...args);
    assert.ok(!r.ok, args[0]);
    assert.match(r.out, /RETIRED_STATE.*older definition/, args[0]);
    assert.doesNotMatch(r.out, /TypeError/, args[0]);
  }
  assert.ok(t.flow('status', t.run).ok, 'status still works, to inspect the run');
});

test('definition: a misspelled, incomplete or dangling field is refused at load, not ignored', () => {
  for (const [from, to, why] of [
    ["BUILT: { target: '@next', fresh:", "BUILT: { target: '@next', frsh:", /unknown field\(s\) frsh/],
    ["GO: { target: '@next'", "GO: { target: '@prev'", /@prev has no state there: START is the first/],
    ["on: {} }", "on: { ON: { target: '@next' } } }", /@next has no state there: END is the last/],
    ["BUILT: { target: '@next'", "BUILT: { target: 'BUILD_GTE'", /unknown state BUILD_GTE/],
    ['max: 2, ', '', /maxHint needs max/],
    ["baseline: { cites: 'out/A.md' }", 'baseline: true', /baseline needs \{ cites/],
    ['  dirs: [', '  folders: [', /dirs must list/],
  ]) {
    const r = run(engine(FIXTURE, [from, to]), 'status', path.dirname(FIXTURE));
    assert.ok(!r.ok, to);
    assert.match(r.out, why);
  }
});

test('the CLI refuses an unknown option or a stray argument instead of ignoring it', () => {
  const t = fixture();
  t.flow('init', t.run, '--target', t.target);
  assert.match(t.flow('status', t.run, '--taget', 'x').out, /unknown option --taget; known: --target, --at, --note/);
  assert.match(t.flow('status', t.run, 'extra').out, /unexpected argument\(s\): extra/);
  t.put('in/LIST.md');
  assert.match(t.flow('send', t.run, 'GO', 'extra').out, /unexpected argument\(s\): extra/);
  assert.equal(t.state(), 'START', 'nothing was sent');
  assert.ok(t.flow('send', t.run, 'GO').ok);
});
