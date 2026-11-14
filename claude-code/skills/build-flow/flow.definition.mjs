// Format: see README.md, "Definition format". States run in the order written: '@next' / '@prev' point at the neighbour.
import { gate, link } from './steps.mjs';

const DECISIONS = 'DECISIONS.md';
const ESCALATION = 'ESCALATION.md';
const REPORT = 'REPORT.md';
const BUILD_SO_FAR = 'Build so far';
const GUARDRAIL = `secrets: .env files or any other file holding secret values, or a key, token, password, private
key or credentialed connection string written into code, config, tests or reports`;
// Where an accepted ticket's patch goes in commit mode none.
const TICKET_PATCH = 'build/{ticket}/cumulative.patch';

const DECISIONS_HEADER = `# Decisions

The human's decisions for this run: they override or extend the SPEC and the tickets, and win over both.
Standing rules apply to every brief; the log below them is newest last. The engine appends each REJECT and CONTINUE
note; the orchestrator adds the human's answers and their own edits.

## Standing rules

<!-- One line per rule the human set for all later work (commands, conventions, waived failures, files to leave alone),
with the log entry it came from. Briefs point here instead of restating them. -->

## Log

`;

// First step of the state a ticket APPROVE leads to: the human commits the approved ticket before the next work starts.
// Only when the state was entered via APPROVE (so with a gate per ticket) in commit mode ticket; otherwise the
// instructions start at step 1. The commit modes: ticket commits every ticket, by the human's hand after each APPROVE
// or, with no gate per ticket, by the engine on BUILT; none commits nothing and proposes one message at BUILD_GATE.
// The TICKET of a commit message, type(TICKET): summary. Init takes the human's ticket id, the run's scope (required
// with --worktree auto), or WORKSPACE asks for it once, and every message carries it. With none, each message takes one word for the area of what it commits, decided
// per commit from `area` (for a ticket, its own ticket file), never one word for the whole run.
const scopeRule = (v, area) =>
  v.scope
    ? ` Its TICKET is {scope}, the scope set for this run: use it as it is, whatever the branch name or the latest
commits say.`
    : ` This run has no ticket id, so its TICKET is one lowercase word (such as auth) for the area of ${area}, whatever the
branch name or the latest commits say. Decide it for this commit alone: another commit of the run may take another word.`;
// WORKSPACE. With --worktree auto, init requires the ticket id (--scope); with --worktree ask, it is asked here once
// unless init was given it.
const ASK_SCOPE = `Then ask, once, for the ticket id this work belongs to in their tracker (such as ABC-123): it becomes the TICKET of every
commit message in the run, type(TICKET): summary, and nothing asks for it again. Say in the question itself what happens
without one: each commit then takes one lowercase word for the area of what it commits, decided per ticket from that
ticket's file in input/tickets, so the commits of one run can differ. Their id is the run's scope; pick no word now.`;
const SCOPE_GIVEN = `The run's ticket id is {scope}, given at init: it is the TICKET of every commit message in the run. Don't ask for it.`;
const WORKSPACE_RECORDS = `It records the branch, the source and the scope, and takes HEAD as the base every diff is measured from. The build
never switches branches after this, and with a scope a commit the engine makes is refused under any other.`;

// WORKSPACE, where a --worktree ask run starts and an auto run falls back: the human picks a new worktree or a branch
// of the repo, and accepts the event in a permission prompt.
const workspaceAsk = (v) => `Choose where the build happens, starting from the repo {repo}. Ask the human whether to create a new workspace,
a git worktree, for it.
- Yes: ask for its path, the source to start from (a branch or commit) and the new branch name. Run
  git -C {repo} worktree add -b <branch> <path> <source>, then git -C <path> status -sb to show it. A new worktree has none
  of the repo's untracked files: ask whether to install dependencies or copy local config (such as .env) into it, and do it
  if they say so; the test and check runners need them.
- No: run git -C {repo} status -sb, show the current branch and any uncommitted changes, and ask the human to confirm it is
  the branch to build on. If they name another, switch with git -C {repo} switch <branch> only when the working tree is
  clean; otherwise let them sort it out.
${v.scope ? SCOPE_GIVEN : ASK_SCOPE}
Once the human confirms, send it yourself, filled in (--source is required for a new worktree; for the repo itself, omit
it${v.scope ? '' : '; omit --scope when they gave no ticket id'}); the human accepts it in a permission prompt:
build-flow send <run> WORKSPACE_READY --at WORKSPACE --target <path> --branch <branch> --source <source>${v.scope ? '' : ' --scope <scope>'} --note '<their words>'
The engine checks that the target is {repo} or one of its worktrees, on that branch, outside the run folder, clean
when the commit mode is ticket ({commit} here), and, with --source, still at the source's commit. ${WORKSPACE_RECORDS}`;

// WORKSPACE entered because the agent couldn't make the worktree of a --worktree auto run: the human reads why first.
const WORKTREE_FAILED = `The worktree of this --worktree auto run could not be created. Present ESCALATION.md first: what failed, its error and
what was removed. The human now picks the workspace instead.

`;

// WORKTREE, where a --worktree auto run starts: the agent makes the worktree itself and sends the event with no prompt,
// so the run goes on alone.
const workspaceAuto = () => `Create the build's workspace yourself, a new git worktree of the repo {repo}, without asking the human anything: from
here the run goes on alone until its next human gate. The run's ticket id is {scope}, given at init.
1. Source: the branch the repo is on (git -C {repo} branch --show-current), or its HEAD commit when it is detached.
2. Branch: name it the way this repo names its branches. List the recent ones with
   git -C {repo} for-each-ref --sort=-committerdate --count=30 --format='%(refname:short)' refs/heads refs/remotes
   and follow the convention most of them share: the prefix (such as feature/ or feat/), where and how a ticket id
   appears, case and separators. Fill it with the ticket id {scope} and a short kebab-case summary of the title of
   input/SPEC.md. With no convention to follow, use feature/{scope}-<summary>. It must not exist yet:
   git -C {repo} rev-parse --verify -q refs/heads/<branch> must fail.
3. Path: {repo}-<the branch, each / replaced by ->, beside the repo. It must not exist yet.
4. Run git -C {repo} worktree add -b <branch> <path> <source>. A new worktree has none of the repo's untracked files:
   when it has a package.json, run npm i in it; when that changes a tracked file (package-lock.json), restore it with
   git -C <path> checkout -- <file>. Copy nothing else into it: no .env or other local config. Then run
   git -C <path> status -sb: the tree must be clean. Something the install left untracked (such as node_modules, when
   .gitignore doesn't list it) is a failure below, not something to clean up: never stash, delete, commit or ignore it,
   and never edit .gitignore.
5. Send it yourself: it is not a human gate, so it takes no --at, no --note and no permission prompt:
build-flow send {run} WORKSPACE_AUTO --target <path> --branch <branch> --source <source>
The engine checks that the target is a new worktree of {repo}, not the repo itself, on that branch, outside the run
folder, clean when the commit mode is ticket ({commit} here), and still at the source's commit. ${WORKSPACE_RECORDS}
When a name is taken, derive another. When the worktree can't be made, npm i fails, the tree isn't clean after it, or
the engine refuses WORKSPACE_AUTO, don't work around it (no stash, no edit to the worktree's files): remove what
you created (git -C {repo} worktree remove --force <path>, then git -C {repo} branch -D <branch>), write ESCALATION.md
with the command that failed, its error and what you removed, then send:
build-flow send {run} WORKTREE_FAILED
It hands the workspace to the human, who picks where to build instead.`;

const TICKET_AREA = (id, file) => `ticket ${id}, taken from what ${file} says it builds`;
const REPAIR_AREA = 'this repair, taken from the findings it fixed and the files it changed';

const commitStep = (v) => `0. Commit the approved ticket. Before anything else, suggest the commit message for ticket {approved}. Read
~/.claude/skills/build-flow/references/commit-msg.md and follow it on the target's current changes (it can't be invoked as a skill).${scopeRule(v, TICKET_AREA('{approved}', 'its file in input/tickets'))}
Then give the human, ready to paste:
! git -C {target} add -A && git -C {target} commit -m "<message>"
Wait until they have committed or said to skip it: the next work must not mix into that commit. Then run
build-flow drift {run}: anything it lists changed after verification, so it is the human's own edit; record it in
DECISIONS.md (file, what changed) and pass it to the implementer in its next brief.`;

const withCommitStep = (text) => (v) =>
  `${v.via === 'APPROVE' && v.commit === 'ticket' ? `${commitStep(v)}\n\n` : ''}${typeof text === 'function' ? text(v) : text}`;

// The commits BUILT and REPAIRED make when no human approves each ticket (gate end, commit mode ticket): the message
// follows references/commit-msg.md, and the engine refuses one of another shape.
const COMMIT_MESSAGE = {
  pattern: String.raw`^[a-z]+\([^()\s]+\): \S[^\n]*$`,
  max: 72,
  hint: 'one line shaped type(TICKET): summary, 72 characters at most, as ~/.claude/skills/build-flow/references/commit-msg.md describes',
};
// The engine's commit on BUILT finds no change in the target: the work is elsewhere, or the ticket needs none.
const NOTHING_TO_COMMIT = `When BUILT fails with nothing to commit, the target holds no change for this ticket. If the implementer reported
changed files, they went to another folder: send it back to redo them in {target}. If the ticket truly needs no change
(IMPL.md shows each acceptance criterion already met, with its file:line), send, in place of --message:
build-flow send {run} BUILT --unchanged '<why, in one line>'
The engine records the ticket with no commit, and the queue shows the reason at the build gate.`;
// The engine's commit runs the repo's git hooks (husky: pre-commit, commit-msg), and a hook that fails stops the event.
const hookFailed = (ev, sendTo) => `When ${ev} fails inside a git hook (pre-commit, commit-msg; the engine prints the hook's output), the hook is one more
check the work must pass: send its output to ${sendTo} and send ${ev} again; this is not a RETRY. A
hook that rejects only the message: rewrite the message so it satisfies both the hook and the shape above. Never bypass
a hook: no --no-verify, no edit to the hook or its config.`;
const ON_PASS = `On PASS, send BUILT: the ticket goes to the human's gate or, with no gate per ticket, the engine saves it as a patch
and moves on. Nothing is committed.`;
const onPassUnattendedCommit = (v) => `On PASS, write the ticket's commit message, then send BUILT with it: the engine commits the ticket on BUILT and no
human sees the message first. Read ~/.claude/skills/build-flow/references/commit-msg.md and follow it on the target's current changes
(git -C {target} status --short and git -C {target} diff --ignore-cr-at-eol; it can't be invoked as a skill) to get its one
line.${scopeRule(v, TICKET_AREA('{ticket}', '{ticketFile}'))} Then send:
build-flow send {run} BUILT --message '<that line>'
The engine refuses BUILT without a --message of that shape${v.scope ? ' and scope' : ''}.
${NOTHING_TO_COMMIT}
${hookFailed('BUILT', "this ticket's implementer, verify again (step 2)")} When the same hook failure returns after a fix, or its
cause is outside the code (a missing tool, the hook itself crashing), write ESCALATION.md and send STUCK.`;
// Repairs follow the tickets. With a gate per ticket in commit mode ticket the human commits each repair themselves:
// the gate after it suggests the message. With no gate per ticket the engine commits it on REPAIRED.
const humanCommitsRepair = (v) => v.commit === 'ticket' && v.gate === 'ticket';
const engineCommitsRepair = (v) => v.commit === 'ticket' && v.gate === 'end';
const repairCommitStep = (v) => `Repair {fixes} is verified and uncommitted, and committing it is the human's. With what you present, suggest its
commit message: read ~/.claude/skills/build-flow/references/commit-msg.md and follow it on the target's current changes (it can't be
invoked as a skill).${scopeRule(v, REPAIR_AREA)} Then give the human, ready to paste:
! git -C {target} add -A && git -C {target} commit -m "<message>"`;
const afterRepair = (v) => {
  if (engineCommitsRepair(v))
    return `Then write the repair's commit message: read ~/.claude/skills/build-flow/references/commit-msg.md and follow it on the target's current
changes (git -C {target} status --short and git -C {target} diff --ignore-cr-at-eol; it can't be invoked as a skill) to
get its one line.${scopeRule(v, REPAIR_AREA)} Then send:
build-flow send {run} REPAIRED --message '<that line>'
The engine commits the repair with it, and refuses REPAIRED without a --message of that shape${v.scope ? ' and scope' : ''}.
${hookFailed('REPAIRED', "this round's implementer, re-run both commands, rewrite review/REPAIR.md")}`;
  return humanCommitsRepair(v)
    ? 'Nothing is committed: the next gate suggests its commit message, for the human to commit it.'
    : 'Nothing is committed.';
};
// BUILD_GATE in commit mode none: nothing was committed along the way, so the human gets one message for the whole build.
const finalCommitMessage = (v) => `Nothing was committed in this run (commit mode none). Also propose one commit message for the whole build: read
~/.claude/skills/build-flow/references/commit-msg.md and follow it on everything since the base (git -C {target} add -A -N &&
git -C {target} diff {base}; it can't be invoked as a skill).${scopeRule(v, 'the whole build, taken from the tickets in input/tickets together')} Then give the human, ready to paste:
! git -C {target} add -A && git -C {target} commit -m "<message>"
Committing is theirs, whenever they choose; the verdict doesn't wait for it.`;
const onPass = (v) => (v.gate === 'end' && v.commit === 'ticket' ? onPassUnattendedCommit(v) : ON_PASS);

// REVIEW's brief: the first review covers the whole build, a review entered by a repair checks that repair only.
const FIRST_REVIEW = `Spawn one bf-independent-reviewer for the whole build. Brief it with paths, for it to read: input/SPEC.md; every
ticket in input/tickets; DECISIONS.md, saying it holds the human's decisions, which amend the SPEC and tickets: judge
conformance against the SPEC as amended, and report a departure that a decision covers as conforming, not as a finding;
and the human's review brief in review/BRIEF.md. The diff is "git add -A -N && git diff {base}" (two-dot) run in {target};
the work may be uncommitted. Pass nothing from build/ (implementer reports, verdicts): the review is clean-room.`;

const RE_REVIEW = `Spawn one bf-independent-reviewer for repair {fixes} only, not the whole build. Brief it with: the repair's diff,
review/repair-{fixes}.patch (what changed since the last review); the findings the human chose, quoted from their note in
DECISIONS.md, with each finding's text from REPORT.md; and the path DECISIONS.md, which amends the SPEC and tickets. Ask it
to check that each chosen finding is fixed and that the repair adds no new problem, citing file:line in the target {target}.
Pass nothing from build/ and nothing from earlier reviews but the chosen findings.
review/REVIEW.md still holds round {reviews}, which the engine kept as its own numbered copy: delete it first (rm), so
the reviewer writes a new file.`;

// Where a ticket goes once recorded: the next one, or the gate on the whole build after the last.
// `how` is the effect that records it: 'accept' on BUILT (the engine commits in commit mode ticket), 'acceptPatch' on
// the human's APPROVE (a patch in every mode: the human commits the ticket themselves).
const afterTicket = (how) => [
  { when: { more: true }, [how]: TICKET_PATCH, target: 'BUILD' },
  { [how]: TICKET_PATCH, target: 'BUILD_GATE' },
];

export default link({
  id: 'build-flow',
  // --worktree auto starts where the agent makes the worktree; ask, and a run created before the option, where the
  // human picks the workspace.
  initial: [{ when: { worktree: 'auto' }, target: 'WORKTREE' }, { target: 'WORKSPACE' }],

  // Folders init creates in the run folder; the engine adds input/ (the SPEC and tickets) and handoffs/ itself.
  // Seeds are files init writes.
  dirs: ['build', 'review'],
  seed: { [DECISIONS]: DECISIONS_HEADER },

  // What a resuming orchestrator reads after the newest handoff, in order; status lists the ones that exist.
  resume: ['input/SPEC.md'],
  // Each ticket's report; {seedReports} lists it for the last ticket recorded and the current ticket's blockers.
  report: 'build/{ticket}/IMPL.md',

  artifacts: [
    'input/SPEC.md',
    'input/tickets',
    DECISIONS,
    'build/{ticket}/IMPL.md',
    'build/{ticket}/VERIFY.md',
    'review/BRIEF.md',
    'review/REVIEW.md',
    'review/REPAIR.md',
    ESCALATION,
    REPORT,
  ],

  states: {
    // Only a --worktree auto run starts here. It is the agents' state, so the Stop hook keeps a --gate end run going
    // through it; when the worktree can't be made, the run moves to the human's state below.
    WORKTREE: {
      actor: 'agents',
      do: workspaceAuto,
      on: {
        WORKSPACE_AUTO: { target: 'BUILD', workspace: 'new' },
        WORKTREE_FAILED: { target: '@next', fresh: [ESCALATION] },
      },
    },

    // The human's pick: where a --worktree ask run starts, and the fallback of an auto run.
    WORKSPACE: {
      actor: 'human',
      do: (v) => `${v.via === 'WORKTREE_FAILED' ? WORKTREE_FAILED : ''}${workspaceAsk(v)}`,
      on: {
        WORKSPACE_READY: { target: '@next', human: true, workspace: true },
      },
    },

    BUILD: {
      actor: 'agents',
      do: withCommitStep((v) => `Ticket {ticket}: {title} ({ticketFile}). Implement it, verify it, and loop until it is green.

1. Implement. Each ticket gets its own bf-code-implementer (subagent_type: bf-code-implementer); never resume one from an
earlier ticket.
- Start of this ticket: spawn a fresh one. Brief it with paths, to read: input/SPEC.md; DECISIONS.md, the human's
  decisions, which win over the SPEC and the tickets, with its Standing rules applying to all its work; the tickets it is
  blocked by ({blockedBy}); and the reports {seedReports}: the last ticket built, whose "${BUILD_SO_FAR}" section
  carries forward the whole build, and the blockers, for what exists: files, decisions, contracts. Quote inline only the
  "What to build" and "Acceptance criteria" of {ticketFile}. Add "Build only this ticket." and this sentence: "Run the
  project's static checks and full test suite yourself in Bash until both are green, and name both commands in your
  report."
- Later in this ticket (a RETRY, or a repeat pass entered via REJECT or CONTINUE): resume this ticket's implementer with
  SendMessage, sending the failure evidence or the human's note and any new DECISIONS.md entries quoted. If it is gone
  (a new session), spawn a fresh one as above plus build/{ticket}/IMPL.md.
Every brief, fresh or resumed, names the workspace: "All your work happens in {target}: read, edit and run commands
there, never in another checkout of the repo."
Every brief, fresh or resumed, also carries the report line: "Write your full report to {run}/build/{ticket}/IMPL.md
(on a repeat pass, rewrite it as the ticket's current state, with this pass's change in its Passes section), then return
only the short reply your definition describes."
The implementer writes build/{ticket}/IMPL.md itself; later implementers read it to learn what this ticket built. Its reply
is short: act on it, and read IMPL.md only where a reply line sends you there.
An unmet acceptance criterion is not done: send it back. A guardrail hit (${GUARDRAIL}): write ESCALATION.md with the
hit and its file:line, then send GUARDRAIL_HIT.

2. Verify. In Bash, re-run the two commands the implementer named, the check command and the full test suite, in the target,
each with its output sent to a log file beside VERIFY.md. Read only the exit codes, the summary lines and the failures
from the logs.
A test that only timed out, in a test file the build leaves unchanged (absent from "git diff --name-only {base}" in
{target}), is suite load, not this ticket: re-run that file alone, once, with its log beside VERIFY.md. When it passes
alone, it counts as passing.
Write build/{ticket}/VERIFY.md: first line "Verdict: PASS" when both exit 0 or every failure is such a load timeout,
otherwise "Verdict: FAIL"; then each command, its outcome and, on failure, the evidence (file:line, failing tests, error
excerpts). List each load timeout under "Load timeouts", with its time in the suite and alone.

3. On FAIL, send RETRY ({left.RETRY} of {max.RETRY} left this pass), then send the evidence to the implementer (step 1) and
verify again (step 2). When RETRY is refused, or it isn't converging (the same failure keeps returning, or the cause is
outside the code: a test that fails even alone in an unchanged file, missing service), write ESCALATION.md with the failures and what was tried, then send STUCK.
${onPass(v)}
When BUILT is blocked by the report (IMPL.md has no "## ${BUILD_SO_FAR}" section, or it is empty), send the reason back to
this ticket's implementer and send BUILT again; this is not a RETRY.`),
      on: {
        BUILT: {
          message: COMMIT_MESSAGE,
          verified: true,
          fresh: ['build/{ticket}/IMPL.md', 'build/{ticket}/VERIFY.md'],
          verdict: { file: 'build/{ticket}/VERIFY.md', is: 'PASS' },
          section: { file: 'build/{ticket}/IMPL.md', heading: BUILD_SO_FAR },
          routes: [{ when: { gate: 'ticket' }, target: '@next' }, ...afterTicket('accept')],
        },
        RETRY: {
          target: 'BUILD',
          fresh: ['build/{ticket}/VERIFY.md'],
          verdict: { file: 'build/{ticket}/VERIFY.md', is: 'FAIL' },
          maxPerPass: 3,
          maxHint: 'write ESCALATION.md and send STUCK',
        },
        GUARDRAIL_HIT: { target: 'ESCALATED', fresh: [ESCALATION], resume: 'BUILD' },
        STUCK: { target: 'ESCALATED', fresh: [ESCALATION], resume: 'BUILD' },
      },
    },

    TICKET_GATE: gate(
      (v) => `Present ticket {ticket}: {title}: the files changed and the acceptance criteria from the Summary of
build/{ticket}/IMPL.md, the verdicts from build/{ticket}/VERIFY.md, what is uncommitted in the target (git -C {target} status --short),
and any change since verification that this output lists below.
Ask the human for improvements: REJECT with them as --note sends the same ticket back to BUILD. With none, APPROVE: it
records the ticket as a patch and commits nothing.${
        v.commit === 'ticket' ? ' The next state then starts by suggesting its commit message, for the human to commit it.' : ''
      }`,
      { perTicket: true, noteTo: DECISIONS, approve: afterTicket('acceptPatch'), reject: 'BUILD' },
    ),

    BUILD_GATE: gate(
      withCommitStep((v) => `Every ticket is built. Present:
- the queue with each ticket's commit (build-flow status);
- the commit history since the base (git -C {target} log --oneline {base}..HEAD), matched to the tickets' commits;
- what is still uncommitted (git -C {target} status --short);
- the diff stat of the whole build, committed or not (git -C {target} add -A -N && git -C {target} diff --stat {base}).
Ask the human to APPROVE the code review and how to run it: their --note becomes the review brief in review/BRIEF.md
(focus areas, extra standards); for now one bf-independent-reviewer runs it. Or REJECT with what to change first.${
        v.commit === 'none' ? `\n${finalCommitMessage(v)}` : ''
      }${humanCommitsRepair(v) && v.via === 'REPAIRED' ? `\n${repairCommitStep(v)}` : ''}`),
      {
        noteTo: DECISIONS,
        approve: { target: '@next', noteTo: 'review/BRIEF.md', startReview: true },
        reject: 'REPAIR',
      },
    ),

    REVIEW: {
      actor: 'agents',
      do: (v) => `${v.reviews > 0 && v.via === 'REPAIRED' ? RE_REVIEW : FIRST_REVIEW}
This is review round ${v.reviews + 1}. The brief also carries the report line: "Write your full report to {run}/review/REVIEW.md:
every finding under its id (R${v.reviews + 1}-F1, R${v.reviews + 1}-F2, …), CRITICAL first, with its severity (CRITICAL, MAJOR, MINOR), file:line and
suggested direction; then return only the short reply your definition describes."
The reviewer writes review/REVIEW.md itself; read it when the reply arrives.
Then write REPORT.md: each ticket with its commit or patch and verdicts, every finding of this review under the id
REVIEW.md gives it, CRITICAL first, with its severity, file:line and suggested direction, and the implementers' follow-ups.
An id belongs to its round for good: a later round starts again at F1 under its own R number. Then send REVIEWED: the human
chooses what to fix.`,
      on: {
        REVIEWED: { target: '@next', archive: ['review/REVIEW.md', REPORT], fresh: ['review/REVIEW.md', REPORT] },
      },
    },

    REVIEW_GATE: gate(
      (v) => `Present REPORT.md, leading with its findings as a list under their ids (R{reviews}-F1, R{reviews}-F2, …: severity, one line,
file:line), CRITICAL first, then the follow-ups, then the commits since the base (git -C {target} log --oneline {base}..HEAD)
and what is still uncommitted (git -C {target} status --short). Earlier rounds are kept as REPORT-<round>.md.
Ask the human which findings to fix: REJECT with the finding ids and any further improvements as --note sends them to
REPAIR, then back through REVIEW ({left.REJECT} repair round(s) left); APPROVE closes the run as it is.${
        // A review after the first one checked a repair.
        humanCommitsRepair(v) && v.via === 'REVIEWED' && v.reviews > 1 ? `\n${repairCommitStep(v)}` : ''
      }`,
      {
        noteTo: DECISIONS,
        approve: 'DONE',
        reject: { target: '@next', max: 5, maxHint: 'APPROVE the build as it stands' },
      },
    ),

    REPAIR: {
      actor: 'agents',
      do: (v) => `Fix what the human sent the run back for: their note, in DECISIONS.md (from BUILD_GATE: what to change before the
review; from REVIEW_GATE: the findings of REPORT.md they chose, by id, and any improvements they described).
A finding that flags a guardrail hit (${GUARDRAIL}) is a human decision, not a fix: write
ESCALATION.md with it and send GUARDRAIL_HIT before briefing the implementer.
Attribute each finding to the ticket that introduced it (each ticket's files are listed in build/<NN>/IMPL.md). Spawn a
fresh bf-code-implementer for this repair round, seeded with input/SPEC.md, DECISIONS.md, the tickets concerned, the
build/<NN>/IMPL.md reports of every ticket and the findings with their evidence and ticket numbers, under the same brief
rules as BUILD, the workspace line included: "All your work happens in {target}: read, edit and run commands there, never
in another checkout of the repo." Resume it with SendMessage for this round's own re-runs; the next round spawns a new one.
Then re-run its check command and full test suite in Bash, as BUILD's Verify step does, with logs in review/.
Write review/REPAIR.md: first line "Verdict: PASS" or "Verdict: FAIL", then the findings fixed, by ticket, and both
commands' outcomes. Repeat until PASS. REPAIRED saves the repair as a patch and goes to ${
        v.reviewed ? 'REVIEW' : 'BUILD_GATE (no review has run yet)'
      }. ${afterRepair(v)}
A guardrail hit: write ESCALATION.md and send GUARDRAIL_HIT.`,
      on: {
        REPAIRED: {
          fresh: ['review/REPAIR.md'],
          verdict: { file: 'review/REPAIR.md', is: 'PASS' },
          recordRepair: 'review/repair-{fixes}.patch',
          message: COMMIT_MESSAGE,
          // With no gate per ticket the engine commits the repair here, as it does tickets on BUILT.
          routes: [
            { when: { gate: 'end', reviewed: false }, commitRepair: true, target: 'BUILD_GATE' },
            { when: { gate: 'end' }, commitRepair: true, target: 'REVIEW' },
            { when: { reviewed: false }, target: 'BUILD_GATE' },
            { target: 'REVIEW' },
          ],
        },
        GUARDRAIL_HIT: { target: 'ESCALATED', fresh: [ESCALATION], resume: 'REPAIR' },
      },
    },

    ESCALATED: {
      actor: 'human',
      do: `Present ESCALATION.md: why the run stopped and the options. Ask the human to:
- CONTINUE, with how to proceed as --note: the run returns to {resume};
- or ACCEPT the build as it stands, without the fix, with their reason as --note (not for a BUILD escalation: tickets are
  left to build). Before a review it returns to BUILD_GATE; after one, to REVIEW_GATE with the last REPORT.md.
To stop instead, the human simply leaves the run where it is.`,
      on: {
        CONTINUE: { target: '@resume', human: true, noteTo: DECISIONS },
        ACCEPT: {
          human: true,
          routes: [
            { when: { resume: 'BUILD' }, refuse: 'a BUILD escalation has tickets left to build; CONTINUE it' },
            { when: { reviewed: false }, target: 'BUILD_GATE' },
            { target: 'REVIEW_GATE', requires: [REPORT] },
          ],
        },
      },
    },

    DONE: {
      actor: 'human',
      do: `The build is approved. Pushing and opening a PR are the human's.`,
      on: {},
    },
  },
});
