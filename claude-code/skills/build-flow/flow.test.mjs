// build-flow's own steps, on the real definition: update STEPS with the steps. Engine rules live in engine.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import def from './flow.definition.mjs';
import { setup, ticket, walkTo } from './harness.mjs';

const make = (opts) => setup(def, opts);
const ONE = { '01-ONLY.md': ticket('None') };

const PASS = 'Verdict: PASS\n';
const IMPL = () => `## Summary\n\nx\n\n## Build so far\n\n${Math.random()}\n`;
const MESSAGE = ['--message', 'feat(ABC-1): build the ticket'];
const built = (id) => [[[`build/${id}/IMPL.md`, IMPL()], [`build/${id}/VERIFY.md`, PASS]], 'BUILT', ...MESSAGE];
const reviewed = [['review/REVIEW.md', 'REPORT.md'], 'REVIEWED'];

// The happy path with a gate per ticket (three tickets in blocker order 01, 03, 02), then the build gate, one review, DONE.
const STEPS = [
  built('01'), [[], 'APPROVE'],
  built('03'), [[], 'APPROVE'],
  built('02'), [[], 'APPROVE'],
  [[], 'APPROVE'],              // BUILD_GATE
  reviewed,
  [[], 'APPROVE'],              // REVIEW_GATE
];
// With a single ticket, in either gate mode (walkTo skips an APPROVE the state doesn't allow).
const STEPS_ONE = [built('01'), [[], 'APPROVE'], [[], 'APPROVE'], reviewed, [[], 'APPROVE']];

// Implement and verify the current ticket, then send BUILT.
// `extra` defaults to a commit message of the shape an unattended commit needs; it is harmless elsewhere.
function build(t, extra = MESSAGE) {
  const id = t.st().ticket;
  t.edit(`ticket ${id} ${Math.random()}\n`);
  t.put(`build/${id}/IMPL.md`, IMPL());
  t.put(`build/${id}/VERIFY.md`, PASS);
  return t.send('BUILT', ...extra);
}
const repair = (t, extra = MESSAGE) => {
  t.edit(`repair ${Math.random()}\n`);
  t.put('review/REPAIR.md', PASS);
  return t.send('REPAIRED', ...extra);
};
const review = (t, body = 'F1 MINOR ...\n') => {
  t.put('review/REVIEW.md', body);
  t.put('REPORT.md', body);
  return t.send('REVIEWED');
};

test('gate ticket, commit ticket: every ticket stops at TICKET_GATE and APPROVE records it as a patch, the commit being the human\'s; then one build gate, one review, DONE', () => {
  const t = make();
  walkTo(t, 'TICKET_GATE', STEPS, ['--gate', 'ticket']);
  assert.match(t.flow('next', t.run).out, /commits nothing\. The next state then starts by suggesting its commit message/);
  walkTo(t, 'BUILD_GATE', STEPS, ['--gate', 'ticket']);
  assert.equal(t.commits(), '1', 'the engine commits no ticket: the human does');
  for (const id of ['01', '03', '02']) assert.ok(t.has(`build/${id}/cumulative.patch`), id);
  assert.ok(t.st().queue.every((x) => x.done && !x.sha));
  assert.match(t.flow('next', t.run).out, /log --oneline \w+\.\.HEAD/);
  walkTo(t, 'DONE', STEPS, ['--gate', 'ticket']);
  assert.match(t.flow('next', t.run).out, /Final state/);
});

test('gate end, commit ticket: BUILT commits the ticket itself, so it needs a --message shaped as references/commit-msg.md asks', () => {
  const t = make();
  t.init('--gate', 'end', '--commit', 'ticket');
  const next = t.flow('next', t.run).out;
  assert.match(next, /references\/commit-msg\.md/);
  assert.match(next, /BUILT --message '<that line>'/);
  assert.match(next, /BUILT -> BUILD .*\(blocked\)/, 'nothing built yet');

  for (const bad of [[], ['--message', 'Ticket 01: FIRST'], ['--message', 'feat: no ticket id'], ['--message', `feat(ABC-1): ${'x'.repeat(70)}`]]) {
    const r = build(t, bad);
    assert.match(r.out, /BUILT makes a commit: pass --message .*type\(TICKET\): summary.*nothing was sent/, bad.join(' '));
    assert.equal(t.st().state, 'BUILD');
    assert.equal(t.st().ticket, '01');
  }
  assert.equal(t.commits(), '1', 'nothing committed by a refused BUILT');

  assert.ok(build(t, ['--message', 'feat(ABC-1): add the first thing']).ok);
  assert.equal(t.st().ticket, '03');
  assert.equal(t.git('log', '-1', '--format=%s').stdout.trim(), 'feat(ABC-1): add the first thing');
});

test('gate end, commit ticket: a ticket that needs no change goes through with --unchanged and no message; the instructions cover it and a failing git hook', () => {
  const t = make();
  t.init('--gate', 'end', '--commit', 'ticket');
  const next = t.flow('next', t.run).out;
  assert.match(next, /When BUILT fails with nothing to commit/);
  assert.match(next, /BUILT --unchanged '<why, in one line>'/);
  assert.match(next, /When BUILT fails inside a git hook/);
  assert.match(next, /Never bypass\s+a hook: no --no-verify/);
  t.put('build/01/IMPL.md', IMPL());
  t.put('build/01/VERIFY.md', PASS);
  assert.match(t.send('BUILT', ...MESSAGE).out, /nothing to commit .* --unchanged '<why>'/s);
  assert.equal(t.st().ticket, '01');
  const r = t.send('BUILT', '--unchanged', 'the export already exists');
  assert.ok(r.ok, r.out);
  assert.equal(t.st().ticket, '03');
  assert.equal(t.commits(), '1');
  assert.match(t.flow('status', t.run).out, /01 FIRST · no change: the export already exists/);

  // A failing pre-commit hook stops BUILT and shows its output; the same BUILT goes through once it passes.
  const hook = `${t.repo}/.git/hooks/pre-commit`;
  fs.writeFileSync(hook, '#!/bin/sh\necho "lint: 3 errors" >&2\nexit 1\n', { mode: 0o755 });
  const blocked = build(t);
  assert.ok(!blocked.ok);
  assert.match(blocked.out, /lint: 3 errors/);
  assert.equal(t.st().ticket, '03');
  fs.rmSync(hook);
  assert.ok(t.send('BUILT', ...MESSAGE).ok);
  assert.equal(t.st().ticket, '02');

  const repairing = make({ tickets: ONE });
  walkTo(repairing, 'REPAIR', [built('01'), [[], 'REJECT']], ['--gate', 'end', '--commit', 'ticket']);
  assert.match(repairing.flow('next', repairing.run).out, /When REPAIRED fails inside a git hook/);
});

test('the TICKET of a commit message: the run\'s ticket id when the human gave one, else a word per ticket from its own file', () => {
  const scoped = make();
  assert.ok(scoped.create('--gate', 'end', '--commit', 'ticket').ok);
  assert.ok(scoped.ready(scoped.repo, 'main', '--scope', 'ABC-1').ok);
  assert.match(scoped.flow('next', scoped.run).out, /Its TICKET is ABC-1, the scope set for this run: use it as it is/);
  for (const other of ['feat(XYZ-9): add the first thing', 'feat(ABC-12): add the first thing'])
    assert.match(build(scoped, ['--message', other]).out, /must carry this run's scope, type\(ABC-1\): summary; nothing was sent/, other);
  assert.ok(build(scoped, ['--message', 'feat(ABC-1): add the first thing']).ok);

  const none = make();
  assert.ok(none.init('--gate', 'end', '--commit', 'ticket').ok);
  assert.equal(none.st().scope, null);
  const first = none.flow('next', none.run).out;
  assert.match(first, /no ticket id, so its TICKET is one lowercase word .* for the area of ticket 01, taken from what input\/tickets\/\S+ says it builds/s);
  assert.match(first, /Decide it for this commit alone/);
  assert.ok(build(none, ['--message', 'feat(auth): add the first thing']).ok);
  assert.match(none.flow('next', none.run).out, /for the area of ticket 03, taken from what input\/tickets\/\S+ says it builds/s, 'decided again for the next ticket');
  assert.ok(build(none, ['--message', 'feat(billing): add the third thing']).ok, 'another ticket, another word');
  assert.equal(none.subject(), 'feat(billing): add the third thing');
});

test('the commit message shape is only asked of an unattended commit', () => {
  const ticketGate = make();
  ticketGate.init('--gate', 'ticket', '--commit', 'ticket');
  assert.doesNotMatch(ticketGate.flow('next', ticketGate.run).out, /commit-msg/);
  assert.ok(build(ticketGate, []).ok, 'BUILT goes to the gate and commits nothing');
  assert.equal(ticketGate.st().state, 'TICKET_GATE');

  const noCommit = make();
  noCommit.init('--gate', 'end', '--commit', 'none');
  assert.doesNotMatch(noCommit.flow('next', noCommit.run).out, /commit-msg/);
  assert.ok(build(noCommit, []).ok);
});

test('gate end, commit none: BUILT records each ticket as a patch and moves on; the last stops at BUILD_GATE', () => {
  const t = make();
  t.init('--gate', 'end', '--commit', 'none');
  for (const id of ['01', '03']) {
    assert.equal(t.st().ticket, id);
    assert.ok(build(t).ok);
    assert.equal(t.st().state, 'BUILD');
    assert.ok(t.has(`build/${id}/cumulative.patch`));
  }
  assert.ok(build(t).ok);
  assert.equal(t.st().state, 'BUILD_GATE');
  assert.equal(t.st().ticket, null);
  assert.match(t.read('build/02/cumulative.patch'), /\+ticket 02/);
  assert.equal(t.commits(), '1', 'nothing committed');
  assert.ok(t.send('APPROVE', '--note', 'focus on error handling').ok);
  assert.match(t.read('review/BRIEF.md'), /focus on error handling/);
  assert.match(t.flow('next', t.run).out, /for the whole build/, 'the first review');
  t.put('review/REVIEW.md');
  assert.match(t.send('REVIEWED').out, /missing or empty: REPORT.md/);
  t.put('REPORT.md');
  assert.ok(t.send('REVIEWED').ok);
  assert.equal(t.st().state, 'REVIEW_GATE');
  assert.ok(t.send('APPROVE', '--note', 'ship it').ok);
  assert.equal(t.st().state, 'DONE');
});

test('a run starts in WORKSPACE, whose instructions carry the send line; nothing is built before it', () => {
  const t = make();
  assert.ok(t.create('--gate', 'end').ok);
  assert.equal(t.st().state, 'WORKSPACE');
  const next = t.flow('next', t.run).out;
  assert.match(next, /worktree add -b <branch> <path> <source>/);
  assert.match(next, /build-flow send <run> WORKSPACE_READY --at WORKSPACE --target <path> --branch <branch> --source <source> --scope <scope>/);
  assert.match(next, /ask, once, for the ticket id/);
  assert.match(next, /Say in the question itself what happens\s+without one/);
  assert.match(next, /decided per ticket from that\s+ticket's file in input\/tickets/);
  assert.match(next, /omit --scope when they gave no ticket id/);
  assert.doesNotMatch(next, /Commit the approved ticket/);
  assert.match(t.send('BUILT').out, /BUILT is not allowed in WORKSPACE/);
  assert.ok(t.ready().ok);
  assert.match(t.flow('next', t.run).out, /Ticket 01: FIRST/);
});

test('--worktree auto: the run starts in WORKTREE, the agents\' state; the agent makes the worktree, installs, and sends WORKSPACE_AUTO with no gate flags', () => {
  const t = make();
  assert.ok(t.create('--gate', 'end', '--worktree', 'auto', '--scope', 'ABC-1').ok);
  assert.equal(t.st().state, 'WORKTREE');
  assert.equal(def.states.WORKTREE.actor, 'agents', 'so the Stop hook keeps a --gate end run going through it');
  assert.match(t.flow('status', t.run).out, /Target: {2}\(chosen in WORKTREE\)/);
  const next = t.flow('next', t.run).out;
  assert.doesNotMatch(next, /WORKSPACE_READY/, 'the human gate is not offered here');
  assert.doesNotMatch(next, /ask, once, for the ticket id/);
  assert.match(next, /The run's ticket id is ABC-1, given at init/);
  assert.match(next, /for-each-ref --sort=-committerdate/, 'the branch follows the repo\'s own names');
  assert.match(next, /Path: \S+repo-<the branch, each \/ replaced by ->/, 'the path is derived from --repo');
  assert.match(next, /run npm i in it/);
  assert.match(next, /no \.env or other local config/);
  assert.match(next, /never stash, delete, commit or ignore it,\s+and never edit \.gitignore/, 'a dirty tree is not cleaned up');
  assert.match(next, /the tree isn't clean after it, or\s+the engine refuses WORKSPACE_AUTO, don't work around it/, 'an engine refusal is a failure too');
  assert.match(next, /build-flow send \S+ WORKSPACE_AUTO --target <path> --branch <branch> --source <source>\n/);
  assert.match(next, /WORKSPACE_AUTO -> BUILD \(ready\)/);
  assert.doesNotMatch(next, /WORKSPACE_AUTO -> BUILD \[human gate/);

  const wt = `${t.repo}-feature-ABC-1-thing`;
  t.git('worktree', 'add', '-q', '-b', 'feature/ABC-1-thing', wt, 'main');
  const r = t.flow('send', t.run, 'WORKSPACE_AUTO', '--target', wt, '--branch', 'feature/ABC-1-thing', '--source', 'main');
  assert.ok(r.ok, r.out);
  assert.equal(t.st().state, 'BUILD');
  assert.equal(t.st().scope, 'ABC-1');
  assert.match(r.out, /Its TICKET is ABC-1/);

  const ask = make();
  assert.ok(ask.create('--gate', 'end', '--worktree', 'ask', '--scope', 'ABC-1').ok);
  const asked = ask.flow('next', ask.run).out;
  assert.doesNotMatch(asked, /ask, once, for the ticket id/, 'a scope given at init is not asked again');
  assert.doesNotMatch(asked, /--scope <scope>/);
  assert.equal(ask.st().state, 'WORKSPACE');
  assert.doesNotMatch(asked, /WORKSPACE_AUTO|could not be created/, 'an ask run never sees the agent\'s event');
  assert.match(ask.flow('send', ask.run, 'WORKSPACE_AUTO', '--target', ask.repo, '--branch', 'main').out, /WORKSPACE_AUTO is not allowed in WORKSPACE/);
});

test('--worktree auto: when the worktree can\'t be made, WORKTREE_FAILED hands the workspace to the human with ESCALATION.md', () => {
  const t = make();
  assert.ok(t.create('--gate', 'end', '--worktree', 'auto', '--scope', 'ABC-1').ok);
  const first = t.flow('next', t.run).out;
  assert.match(first, /write ESCALATION\.md\s+with the command that failed, its error and what you removed/);
  assert.match(first, /build-flow send \S+ WORKTREE_FAILED\n/);
  assert.match(t.flow('send', t.run, 'WORKTREE_FAILED').out, /WORKTREE_FAILED blocked:\s+missing or empty: ESCALATION\.md/);
  assert.equal(t.st().state, 'WORKTREE');
  t.put('ESCALATION.md', 'npm i failed: ERESOLVE\n');
  const r = t.flow('send', t.run, 'WORKTREE_FAILED');
  assert.ok(r.ok, r.out);
  assert.equal(t.st().state, 'WORKSPACE');
  assert.match(r.out, /could not be created\. Present ESCALATION\.md first/);
  assert.match(r.out, /The run's ticket id is ABC-1, given at init/, 'the scope from init stands');
  assert.match(r.out, /WORKSPACE_READY -> BUILD \[human gate: --at WORKSPACE and --note required\]/);
  assert.match(t.flow('send', t.run, 'WORKSPACE_AUTO', '--target', t.repo, '--branch', 'main').out, /WORKSPACE_AUTO is not allowed in WORKSPACE/);
  assert.ok(t.ready().ok, 'the human may pick the repo itself');
  assert.equal(t.st().state, 'BUILD');
  assert.equal(t.st().scope, 'ABC-1');
});

test('REJECT at TICKET_GATE sends the same ticket back to BUILD, where IMPL.md and VERIFY.md must be rewritten', () => {
  const t = make();
  walkTo(t, 'TICKET_GATE', STEPS, ['--gate', 'ticket']);
  assert.ok(t.send('REJECT', '--note', 'rename the button').ok);
  assert.equal(t.st().state, 'BUILD');
  assert.equal(t.st().ticket, '01');
  assert.match(t.flow('next', t.run).out, /Entered via REJECT — "rename the button"/);
  assert.match(t.send('BUILT').out, /not updated since entering BUILD: build\/01\/IMPL.md/);
  assert.ok(build(t).ok);
  assert.equal(t.st().state, 'TICKET_GATE');
});

test('BUILT is refused until IMPL.md has a non-empty "## Build so far", without using a RETRY', () => {
  const t = make();
  t.init('--gate', 'ticket');
  t.edit(`ticket 01 ${Math.random()}\n`);
  t.put('build/01/VERIFY.md', PASS);
  t.put('build/01/IMPL.md', '## Summary\n\nx\n');
  assert.match(t.send('BUILT').out, /build\/01\/IMPL.md has no "## Build so far" section/);
  t.put('build/01/IMPL.md', '## Summary\n\nx\n\n## Build so far\n\n\n## Passes\n\ny\n');
  assert.match(t.send('BUILT').out, /build\/01\/IMPL.md: "## Build so far" is empty/);
  assert.equal(t.st().state, 'BUILD');
  assert.match(t.flow('next', t.run).out, /RETRY \(3 of 3 left this pass\)/);
  t.put('build/01/IMPL.md', '## Summary\n\nx\n\n## Build so far\n\n### What exists\n\n- src/a.ts\n');
  assert.ok(t.send('BUILT').ok, 'subsections count as content');
  assert.equal(t.st().state, 'TICKET_GATE');
});

test('gate ticket, commit ticket: after a ticket APPROVE, the next state starts by suggesting the approved ticket\'s commit message', () => {
  const t = make();
  assert.ok(t.init('--gate', 'ticket', '--commit', 'ticket').ok);
  assert.doesNotMatch(t.flow('next', t.run).out, /Commit the approved ticket/, 'none on the first BUILD');
  assert.ok(build(t).ok);
  assert.ok(t.send('REJECT', '--note', 'again').ok);
  assert.doesNotMatch(t.flow('next', t.run).out, /Commit the approved ticket/, 'none after a REJECT');
  assert.ok(build(t).ok);
  assert.ok(t.send('APPROVE', '--note', 'ok').ok);
  const next = t.flow('next', t.run).out;
  assert.match(next, /Entered via APPROVE/);
  assert.match(next, /suggest the commit message for ticket 01 FIRST/);
  assert.match(next, /references\/commit-msg\.md/);
  assert.match(next, /! git -C \S+ add -A && git -C \S+ commit -m "<message>"/);
  t.git('commit', '-qam', 'feat(app): first');
  assert.ok(build(t).ok);
  assert.ok(t.send('APPROVE', '--note', 'ok').ok);
  assert.ok(build(t).ok);
  assert.ok(t.send('APPROVE', '--note', 'ok').ok);
  assert.equal(t.st().state, 'BUILD_GATE');
  assert.match(t.flow('next', t.run).out, /suggest the commit message for ticket 02 SECOND/, 'the last ticket gets one too');
  assert.match(t.read('build/02/cumulative.patch'), /\+ticket 02/);

  assert.doesNotMatch(t.flow('next', t.run).out, /Nothing was committed in this run/, 'the final message is for commit mode none');
});

test('commit none: no commit step after a ticket; BUILD_GATE proposes one commit message for the whole build', () => {
  for (const gateMode of ['ticket', 'end']) {
    const t = make();
    assert.ok(t.init('--gate', gateMode, '--commit', 'none').ok);
    for (let i = 0; i < 3; i++) {
      assert.ok(build(t, []).ok);
      if (gateMode === 'ticket') assert.ok(t.send('APPROVE', '--note', 'ok').ok);
      assert.doesNotMatch(t.flow('next', t.run).out, /Commit the approved ticket/, `${gateMode}: no commit step`);
    }
    assert.equal(t.st().state, 'BUILD_GATE');
    assert.equal(t.commits(), '1', 'nothing committed');
    const next = t.flow('next', t.run).out;
    assert.match(next, /Nothing was committed in this run.*one commit message for the whole build/s, gateMode);
    assert.match(next, /references\/commit-msg\.md/);
    assert.match(next, /! git -C \S+ add -A && git -C \S+ commit -m "<message>"/);
  }

  const u = make();
  walkTo(u, 'BUILD_GATE', STEPS, ['--gate', 'end', '--commit', 'ticket']);
  const next = u.flow('next', u.run).out;
  assert.doesNotMatch(next, /Commit the approved ticket|Nothing was committed in this run/, 'gate end, commit ticket: the engine committed each ticket');
  assert.equal(u.commits(), '4');
});

test('RETRY: 3 failed verifications per pass, then only STUCK; CONTINUE resumes the same ticket in a new pass', () => {
  const t = make();
  assert.ok(t.init('--gate', 'end').ok);
  const fail = () => t.put('build/01/VERIFY.md', `Verdict: FAIL\n\n${Math.random()}\n`);
  t.put('build/01/VERIFY.md', PASS);
  assert.match(t.send('RETRY').out, /must say "Verdict: FAIL"/, 'a passing verification is not retried');
  for (let i = 1; i <= 3; i++) {
    fail();
    assert.ok(t.send('RETRY').ok, `retry ${i}`);
  }
  fail();
  assert.match(t.flow('next', t.run).out, /RETRY -> BUILD \(blocked\)\n\s+used 3 of 3 times this pass: write ESCALATION.md and send STUCK/);
  assert.match(t.send('STUCK').out, /missing or empty: ESCALATION.md/);
  t.put('ESCALATION.md', 'flaky test');
  assert.ok(t.send('STUCK').ok);
  assert.equal(t.st().state, 'ESCALATED');
  assert.match(t.flow('next', t.run).out, /returns to BUILD/);
  assert.ok(t.send('CONTINUE', '--note', 'mock the service').ok);
  assert.equal(t.st().state, 'BUILD');
  assert.equal(t.st().ticket, '01');
  fail();
  assert.ok(t.send('RETRY').ok, 'a new pass');
  assert.match(t.flow('next', t.run).out, /2 of 3 left this pass/);
});

test('BUILD escalations: GUARDRAIL_HIT goes to ESCALATED, ACCEPT is refused there, CONTINUE resumes the ticket', () => {
  const t = make();
  t.init('--gate', 'end');
  assert.match(t.send('GUARDRAIL_HIT').out, /missing or empty: ESCALATION.md/);
  t.put('ESCALATION.md', 'needs the API key in .env at src/client.ts:12');
  assert.ok(t.send('GUARDRAIL_HIT').ok);
  const r = t.send('ACCEPT', '--note', 'fine');
  assert.ok(!r.ok);
  assert.match(r.out, /refused: a BUILD escalation has tickets left to build/);
  assert.ok(t.send('CONTINUE', '--note', 'key is set, read it from process.env').ok);
  assert.equal(t.st().state, 'BUILD');
  assert.equal(t.st().ticket, '01');
});

test('REJECT at BUILD_GATE: the repair returns to BUILD_GATE without using a repair round, so the human still briefs the review', () => {
  const t = make({ tickets: ONE });
  walkTo(t, 'BUILD_GATE', STEPS_ONE);
  assert.ok(t.send('REJECT', '--note', 'missing empty state').ok);
  assert.equal(t.st().state, 'REPAIR');
  assert.match(t.flow('next', t.run).out, /goes to BUILD_GATE \(no review has run yet\)/);
  assert.ok(repair(t).ok);
  assert.equal(t.st().state, 'BUILD_GATE');
  assert.ok(t.has('review/repair-1.patch'), 'the fix is recorded');
  assert.ok(t.send('APPROVE', '--note', 'check the empty state').ok);
  assert.match(t.read('review/BRIEF.md'), /check the empty state/);
  assert.equal(t.st().state, 'REVIEW');
  assert.ok(review(t).ok);
  assert.match(t.flow('next', t.run).out, /\(5 repair round\(s\) left\)/, 'all rounds still available');
});

test('review rounds: REJECT at REVIEW_GATE goes REPAIR → REVIEW → REVIEW_GATE, five times, then is refused', () => {
  const t = make({ tickets: ONE });
  walkTo(t, 'REVIEW_GATE', STEPS_ONE);
  assert.match(t.flow('next', t.run).out, /findings as a list under their ids \(R1-F1/);
  for (let i = 1; i <= 5; i++) {
    assert.match(t.flow('next', t.run).out, new RegExp(`\\(${6 - i} repair round\\(s\\) left\\)`));
    assert.ok(t.send('REJECT', '--note', `fix F1, round ${i}`).ok);
    assert.equal(t.st().state, 'REPAIR');
    assert.match(t.flow('next', t.run).out, /goes to REVIEW\./);
    assert.ok(repair(t).ok);
    assert.equal(t.st().state, 'REVIEW');
    const next = t.flow('next', t.run).out;
    assert.match(next, new RegExp(`for repair ${i} only`), 'a re-review checks the repair');
    assert.match(next, new RegExp(`review/repair-${i}\\.patch`));
    assert.ok(review(t, `F1 CRITICAL ...\nround ${i}\n`).ok, `round ${i}`);
    assert.equal(t.st().state, 'REVIEW_GATE');
  }
  for (let i = 1; i <= 6; i++) {
    assert.ok(t.has(`review/REVIEW-${i}.md`), `round ${i} kept`);
    assert.ok(t.has(`REPORT-${i}.md`), `report of round ${i} kept`);
  }
  assert.match(t.read('review/REVIEW-6.md'), /round 5/);
  const r = t.send('REJECT', '--note', 'once more');
  assert.ok(!r.ok);
  assert.match(r.out, /used 5 of 5 times: APPROVE the build as it stands/);
  assert.equal(t.st().state, 'REVIEW_GATE');
  assert.ok(t.send('APPROVE', '--note', 'as it stands').ok);
  assert.equal(t.st().state, 'DONE');
});

test('gate end, commit ticket: REPAIRED commits the repair itself, so it needs a --message shaped as references/commit-msg.md asks', () => {
  const t = make({ tickets: ONE });
  walkTo(t, 'REVIEW_GATE', STEPS_ONE, ['--gate', 'end', '--commit', 'ticket']);
  assert.equal(t.commits(), '2');
  const atRepair = t.send('REJECT', '--note', 'fix F1');
  assert.ok(atRepair.ok);
  assert.match(atRepair.out, /references\/commit-msg\.md.*REPAIRED --message '<that line>'/s);
  for (const bad of [[], ['--message', 'Repair 1: review findings']]) {
    assert.match(repair(t, bad).out, /REPAIRED makes a commit: pass --message .*nothing was sent/, bad.join(' '));
    assert.equal(t.st().state, 'REPAIR');
  }
  assert.equal(t.commits(), '2', 'nothing committed by a refused REPAIRED');
  assert.ok(repair(t, ['--message', 'fix(ABC-1): handle the empty list']).ok);
  assert.equal(t.commits(), '3', 'committed on REPAIRED');
  assert.equal(t.subject(), 'fix(ABC-1): handle the empty list');
  assert.ok(review(t, 'clean\n').ok);
  assert.doesNotMatch(t.flow('next', t.run).out, /is verified and uncommitted/, 'nothing left for the human to commit');
  assert.ok(t.send('APPROVE', '--note', 'ship it').ok);
  assert.equal(t.commits(), '3', 'the gate commits nothing');
});

test('gate ticket, commit ticket: a repair is the human\'s to commit; the gate after it suggests the message', () => {
  const t = make({ tickets: ONE });
  walkTo(t, 'BUILD_GATE', STEPS_ONE, ['--gate', 'ticket', '--commit', 'ticket']);
  assert.doesNotMatch(t.flow('next', t.run).out, /is verified and uncommitted/, 'no repair yet');

  // A repair before the review comes back to BUILD_GATE.
  assert.match(t.send('REJECT', '--note', 'rename it').out, /Nothing is committed: the next gate suggests its commit message/);
  const atBuildGate = repair(t, []);
  assert.ok(atBuildGate.ok, 'no --message needed: the engine commits nothing');
  assert.match(atBuildGate.out, /Repair 1 is verified and uncommitted.*references\/commit-msg\.md.*! git -C \S+ add -A && git -C \S+ commit -m "<message>"/s);

  // The first review checked no repair; the review after a repair did.
  assert.ok(t.send('APPROVE', '--note', 'review it').ok);
  assert.doesNotMatch(review(t).out, /is verified and uncommitted/, 'the first review');
  assert.ok(t.send('REJECT', '--note', 'fix F1').ok);
  assert.ok(repair(t, []).ok);
  assert.match(review(t, 'clean\n').out, /Repair 2 is verified and uncommitted/);
  assert.ok(t.send('APPROVE', '--message', 'fix: F1', '--note', 'ship it').ok);
  assert.equal(t.st().state, 'DONE');
  assert.equal(t.commits(), '1', 'the engine committed nothing in the whole run');
});

test('commit none: a repair needs no --message and nothing is committed or suggested for it', () => {
  const t = make({ tickets: ONE });
  walkTo(t, 'BUILD_GATE', STEPS_ONE, ['--gate', 'end', '--commit', 'none']);
  assert.match(t.send('REJECT', '--note', 'rename it').out, /Nothing is committed\.\n/);
  const r = repair(t, []);
  assert.ok(r.ok);
  assert.doesNotMatch(r.out, /is verified and uncommitted/);
  assert.equal(t.commits(), '1');
});

test('ACCEPT at a REPAIR escalation: before a review back to BUILD_GATE; after one to REVIEW_GATE with REPORT.md', () => {
  const t = make({ tickets: ONE });
  walkTo(t, 'BUILD_GATE', STEPS_ONE);
  t.send('REJECT', '--note', 'add the API key');
  t.put('ESCALATION.md', 'needs a secret in .env');
  assert.ok(t.send('GUARDRAIL_HIT').ok);
  assert.match(t.flow('next', t.run).out, /ACCEPT -> BUILD_GATE/);
  assert.ok(t.send('ACCEPT', '--note', 'I will set the key myself').ok);
  assert.equal(t.st().state, 'BUILD_GATE');

  t.send('APPROVE', '--note', 'review it');
  assert.ok(review(t, 'F1 CRITICAL: hardcoded token\n').ok);
  assert.ok(t.send('REJECT', '--note', 'fix F1').ok);
  t.put('ESCALATION.md', 'the fix needs the real token in .env');
  assert.ok(t.send('GUARDRAIL_HIT').ok);
  assert.match(t.flow('next', t.run).out, /ACCEPT -> REVIEW_GATE/);
  assert.ok(t.send('ACCEPT', '--note', 'I will move it to .env myself').ok);
  assert.equal(t.st().state, 'REVIEW_GATE');
  assert.ok(t.send('APPROVE', '--note', 'ship it').ok);
  assert.equal(t.st().state, 'DONE');
});

test('BUILD fills its instructions with the current ticket, its blockers and the reports to seed it with', () => {
  const t = make();
  t.init('--gate', 'end');
  assert.match(t.flow('next', t.run).out, /the reports none yet:/, 'the first ticket has no reports to read');
  assert.ok(build(t).ok);
  const out = t.flow('next', t.run).out;
  assert.match(out, /Ticket: 03 Third \(2 of 3\)/);
  assert.match(out, /input\/tickets\/03-THIRD.md/);
  assert.match(out, /blocked by \(01 FIRST\)/);
  assert.match(out, /the reports build\/01\/IMPL.md:/, 'the last ticket built is also the blocker: listed once');
  assert.match(out, /re-run the two commands the implementer named/);
  assert.match(out, /RETRY \(3 of 3 left this pass\)/);
  assert.doesNotMatch(out, /\{[\w.]+\}/, 'no unfilled placeholder');
});

test('a fresh implementer reads the last ticket built and its blockers, not every report', () => {
  const t = make({ tickets: { '01-A.md': ticket('None'), '02-B.md': ticket('None'), '03-C.md': ticket('- 01'), '04-D.md': ticket('None') } });
  t.init('--gate', 'end');
  assert.ok(build(t).ok);
  assert.ok(build(t).ok);
  assert.match(t.flow('next', t.run).out, /the reports build\/02\/IMPL.md, build\/01\/IMPL.md:/);
  assert.ok(build(t).ok);
  assert.match(t.flow('next', t.run).out, /the reports build\/03\/IMPL.md:/);
});

test('DECISIONS.md is seeded by init and collects the REJECT and CONTINUE notes with their ticket', () => {
  const t = make();
  assert.ok(t.init('--gate', 'ticket').ok);
  assert.match(t.read('DECISIONS.md'), /^# Decisions/);
  assert.match(t.flow('status', t.run).out, /- \[x\] DECISIONS\.md/);
  assert.ok(build(t).ok);
  assert.ok(t.send('REJECT', '--note', 'countries come from config').ok);
  assert.match(t.read('DECISIONS.md'), /\n## \S+ REJECT at TICKET_GATE, ticket 01\n\ncountries come from config\n/);
  t.put('ESCALATION.md', 'x');
  assert.ok(t.send('GUARDRAIL_HIT').ok);
  assert.ok(t.send('CONTINUE', '--note', 'go ahead').ok);
  assert.match(t.read('DECISIONS.md'), /CONTINUE at ESCALATED, ticket 01\n\ngo ahead/);
  assert.ok(build(t).ok);
  assert.ok(t.send('APPROVE', '--note', 'ok').ok);
  assert.doesNotMatch(t.read('DECISIONS.md'), /\bok\b/, 'approvals are not decisions');
});
