// The engine's rules, on the made-up fixture flow: these never change when build-flow's steps do. See README.md, "Tests".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import fixture from './fixture.definition.mjs';
import { FIXTURE, engine, env, run, setup, ticket, walkTo } from './harness.mjs';

const FLOW = engine(FIXTURE);
const make = (opts) => setup(fixture, { flowPath: FLOW, ...opts });

// Finish the current item: a change in the target and an OK report, then DONE_IT.
function done(t) {
  const id = t.st().ticket;
  t.edit(`item ${id} ${Math.random()}\n`);
  t.put(`out/${id}/R.md`, 'Verdict: OK\n');
  return t.send('DONE_IT');
}
const item = (id) => [[[`out/${id}/R.md`, 'Verdict: OK\n']], 'DONE_IT'];
// The walk with a gate per item, to END.
const STEPS = [
  item('01'), [[], 'APPROVE'],
  item('03'), [[], 'APPROVE'],
  item('02'), [[], 'APPROVE'],
  [[], 'APPROVE'],                                   // ALL_GATE
  [['out/LOOK.md'], 'LOOKED'],
  [[], 'APPROVE'],                                   // LOOK_GATE
];
const ONE = { '01-ONLY.md': ticket('None') };

test('init orders the queue by blockers, copies the inputs, creates the folders and seeds, and prints the queue', () => {
  const t = make();
  const r = t.create('--gate', 'end');
  assert.ok(r.ok, r.out);
  const s = t.st();
  assert.equal(s.state, 'START');
  assert.equal(s.flow, 'fixture');
  assert.deepEqual(s.queue.map((x) => x.id), ['01', '03', '02']);
  assert.deepEqual(s.queue.map((x) => x.blockedBy), [[], ['01'], ['03']]);
  assert.equal(s.ticket, '01');
  assert.equal(s.target, null, 'the target is chosen by the workspace effect');
  assert.deepEqual(fs.readdirSync(path.join(t.run, 'input/tickets')).sort(), ['01-FIRST.md', '02-SECOND.md', '03-THIRD.md']);
  assert.ok(t.has('input/SPEC.md'));
  for (const d of ['in', 'out', 'handoffs']) assert.ok(fs.statSync(path.join(t.run, d)).isDirectory(), d);
  assert.equal(t.read('in/NOTES.md'), '# Notes\n', 'seeded');
  assert.match(r.out, /Created .* \(state START, repo .*, gate end, commit ticket, worktree ask\)/);
  assert.match(r.out, /- \[ \] 03 Third \(blocked by 01\)/, 'the heading number is not repeated');
  assert.match(r.out, /\/fixture /);
  const status = t.flow('status', t.run).out;
  assert.match(status, /Target: {2}\(chosen in START\)/);
  assert.match(status, /Resume: {2}in\/NOTES\.md/);
  assert.match(status, /- \[ \] 01 FIRST {2}← current/);
  assert.match(status, /- \[x\] in\/NOTES\.md/);
});

test('init refuses bad arguments, a run inside the repo, and a second run in the same folder', () => {
  const t = make();
  assert.match(t.flow('init', t.run, '--repo', t.repo).out, /needs --spec, --tickets, --gate/);
  assert.match(t.create('--gate', 'always').out, /--gate is ticket/);
  assert.match(t.create('--gate', 'end', '--commit', 'squash').out, /--commit is ticket \(default\) or none/);
  assert.match(t.flow('init', path.join(t.repo, 'run'), '--repo', t.repo, '--spec', t.spec, '--tickets', t.tdir, '--gate', 'end', '--worktree', 'ask').out, /outside the repo/);
  assert.match(t.flow('init', t.run, '--repo', t.root, '--spec', t.spec, '--tickets', t.tdir, '--gate', 'end', '--worktree', 'ask').out, /repo is not a git repo/);
  assert.match(t.create('--gate', 'end', '--worktree', 'always').out, /--worktree is auto \(default.*\) or ask/);
  assert.match(t.create('--gate', 'end', '--worktree', 'auto').out, /--worktree auto \(the default\) needs --scope <ticket-id>/);
  assert.match(t.flow('init', t.run, '--repo', t.repo, '--spec', t.spec, '--tickets', t.tdir, '--gate', 'end').out, /--worktree auto \(the default\) needs --scope/, 'auto is the default');
  assert.match(t.create('--gate', 'end', '--worktree', 'auto', '--scope', 'a b').out, /can't be a commit scope/);
  for (const bad of ['OOC:120', 'OOC..120', 'OOC~1', 'OOC^1', 'OOC?1', 'OOC*1', 'OOC[1', 'OOC\\1', '/OOC', 'OOC/', 'OOC.lock'])
    assert.match(t.create('--gate', 'end', '--worktree', 'auto', '--scope', bad).out, /can't be part of a git branch name/, bad);
  assert.ok(!t.has('flow.json'), 'nothing created for a bad scope');
  for (const good of ['OOC-120', 'ooc_120', 'OOC/120', 'v1.2']) {
    const r = t.create('--gate', 'end', '--worktree', 'auto', '--scope', good);
    assert.ok(r.ok, `${good}: ${r.out}`);
    fs.rmSync(t.run, { recursive: true, force: true });
  }
  assert.match(t.create('--gate', 'end', '--bogus', 'x').out, /unknown option --bogus/);
  assert.ok(t.create('--gate', 'end').ok);
  assert.match(t.create('--gate', 'end').out, /already holds a flow/);
  assert.match(t.flow('status', t.run, 'extra').out, /unexpected argument\(s\): extra/);
});

test('init refuses tickets with missing sections, unknown blockers or cycles', () => {
  const cases = [
    [{ '01-A.md': '## What to build\n\nx\n\n## Blocked by\n\nNone\n' }, /01-A.md lacks a non-empty "## Acceptance criteria"/],
    [{ '01-A.md': ticket('- 07') }, /blocked by ticket 7, which is not in the folder/],
    [{ '01-A.md': ticket('- 02'), '02-B.md': ticket('- 01') }, /blocking cycle among: 01-A.md, 02-B.md/],
    [{ '01-A.md': ticket('None'), '1-B.md': ticket('None') }, /share ticket number 1/],
    [{ 'README.md': 'x' }, /no ticket files/],
  ];
  for (const [tickets, err] of cases) {
    const t = make({ tickets });
    const r = t.init('--gate', 'end');
    assert.ok(!r.ok);
    assert.match(r.out, err);
    assert.ok(!t.has('flow.json'), 'nothing created');
  }
});

test('a ticket title is its first "# " heading outside code fences, else its slug', () => {
  const fence = '```sh\n# install deps\nnpm ci\n```\n\n';
  const t = make({ tickets: { '01-FIRST.md': fence + ticket('None'), '02-SECOND.md': `${fence}# 02 Real title\n\n${ticket('None')}` } });
  assert.ok(t.create('--gate', 'end').ok);
  assert.deepEqual(t.st().queue.map((x) => x.title), ['FIRST', 'Real title']);
});

test('workspace: the event checks the target and branch, then records them and the base', () => {
  const t = make();
  assert.ok(t.create('--gate', 'end').ok);
  assert.match(t.flow('next', t.run).out, /Pick the workspace for \S+repo\./, 'the repo fills the instructions');
  assert.match(t.send('DONE_IT').out, /DONE_IT is not allowed in START/);
  assert.match(t.send('GO', '--note', 'x').out, /GO needs --target <repo-or-worktree> and --branch <name>/);
  for (const bad of ['two words', 'a(b)'])
    assert.match(t.ready(t.repo, 'main', '--scope', bad).out, /can't be a commit scope/, bad);
  assert.match(t.ready(t.repo, 'feature').out, /is on main, not feature/);
  const other = path.join(t.root, 'other');
  fs.mkdirSync(other);
  spawnSync('git', ['-C', other, 'init', '-q']);
  assert.match(t.ready(other).out, /is neither .* nor one of its worktrees/);
  assert.match(t.ready(t.root).out, /target is not a git repo/);
  assert.equal(t.st().state, 'START', 'a failed check leaves the state');

  assert.ok(t.ready(t.repo, 'main', '--scope', 'ABC-1').ok);
  const s = t.st();
  assert.equal(s.state, 'WORK');
  assert.equal(s.target, t.repo);
  assert.equal(s.branch, 'main');
  assert.equal(s.source, null);
  assert.equal(s.scope, 'ABC-1');
  assert.match(t.flow('status', t.run).out, /Scope: ABC-1/);
  assert.equal(s.base, t.git('rev-parse', 'HEAD').stdout.trim());
});

test('workspace: a worktree needs --source, which must exist and still be where the worktree is', () => {
  const t = make();
  const wt = path.join(t.root, 'wt');
  assert.equal(t.git('worktree', 'add', '-q', '-b', 'feature/x', wt, 'main').status, 0);
  assert.ok(t.create('--gate', 'end').ok);
  assert.match(t.ready(wt, 'feature/x').out, /is a worktree: pass --source/);
  assert.match(t.ready(wt, 'feature/x', '--source', 'nope').out, /--source nope is not a branch or commit/);
  const r = t.ready(wt, 'feature/x', '--source', 'main');
  assert.ok(r.ok, r.out);
  assert.equal(t.st().target, wt);
  assert.equal(t.st().source, 'main');
  assert.match(t.flow('status', t.run).out, /Source: {2}main\n/);
  fs.writeFileSync(path.join(wt, 'app.txt'), 'in the worktree\n');
  t.put('out/01/R.md', 'Verdict: OK\n');
  assert.ok(t.send('DONE_IT').ok);
  assert.equal(t.git('log', '-1', '--format=%s', 'feature/x').stdout.trim(), 'Ticket 01: FIRST');
  assert.equal(t.git('rev-list', '--count', 'main').stdout.trim(), '1', 'main is untouched');

  const u = make();
  const wu = path.join(u.root, 'wt');
  u.git('worktree', 'add', '-q', '-b', 'feature/y', wu, 'main');
  spawnSync('git', ['-C', wu, 'commit', '-q', '--allow-empty', '-m', 'moved'], { env });
  assert.ok(u.create('--gate', 'end').ok);
  assert.match(u.ready(wu, 'feature/y', '--source', 'main').out, /not at --source main .* it has moved since it was created/);
  assert.ok(u.ready(u.repo, 'main', '--source', 'main').ok, 'the repo itself may name a source too');
  assert.equal(u.st().source, 'main');
});

test('workspace, worktree auto: init records the mode and the scope; the agent event needs a new worktree and no gate flags', () => {
  const t = make();
  const r = t.create('--gate', 'end', '--worktree', 'auto', '--scope', 'ABC-1');
  assert.ok(r.ok, r.out);
  assert.match(r.out, /worktree auto\)/);
  assert.match(r.out, /Switch the session to auto mode/, 'nobody approves anything before the build gate');
  assert.equal(t.st().worktree, 'auto');
  assert.equal(t.st().scope, 'ABC-1');
  assert.match(t.flow('status', t.run).out, /Worktree: auto · Scope: ABC-1/);
  const go = (...args) => t.flow('send', t.run, 'GO_NEW', ...args);
  assert.match(go('--target', t.repo, '--branch', 'main').out, /builds in a new worktree of .*, not in the repo itself/);
  const wt = path.join(t.root, 'wt');
  t.git('worktree', 'add', '-q', '-b', 'feature/ABC-1-x', wt, 'main');
  assert.match(go('--target', wt, '--branch', 'feature/ABC-1-x').out, /is a worktree: pass --source/);
  assert.match(go('--target', wt, '--branch', 'feature/ABC-1-x', '--source', 'main', '--scope', 'XYZ-9').out, /this run's scope is ABC-1, given at init/);
  assert.equal(t.st().state, 'START');
  const ok = go('--target', wt, '--branch', 'feature/ABC-1-x', '--source', 'main');
  assert.ok(ok.ok, ok.out);
  assert.equal(t.st().state, 'WORK');
  assert.equal(t.st().target, wt);
  assert.equal(t.st().scope, 'ABC-1', 'the scope from init stands');
  const last = JSON.parse(t.read('events.jsonl').trim().split('\n').at(-1));
  assert.equal(last.event, 'GO_NEW');
  assert.equal(last.human, undefined, 'not a human gate');

  const g = make();
  const gr = g.create('--gate', 'ticket', '--worktree', 'auto', '--scope', 'ABC-1');
  assert.doesNotMatch(gr.out, /Switch the session/, 'a gate per ticket: the human is around');
  assert.ok(g.ready(g.repo, 'main', '--scope', 'ABC-1').ok, 'the human gate stays open as the fallback');
});

test('workspace, worktree ask: the agent event is refused, also for a run created before the option', () => {
  const t = make();
  assert.ok(t.create('--gate', 'end').ok);
  assert.equal(t.st().worktree, 'ask');
  assert.equal(t.st().scope, null);
  const wt = path.join(t.root, 'wt');
  t.git('worktree', 'add', '-q', '-b', 'feature/x', wt, 'main');
  assert.match(t.flow('send', t.run, 'GO_NEW', '--target', wt, '--branch', 'feature/x', '--source', 'main').out, /refused: the human picks/);

  const old = make();
  assert.ok(old.create('--gate', 'end', '--worktree', 'auto', '--scope', 'ABC-1').ok);
  const st = old.st();
  delete st.worktree;
  fs.writeFileSync(path.join(old.run, 'flow.json'), JSON.stringify(st));
  assert.match(old.flow('status', old.run).out, /Worktree: ask/);
  const wo = path.join(old.root, 'wt');
  old.git('worktree', 'add', '-q', '-b', 'feature/x', wo, 'main');
  assert.match(old.flow('send', old.run, 'GO_NEW', '--target', wo, '--branch', 'feature/x', '--source', 'main').out, /refused: the human picks/);
});

test('workspace: refuses a dirty tree in commit mode ticket, and a target holding the run', () => {
  const t = make();
  t.edit('dirty\n');
  assert.ok(t.create('--gate', 'end', '--commit', 'ticket').ok, 'init does not check the tree');
  assert.match(t.ready().out, /--commit ticket needs a clean working tree/);
  t.git('checkout', '--', 'app.txt');
  assert.ok(t.ready().ok);
  const w = make();
  w.edit('dirty\n');
  assert.ok(w.init('--gate', 'end', '--commit', 'none').ok, 'a dirty tree is fine without commits');
  const v = make();
  assert.ok(v.create('--gate', 'end').ok);
  const inside = path.join(v.run, 'wt');
  v.git('worktree', 'add', '-q', '-b', 'x', inside, 'main');
  assert.match(v.ready(inside, 'x').out, /run folder must be outside the target/);
});

test('status and handoff flag a target off the recorded branch; send refuses to act from it', () => {
  const t = make();
  assert.ok(t.init('--gate', 'ticket').ok);
  assert.match(t.flow('status', t.run).out, /Branch: {2}main\n/);
  assert.ok(done(t).ok);
  t.git('switch', '-q', '-c', 'other');
  assert.match(t.flow('status', t.run).out, /Branch: {2}main — MISMATCH: the target is now on other/);
  t.flow('handoff', t.run);
  assert.match(t.read('handoffs/001.md'), /MISMATCH/);
  const r = t.send('APPROVE', '--note', 'ok');
  assert.ok(!r.ok);
  assert.match(r.out, /is on other, not the run's branch main: switch back before sending APPROVE; nothing was sent/);
  assert.equal(t.st().state, 'ITEM_GATE');
  assert.equal(t.git('log', '-1', '--format=%s', 'other').stdout.trim(), 'initial', 'nothing committed on the other branch');
  t.git('switch', '-q', 'main');
  assert.ok(t.send('APPROVE', '--note', 'ok').ok);
});

test('human gates need --note and --at, plus --ticket where the gate is per ticket; a replayed event is refused', () => {
  const t = make();
  assert.ok(t.init('--gate', 'ticket').ok);
  assert.match(t.send('APPROVE', '--note', 'x').out, /not allowed in WORK/);
  assert.ok(done(t).ok);
  assert.match(t.send('APPROVE').out, /human gate: pass --note/);
  assert.match(t.flow('next', t.run).out, /APPROVE -> WORK \[human gate: --at ITEM_GATE --ticket 01 and --note required\]/);
  assert.match(t.flow('send', t.run, 'APPROVE', '--note', 'ok').out, /pass --at ITEM_GATE --ticket 01/);
  assert.match(t.flow('send', t.run, 'APPROVE', '--at', 'ITEM_GATE', '--note', 'ok').out, /pass --at ITEM_GATE --ticket 01/);
  const approve01 = ['send', t.run, 'APPROVE', '--at', 'ITEM_GATE', '--ticket', '01', '--note', 'ok'];
  assert.ok(t.flow(...approve01).ok);
  assert.ok(done(t).ok);
  assert.equal(t.st().ticket, '03');
  const replay = t.flow(...approve01);
  assert.ok(!replay.ok, 'the same command at the next ticket is refused');
  assert.match(replay.out, /--ticket 01: the current ticket is 03.*nothing was sent/);
  assert.match(t.flow('send', t.run, 'REJECT', '--at', 'ALL_GATE', '--note', 'x').out, /the run is now in ITEM_GATE/);
  assert.equal(t.st().state, 'ITEM_GATE');
});

test('routes: gate ticket stops at the per-ticket gate; gate end records each item and moves on; the last goes to the gate on all', () => {
  const t = make();
  walkTo(t, 'END', STEPS, ['--gate', 'ticket']);
  assert.equal(t.commits(), '4', 'three items committed');
  assert.match(t.flow('next', t.run).out, /Final state: no events\./);

  const u = make();
  u.init('--gate', 'end', '--commit', 'none');
  for (const id of ['01', '03']) {
    assert.equal(u.st().ticket, id);
    assert.ok(done(u).ok);
    assert.equal(u.st().state, 'WORK');
    assert.ok(u.has(`out/${id}/all.patch`));
  }
  assert.ok(done(u).ok);
  assert.equal(u.st().state, 'ALL_GATE');
  assert.equal(u.st().ticket, null);
  assert.match(u.read('out/02/all.patch'), /\+item 02/);
  assert.equal(u.commits(), '1', 'nothing committed');
  assert.match(u.flow('status', u.run).out, /- \[x\] 02 SECOND/);
  assert.match(u.flow('status', u.run).out, /Ticket: {2}all 3 built/);
});

test('accept: commits the item as "Ticket NN: title" or --message, and fails with nothing to commit', () => {
  const t = make();
  assert.ok(t.init('--gate', 'ticket', '--commit', 'ticket').ok);
  assert.ok(done(t).ok);
  assert.equal(t.commits(), '1', 'not committed before approval');
  assert.ok(t.send('APPROVE', '--note', 'good').ok);
  assert.equal(t.subject(), 'Ticket 01: FIRST');
  assert.equal(t.st().queue[0].sha, t.git('rev-parse', 'HEAD').stdout.trim());
  assert.equal(t.st().ticket, '03');
  assert.ok(done(t).ok);
  assert.ok(t.send('APPROVE', '--message', 'feat: third', '--note', 'ok').ok);
  assert.equal(t.subject(), 'feat: third');

  const u = make();
  u.init('--gate', 'end', '--commit', 'ticket');
  u.put('out/01/R.md', 'Verdict: OK\n');
  const r = u.send('DONE_IT');
  assert.ok(!r.ok);
  assert.match(r.out, /nothing to commit/);
  assert.match(r.out, /send the event again with --unchanged '<why>'/);
  assert.equal(u.st().state, 'WORK');
  assert.equal(u.st().ticket, '01');
});

test('accept: --unchanged records a ticket that needs no change with no commit, and is refused when there are changes', () => {
  const u = make();
  u.init('--gate', 'end', '--commit', 'ticket');
  u.put('out/01/R.md', 'Verdict: OK\n');
  u.edit();
  const dirty = u.send('DONE_IT', '--unchanged', 'already there');
  assert.match(dirty.out, /--unchanged: .* has changes to commit for ticket 01; send the event without it/);
  assert.equal(u.st().ticket, '01');
  u.git('reset', '-q', '--hard');
  const r = u.send('DONE_IT', '--unchanged', 'already there');
  assert.ok(r.ok, r.out);
  assert.equal(u.commits(), '1', 'no commit');
  assert.equal(u.st().queue[0].done, true);
  assert.equal(u.st().queue[0].sha, undefined);
  assert.equal(u.st().queue[0].unchanged, 'already there');
  assert.equal(u.st().ticket, '03');
  assert.match(u.flow('status', u.run).out, /- \[x\] 01 FIRST · no change: already there/);
  assert.ok(done(u).ok, 'the next item commits as usual');
  assert.equal(u.commits(), '2');
});

test('guards: requires, fresh and verdict print their reasons in a fixed order', () => {
  const t = make({ tickets: { '01-A.md': ticket('None'), '02-B.md': ticket('None') } });
  t.init('--gate', 'ticket');
  const out = t.send('DONE_IT').out;
  assert.match(out, /missing or empty: out\/01\/R.md\n\s+out\/01\/R.md must say "Verdict: OK" \(found: no verdict\)/);
  t.put('out/01/R.md', 'Verdict: BAD\n');
  assert.match(t.send('DONE_IT').out, /must say "Verdict: OK" \(found: BAD\)/);
  t.put('out/01/R.md', 'Verdict: OK\n');
  assert.ok(t.send('DONE_IT').ok);
  assert.ok(t.send('REJECT', '--note', 'redo').ok);
  assert.match(t.send('DONE_IT').out, /not updated since entering WORK: out\/01\/R.md/);
  t.put('out/01/R.md', 'Verdict: OK\n');
  assert.ok(t.send('DONE_IT').ok);
  assert.match(t.flow('next', t.run).out, /REJECT -> WORK \[human gate/, 'sanity: a human state prints its events');
});

test('maxPerPass: consecutive sends from the state are counted; entering it another way starts a new pass', () => {
  const t = make();
  assert.ok(t.init('--gate', 'end').ok);
  const bad = () => t.put('out/01/R.md', `Verdict: BAD\n\n${Math.random()}\n`);
  t.put('out/01/R.md', 'Verdict: OK\n');
  assert.match(t.send('AGAIN').out, /must say "Verdict: BAD"/);
  assert.match(t.flow('next', t.run).out, /AGAIN 2 of 2\./, 'left and max fill the instructions');
  bad();
  assert.ok(t.send('AGAIN').ok);
  assert.match(t.send('AGAIN').out, /not updated since entering WORK/);
  bad();
  assert.ok(t.send('AGAIN').ok);
  bad();
  assert.match(t.flow('next', t.run).out, /AGAIN -> WORK \(blocked\)\n\s+used 2 of 2 times this pass: give up/);
  assert.match(t.flow('next', t.run).out, /AGAIN 0 of 2\./);
  assert.ok(!t.send('AGAIN').ok);
  t.put('HALT.md');
  assert.ok(t.send('HALT').ok);
  t.flow('handoff', t.run); // not a move: does not end the pass count
  assert.ok(t.send('RESUME', '--note', 'go on').ok);
  assert.equal(t.st().state, 'WORK');
  bad();
  assert.ok(t.send('AGAIN').ok, 'a new pass');
  assert.match(t.flow('next', t.run).out, /AGAIN 1 of 2\./);
});

test('max: sends from the state are counted over the whole run, with the hint once used up', () => {
  const t = make({ tickets: ONE });
  walkTo(t, 'LOOK_GATE', STEPS);
  assert.match(t.flow('next', t.run).out, /Decide \(2 left\)\./);
  for (let i = 1; i <= 2; i++) {
    assert.ok(t.send('REJECT', '--note', `round ${i}`).ok);
    assert.equal(t.st().state, 'FIX');
    t.edit(`fix ${i}\n`);
    t.put('out/FIX.md', 'Verdict: OK\n');
    assert.ok(t.send('FIXED').ok);
    assert.equal(t.st().state, 'LOOK', 'after the review started, a fix goes back through LOOK');
    t.put('out/LOOK.md', `round ${i}\n`);
    assert.ok(t.send('LOOKED').ok);
    assert.ok(t.has(`out/LOOK-${i + 1}.md`), 'each round archived');
  }
  assert.match(t.flow('next', t.run).out, /Decide \(0 left\)\./);
  const r = t.send('REJECT', '--note', 'once more');
  assert.ok(!r.ok);
  assert.match(r.out, /REJECT blocked:\n\s+used 2 of 2 times: approve instead/);
  assert.equal(t.st().state, 'LOOK_GATE');
  assert.ok(t.send('APPROVE', '--note', 'fine').ok);
  assert.equal(t.st().state, 'END');
});

test('a refused route blocks the event with its reason; @resume returns to the state the escalation named', () => {
  const t = make();
  t.init('--gate', 'end');
  assert.match(t.send('HALT').out, /missing or empty: HALT.md/);
  t.put('HALT.md', 'why');
  assert.ok(t.send('HALT').ok);
  assert.equal(t.st().state, 'STOPPED');
  assert.match(t.flow('next', t.run).out, /Stopped; resumes WORK\./);
  assert.match(t.flow('next', t.run).out, /DROP -> \? \[human gate[^\]]*\] \(blocked\)\n\s+refused: items left/);
  const r = t.send('DROP', '--note', 'fine');
  assert.ok(!r.ok);
  assert.match(r.out, /refused: items left/);
  assert.ok(t.send('RESUME', '--note', 'carry on').ok);
  assert.equal(t.st().state, 'WORK');
  assert.equal(t.st().ticket, '01');
});

test('routes read the facts: before a review a fix returns to the gate on all; after one, to LOOK; DROP follows the same', () => {
  const t = make({ tickets: ONE });
  walkTo(t, 'ALL_GATE', STEPS);
  assert.ok(t.send('REJECT', '--note', 'not yet').ok);
  assert.equal(t.st().state, 'FIX');
  t.put('HALT.md', 'stuck');
  assert.ok(t.send('HALT').ok);
  assert.match(t.flow('next', t.run).out, /DROP -> ALL_GATE/);
  assert.ok(t.send('DROP', '--note', 'leave it').ok);
  assert.equal(t.st().state, 'ALL_GATE');
  assert.ok(t.send('REJECT', '--note', 'try again').ok);
  t.edit('fixed\n');
  t.put('out/FIX.md', 'Verdict: OK\n');
  assert.ok(t.send('FIXED').ok);
  assert.equal(t.st().state, 'ALL_GATE', 'no review yet');
  assert.ok(t.has('out/fix-1.patch'));

  assert.ok(t.send('APPROVE', '--note', 'look at the edges').ok);
  assert.equal(t.st().state, 'LOOK');
  assert.equal(t.st().reviewed, true, 'startReview');
  assert.match(t.read('out/BRIEF.md'), /look at the edges/, 'the event\'s own noteTo');
  t.put('out/LOOK.md');
  assert.ok(t.send('LOOKED').ok);
  assert.ok(t.send('REJECT', '--note', 'fix F1').ok);
  t.put('HALT.md', 'guardrail');
  assert.ok(t.send('HALT').ok);
  assert.match(t.send('DROP', '--note', 'as it stands').out, /missing or empty: out\/REPORT.md/, 'a route\'s own requires');
  t.put('out/REPORT.md');
  assert.ok(t.send('DROP', '--note', 'as it stands').ok);
  assert.equal(t.st().state, 'LOOK_GATE');
});

test('recordRepair saves the change since the last verified tree; commitRepair commits it only on a human event', () => {
  const t = make({ tickets: ONE });
  walkTo(t, 'LOOK_GATE', STEPS, ['--gate', 'ticket', '--commit', 'ticket']);
  assert.equal(t.commits(), '2');
  assert.ok(t.send('REJECT', '--note', 'fix it').ok);
  t.edit('fixed F1\n');
  t.put('out/FIX.md', 'Verdict: OK\n');
  assert.ok(t.send('FIXED').ok);
  const patch = t.read('out/fix-1.patch');
  assert.match(patch, /\+fixed F1/);
  assert.doesNotMatch(patch, /\+DONE_IT/, 'the repair only, not the item');
  assert.equal(t.commits(), '2', 'an agent event commits nothing');
  assert.equal(t.st().pendingRepair, true);
  t.put('out/LOOK.md');
  assert.ok(t.send('LOOKED').ok);
  assert.equal(t.commits(), '2');
  assert.ok(t.send('APPROVE', '--message', 'fix: F1', '--note', 'ship it').ok);
  assert.equal(t.commits(), '3', 'committed on the human\'s APPROVE');
  assert.equal(t.subject(), 'fix: F1');
  assert.deepEqual(t.st().repairShas, [t.git('rev-parse', 'HEAD').stdout.trim()]);
  assert.equal(t.st().pendingRepair, false);
});

test('noteTo appends the note with the event, state and ticket; approvals without a noteTo leave no trace', () => {
  const t = make();
  assert.ok(t.init('--gate', 'ticket').ok);
  assert.ok(done(t).ok);
  assert.ok(t.send('REJECT', '--note', 'countries come from config').ok);
  assert.match(t.read('in/NOTES.md'), /\n## \S+ REJECT at ITEM_GATE, ticket 01\n\ncountries come from config\n/);
  assert.match(t.flow('next', t.run).out, /Entered via REJECT — "countries come from config"/);
  assert.ok(done(t).ok);
  assert.ok(t.send('APPROVE', '--note', 'ok').ok);
  assert.doesNotMatch(t.read('in/NOTES.md'), /\bok\b/);
});

test('instructions: placeholders are filled from the run, and a do function sees how the state was entered', () => {
  const t = make();
  t.init('--gate', 'ticket', '--commit', 'none');
  assert.ok(done(t).ok);
  assert.ok(t.send('APPROVE', '--note', 'ok').ok);
  const out = t.flow('next', t.run).out;
  assert.match(out, /Ticket: 03 Third \(2 of 3\)/);
  assert.match(out, /Work item 03: Third \(input\/tickets\/03-THIRD.md\); blocked by 01 FIRST; built out\/01\/R.md; AGAIN 2 of 2\./);
  assert.doesNotMatch(out, /\{[\w.]+\}/, 'no unfilled placeholder');
  assert.ok(done(t).ok);
  assert.ok(t.send('APPROVE', '--note', 'ok').ok);
  assert.ok(done(t).ok);
  assert.match(t.flow('next', t.run).out, /Check item 02\./);
  assert.ok(t.send('REJECT', '--note', 'no').ok);
  assert.ok(done(t).ok);
  assert.ok(t.send('APPROVE', '--note', 'ok').ok);
  assert.equal(t.st().state, 'ALL_GATE');
  assert.match(t.flow('next', t.run).out, /Commit first\. Check all\./, 'entered via APPROVE in commit mode none');

  const u = make({ tickets: ONE });
  u.init('--gate', 'end', '--commit', 'none');
  assert.ok(done(u).ok);
  assert.match(u.flow('next', u.run).out, /^Check all\./m, 'entered via DONE_IT: no commit step');
});

test('drift: a change after the verified tree is reported at a gate and after a human event, and by the drift command', () => {
  const t = make();
  assert.ok(t.init('--gate', 'ticket').ok);
  assert.match(t.flow('drift', t.run).out, /Nothing verified yet/);
  assert.ok(done(t).ok);
  assert.doesNotMatch(t.flow('next', t.run).out, /Changed in the target/, 'nothing changed since');
  assert.match(t.flow('drift', t.run).out, /No changes since ticket 01 was verified/);
  t.edit('the human tweaks it\n');
  fs.writeFileSync(path.join(t.repo, 'extra.txt'), 'new\n');
  const gate = t.flow('next', t.run).out;
  assert.match(gate, /Changed in the target since ticket 01 was verified/);
  assert.match(gate, /app\.txt/);
  assert.match(gate, /extra\.txt/, 'untracked files count');
  assert.equal(t.git('status', '--porcelain').stdout.includes('A '), false, 'the target index is untouched');
  assert.ok(t.send('REJECT', '--note', 'ok').ok);
  assert.match(t.flow('next', t.run).out, /Changed in the target since ticket 01/, 'shown right after a human event');
  t.git('add', '-A');
  t.git('commit', '-qm', 'with the human edit');
  assert.match(t.flow('drift', t.run).out, /Changed since ticket 01 was verified:[\s\S]*app\.txt/, 'committing does not hide the edit');
});

test('drift names the test cases deleted since verification', () => {
  const t = make({ tickets: ONE });
  t.init('--gate', 'ticket', '--commit', 'none');
  const spec = path.join(t.repo, 'test/app.test.js');
  fs.mkdirSync(path.dirname(spec), { recursive: true });
  fs.writeFileSync(spec, "describe('app', () => {\n  it('saves', () => {});\n  it(\"cancels\", () => {});\n});\n");
  fs.writeFileSync(path.join(t.repo, 'notes.md'), "it('is not a test file')\n");
  assert.ok(done(t).ok);
  fs.writeFileSync(spec, "describe('app', () => {\n  it('saves', () => {});\n});\n");
  fs.writeFileSync(path.join(t.repo, 'notes.md'), '');
  const out = t.flow('drift', t.run).out;
  assert.match(out, /Deleted test cases \(ask the human whether each was deliberate, and record the answer\):\n- test\/app\.test\.js: cancels/);
  assert.doesNotMatch(out, /: saves/);
  assert.doesNotMatch(out, /is not a test file/);
});

test('a run whose state the definition no longer has fails with a clear message; status still works', () => {
  const t = make();
  t.init('--gate', 'end');
  fs.writeFileSync(path.join(t.run, 'flow.json'), JSON.stringify({ ...t.st(), state: 'RETIRED_STATE' }));
  const r = t.flow('next', t.run);
  assert.ok(!r.ok);
  assert.match(r.out, /RETIRED_STATE.*older definition/);
  assert.ok(t.flow('status', t.run).ok);
});

test('handoff numbers its files, lists the queue, and becomes the first resume file', () => {
  const t = make();
  t.init('--gate', 'end');
  t.flow('handoff', t.run);
  t.flow('handoff', t.run);
  assert.deepEqual(fs.readdirSync(path.join(t.run, 'handoffs')).sort(), ['001.md', '002.md']);
  const h = t.read('handoffs/002.md');
  assert.match(h, /State: \*\*WORK\*\* · Ticket: 01 FIRST \(1 of 3\)/);
  assert.match(h, /Resume with: `\/fixture /);
  assert.match(h, /- \[ \] 02 SECOND/);
  assert.match(t.flow('status', t.run).out, /Resume: {2}handoffs\/002\.md, in\/NOTES\.md/);
});

test('without a run folder, a command uses the run last named on the command line', () => {
  const t = make();
  assert.ok(t.init('--gate', 'ticket').ok);
  assert.ok(done(t).ok);
  const r = t.flow('send', 'REJECT', ...t.pin(), '--note', `say "PEAN" | 'NON'`);
  assert.ok(r.ok, r.out);
  assert.match(r.out, new RegExp(`fixture: run ${t.run}`), 'it names the run it fell back on');
  assert.equal(t.st().state, 'WORK');
  assert.match(t.flow('next').out, /Entered via REJECT — "say "PEAN" \| 'NON'"/, 'the note keeps its quotes');
  assert.match(t.flow('status', path.join(t.root, 'nope')).out, /no flow\.json in/, 'a missing path is an error');
  assert.match(t.flow('init').out, /usage: fixture/, 'init always needs a run folder');
});

test('initial may be a list of routes: init enters the first whose condition holds for the new run', () => {
  const routed = engine(FIXTURE, ["initial: 'START'", "initial: [{ when: { worktree: 'auto' }, target: 'LOOK' }, { target: 'START' }]"]);
  const auto = make({ flowPath: routed });
  const r = auto.create('--gate', 'end', '--worktree', 'auto', '--scope', 'ABC-1');
  assert.ok(r.ok, r.out);
  assert.match(r.out, /\(state LOOK, /);
  assert.equal(auto.st().state, 'LOOK');
  assert.equal(JSON.parse(auto.read('events.jsonl').trim()).to, 'LOOK');
  assert.match(auto.flow('status', auto.run).out, /Target: {2}-\n/, 'no event of this state chooses the workspace');
  const ask = make({ flowPath: routed });
  assert.ok(ask.create('--gate', 'end').ok);
  assert.equal(ask.st().state, 'START');
});

test('the definition is checked at load', () => {
  const cases = [
    [["resume: 'FIX'", "resumes: 'FIX'"], /FIX --HALT--> unknown field\(s\) resumes/],
    [["when: { resume: 'WORK' }", "when: { resumed: 'WORK' }"], /STOPPED --DROP--> unknown fact resumed in when/],
    [["do: 'Stop.', on: {}", "do: 'Stop.', on: { MORE: { target: '@next' } }"], /END --MORE--> @next has no state there: END is the last state/],
    [["reject: 'WORK' }", "reject: 'WURK' }"], /ITEM_GATE --REJECT--> unknown state WURK/],
    [["refuse: 'items left'", "refuse: 'items left', target: 'END'"], /STOPPED --DROP--> a refusal has a condition and no target/],
    [["maxPerPass: 2, maxHint: 'give up'", "maxHint: 'give up'"], /WORK --AGAIN--> maxHint needs max or maxPerPass/],
    [["{ target: 'LOOK' }]", "{ when: { reviewed: true }, target: 'LOOK' }]"], /FIX --FIXED--> the last route needs no condition/],
    [["resume: 'WORK' }", "resume: 'NOWHERE' }"], /WORK --HALT--> resumes unknown state NOWHERE/],
    [["initial: 'START'", "initial: 'NOWHERE'"], /definition: initial unknown state NOWHERE/],
    [["initial: 'START'", "initial: [{ when: { mode: 'x' }, target: 'WORK' }, { target: 'START' }]"], /definition: initial unknown fact mode in when/],
    [["initial: 'START'", "initial: [{ when: { worktree: 'auto' }, target: 'START' }]"], /definition: initial the last route needs no condition/],
  ];
  for (const [edit, err] of cases) {
    const r = run(engine(FIXTURE, edit));
    assert.ok(!r.ok, edit[1]);
    assert.match(r.out, err);
  }
  assert.match(run(FLOW).out, /^fixture: usage:/, 'the fixture itself loads');
});
