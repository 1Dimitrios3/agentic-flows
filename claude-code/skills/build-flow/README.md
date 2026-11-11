# build-flow

A deterministic workflow that builds a SPEC and its tickets into a target repo, one ticket at a time in blocker order, then runs one clean-room code review of the whole change. A run folder chosen by the human holds all of a run's state, so the work can be resumed from any session.

build-flow is standalone: it shares no code with any other flow and reads no other flow's run. Its only inputs are a SPEC file and a tickets folder in the format below. It uses two agents from `~/.claude/agents/`: `bf-code-implementer`, which writes each ticket and runs its checks and tests until green, and `bf-independent-reviewer`. The orchestrator re-runs the implementer's two commands in Bash as the gate.

## Input format

`init` reads every `<NN>-<slug>.md` file in the tickets folder (other files are ignored) and refuses the set unless each ticket has a non-empty `## What to build`, `## Acceptance criteria` and `## Blocked by`, no two tickets share a number, and every blocker names a ticket in the folder with no cycle.

`## Blocked by` holds "None" or one bullet per blocker, named by the first number on the bullet (`- 01`, `- #3`, `- Ticket 02: …`, `- [01-EXPORT](01-EXPORT.md)`). A ticket's title is its first `# ` heading (a leading ticket number is dropped), else its slug.

The queue is the blocker order: repeatedly the lowest-numbered ticket whose blockers are all queued. It is fixed for the run, kept in `flow.json`, and printed by `init`, `status` and `handoff`.

## Hooks

All three are declared in the `SKILL.md` frontmatter, so they exist only in sessions where `/build-flow` was run. For every other tool call they print nothing.

- `stop.mjs` (Stop) keeps a `--gate end` run going while the human is away; with `--gate ticket` it does nothing. When the orchestrator ends its turn it lets the stop happen if the state is the human's (a gate, an escalation, the end), if the session just wrote a handoff, or if a subagent or background shell is still running (its result wakes the session). Otherwise it blocks the stop and tells the orchestrator to run `build-flow next <run>`. It follows the run its own session drives: the engine records that on every command, under `sessions/` beside the last-run file, from `CLAUDE_CODE_SESSION_ID` (`session.mjs`). Each decision is a line in the run's `stop-hook.log`. Claude Code ends the turn itself after 8 blocks in a row with no tool call between them. It can't help with a permission prompt, a subagent that never returns, an API error or usage limit, or a session that is gone: resume those with `/build-flow <run>`.

- `gate.mjs` (PreToolUse on Bash, Edit, Write, MultiEdit) **asks** the human to confirm `build-flow send` with a human-gate event (any event marked `human: true` in the definition; a gate word inside `--note` or `--message` is prose). The human sees the exact command; the event goes through only if they accept. It **denies** the agent `build-flow init`, any Bash command naming `flow.json` or `events.jsonl`, `git commit`/`push`/`merge`/`rebase`/`reset --hard` and `gh pr` (the engine commits, shipping is the human's), and any Edit/Write of `flow.json`, `events.jsonl` or `input/` in a build-flow run. The human's own shell is not guarded. In a `--gate end` run, the gate prompt also warns the human when the session's permission mode can still prompt (anything but auto or bypassPermissions), since a prompt while they are away stalls the run. A skill's hooks don't reach subagents, so the `bf-code-implementer` agent registers `gate.mjs` in its own frontmatter: there it applies the same denials and also denies `build-flow send`, `handoff` and `init`, which are the orchestrator's.
- `ctx.mjs` (PostToolUse on Bash, Edit, Write, Agent) reads the main session's context from its transcript tail (`usage.mjs`: input + cache tokens of its last assistant turn). Above `THRESH` it tells the orchestrator to keep working and offer a new session at the next human gate, then again every `STEP`; below `THRESH` again it resets. Only the orchestrator is measured: every ticket gets a fresh `bf-code-implementer`, so implementers aren't.

## CLI

`flow.mjs` is the engine; everything calls it as `build-flow`, through a symlink on your `PATH`:

```
ln -s ~/.claude/skills/build-flow/flow.mjs ~/.local/bin/build-flow
```

Once per machine; edits to `flow.mjs` apply at once. Redo it only if the skill folder moves or on a new machine. `build-flow` with no arguments prints the usage line; `command not found` means the link or `PATH` is missing. create-flow needs its own link. Any harness that runs shell commands here can call it (Windows-native tools can't see it inside WSL), but only the engine carries over: without tool hooks, nothing asks the human before the agent sends a gate event or runs `git commit`.

```
build-flow init    <run> --repo <repo> --spec <SPEC.md> --tickets <dir> --gate ticket|end [--commit ticket|none]
                                      create the run (human only)
build-flow status  <run>              state, ticket, modes, resume files, queue, artifacts, recent transitions
build-flow next    <run>              instructions for the current state and its events, (ready) or (blocked)
build-flow send    <run> <EVENT> [--at <STATE> [--ticket <NN>]] [--note '...'] [--message '<commit subject>']
                         [--target <path> --branch <name> [--scope <ticket-id>] [--source <ref>]]
                                      take a transition; human gates need --at and --note, plus --ticket at a per-ticket gate
build-flow drift   <run>              what changed in the target since the last verification: the human's own edits
build-flow handoff <run>              write handoffs/NNN.md for the next session
```

Every command except `init` may leave out `<run>`: it then uses the run last named on the command line (`~/.local/state/build-flow/last-run`, or `$BUILD_FLOW_LAST_RUN`) and says so on stderr, so a gate command the human types stays short: `! build-flow send APPROVE --at BUILD_GATE --note '...'`. The orchestrator always names the run.

`APPROVE` and `REJECT` have the same names at every gate, so a gate event must name its gate with `--at <STATE>`, plus `--ticket <NN>` where the gate repeats per ticket; `next` prints the exact flags. A stale or replayed command is refused at any later gate or ticket. `send` also refuses every event while the target is off the run's branch.

State lives in `<run>/flow.json` and changes only through `send`; every change is appended to `<run>/events.jsonl`.

### Starting a run

```
! build-flow init ~/builds/my-feature --repo ~/code/my-app \
    --spec ~/flows/my-feature/spec/SPEC.md --tickets ~/flows/my-feature/tickets --gate ticket
```

| Argument | What to give | Rules |
|---|---|---|
| `<run>` | The **run folder**: `input/` (copies of the SPEC and tickets), `build/` (per ticket: `IMPL.md`, `VERIFY.md`, the patch), `review/`, `handoffs/`, `DECISIONS.md`, `ESCALATION.md`, `REPORT.md`. | Must not already hold a run; must be outside the repo. |
| `--repo <repo>` | The git repo the work belongs to. The **target**, where the build happens, is chosen in the first state: this repo on a branch the human confirms, or a new worktree of it. | Must have at least one commit. |
| `--spec <file>`, `--tickets <dir>` | The SPEC and the tickets folder. | Copied to `input/`; the tickets must pass the input format. |
| `--gate` | `ticket`: the human approves every ticket. `end`: the human sees the build once, after the last ticket. | Fixed for the run. In both modes the human approves the review and chooses what to fix. |
| `--commit` | `ticket` (default): every ticket gets its own commit, with a message written as `~/.claude/skills/build-flow/references/commit-msg.md` describes. Who commits depends on the gate. With `--gate ticket` the human does: APPROVE records the ticket as a cumulative patch since the base and commits nothing, and the next state starts by suggesting the commit message and waits for the human to commit or skip. With `--gate end` the engine does, on `BUILT`: no human sees the message first, so the engine refuses `BUILT` without a `--message` shaped `type(TICKET): summary`, 72 characters at most (the transition's `message: { pattern, max, hint }`, checked on `send` for an agent's event that commits the ticket). Repairs follow the tickets: with `--gate ticket` the gate after a repair suggests its commit message and the human commits it; with `--gate end` the engine commits it on `REPAIRED`, which it refuses without a `--message` of the same shape. `none`: nothing is committed; each recorded ticket saves a cumulative patch since the base, and BUILD_GATE proposes one commit message for the whole build, for the human to commit with when they choose. | `ticket` needs a clean target when the workspace is chosen. |

### The workspace

The run starts in the workspace state, once; nothing leads back to it. The orchestrator asks the human whether to create a new worktree (`git -C <repo> worktree add -b <branch> <path> <source>`, then offers to install dependencies or copy local config) or to confirm the repo's current branch. It then sends the workspace event with `--target <path> --branch <branch> [--scope <ticket-id>] [--source <source>]`, which the human accepts in the permission prompt. The engine refuses it unless the target is the repo or one of its worktrees, is on exactly that branch, doesn't contain or sit inside the run folder, is clean for `--commit ticket`, and, with `--source` (required for a worktree), is still at the source's commit. It records the target, branch, source, and `HEAD` as the **base** every diff is taken against. `status` and handoffs flag a target that moved off the recorded branch.

The orchestrator also asks here, once and in every mode, for the human's ticket id: the `TICKET` of the run's commit messages, `type(TICKET): summary`. The branch name is never consulted for it.

- **With a ticket id**, it is the run's **scope**: sent as `--scope` (no spaces or parentheses), shown in `status`, and given to every state that writes or suggests a commit message. A commit the engine makes itself (`BUILT` and `REPAIRED` with `--gate end --commit ticket`) is refused under any other scope.
- **Without one**, `--scope` is left out and the run has no scope. Each commit message then takes one lowercase word for the area of what it commits, decided per commit: for a ticket, from that ticket's own file in `input/tickets`; for a repair, from the findings it fixed and the files it changed; for the single message of `--commit none`, from the tickets together. The commits of one run can so carry different words, and the engine checks only the message's shape.

### Decisions and drift

`DECISIONS.md` holds the human's decisions, which win over the SPEC and tickets. `init` creates it; the engine appends every gate note the definition routes there, with its state and ticket; the orchestrator adds the human's answers and edits. Fresh implementers and the reviewer are briefed with it.

When a transition records the verified tree, the engine keeps the working tree as a git tree object (throwaway index). `next` at a gate or right after a human's event lists anything changed since, and so does `build-flow drift`; both name each `it(…)` / `test(…)` / `describe(…)` case deleted from a test file, so the orchestrator asks the human whether it was deliberate. Every diff is taken against the base, so committed and uncommitted work alike reach the reviewer.

## Events

The whole flow as a diagram: [LOGICAL-DIAGRAM.md](LOGICAL-DIAGRAM.md). Each state allows only its own events. One row per route: an event with routes takes the first whose condition holds; a refused route blocks the event with its reason.

<!-- generated from flow.definition.mjs by docs.mjs: edit the definition, then run node docs.mjs --write -->
| State | Event | Goes to | Ready when / route | On the move |
|---|---|---|---|---|
| WORKSPACE | `WORKSPACE_READY` | BUILD | human gate with `--target`, `--branch`, (for a worktree) `--source` and (with a ticket id) `--scope` | records the target, branch, source, base and commit scope |
| BUILD | `BUILT` | TICKET_GATE | gate `ticket`; `build/{ticket}/IMPL.md` rewritten; `build/{ticket}/VERIFY.md` rewritten; `VERIFY.md` says `Verdict: PASS`; `IMPL.md` has a non-empty `## Build so far` | records the verified tree |
| BUILD | `BUILT` | BUILD | more tickets; `build/{ticket}/IMPL.md` rewritten; `build/{ticket}/VERIFY.md` rewritten; `VERIFY.md` says `Verdict: PASS`; `IMPL.md` has a non-empty `## Build so far` | records the verified tree; records the ticket (commit, or `build/{ticket}/cumulative.patch`) |
| BUILD | `BUILT` | BUILD_GATE | `build/{ticket}/IMPL.md` rewritten; `build/{ticket}/VERIFY.md` rewritten; `VERIFY.md` says `Verdict: PASS`; `IMPL.md` has a non-empty `## Build so far` | records the verified tree; records the ticket (commit, or `build/{ticket}/cumulative.patch`) |
| BUILD | `RETRY` | BUILD | at most 3 times per pass; `build/{ticket}/VERIFY.md` rewritten; `VERIFY.md` says `Verdict: FAIL` | — |
| BUILD | `GUARDRAIL_HIT` | ESCALATED | `ESCALATION.md` rewritten | CONTINUE returns to BUILD |
| BUILD | `STUCK` | ESCALATED | `ESCALATION.md` rewritten | CONTINUE returns to BUILD |
| TICKET_GATE | `APPROVE` | BUILD | human gate; more tickets | records the ticket (`build/{ticket}/cumulative.patch`; the commit is the human's) |
| TICKET_GATE | `APPROVE` | BUILD_GATE | human gate | records the ticket (`build/{ticket}/cumulative.patch`; the commit is the human's) |
| TICKET_GATE | `REJECT` | BUILD | human gate | appends the note to `DECISIONS.md` |
| BUILD_GATE | `APPROVE` | REVIEW | human gate | marks the review started; appends the note to `review/BRIEF.md` |
| BUILD_GATE | `REJECT` | REPAIR | human gate | appends the note to `DECISIONS.md` |
| REVIEW | `REVIEWED` | REVIEW_GATE | `review/REVIEW.md` rewritten; `REPORT.md` rewritten | archives `review/REVIEW.md`, `REPORT.md` per round |
| REVIEW_GATE | `APPROVE` | DONE | human gate | — |
| REVIEW_GATE | `REJECT` | REPAIR | human gate; at most 5 times per run | appends the note to `DECISIONS.md` |
| REPAIR | `REPAIRED` | BUILD_GATE | gate `end`; before any review; `review/REPAIR.md` rewritten; `REPAIR.md` says `Verdict: PASS` | saves the repair as `review/repair-{fixes}.patch`; commits a pending repair |
| REPAIR | `REPAIRED` | REVIEW | gate `end`; `review/REPAIR.md` rewritten; `REPAIR.md` says `Verdict: PASS` | saves the repair as `review/repair-{fixes}.patch`; commits a pending repair |
| REPAIR | `REPAIRED` | BUILD_GATE | before any review; `review/REPAIR.md` rewritten; `REPAIR.md` says `Verdict: PASS` | saves the repair as `review/repair-{fixes}.patch` |
| REPAIR | `REPAIRED` | REVIEW | `review/REPAIR.md` rewritten; `REPAIR.md` says `Verdict: PASS` | saves the repair as `review/repair-{fixes}.patch` |
| REPAIR | `GUARDRAIL_HIT` | ESCALATED | `ESCALATION.md` rewritten | CONTINUE returns to REPAIR |
| ESCALATED | `CONTINUE` | BUILD or REPAIR (the state the escalation resumes) | human gate | appends the note to `DECISIONS.md` |
| ESCALATED | `ACCEPT` | — | refused: the escalation resumes BUILD: a BUILD escalation has tickets left to build; CONTINUE it | — |
| ESCALATED | `ACCEPT` | BUILD_GATE | human gate; before any review | — |
| ESCALATED | `ACCEPT` | REVIEW_GATE | human gate; `REPORT.md` exists | — |
<!-- end generated -->

Recording a ticket marks it done in the queue after committing the working tree (on `BUILT` with `--gate end --commit ticket`; it fails, and the state stays, when there is nothing to commit) or writing its cumulative patch (every other case, the human's APPROVE included). Saving a repair writes a patch of the repair alone; a review entered via REPAIRED checks only that patch against the findings the human chose, while the first review covers the whole build. A saved repair is committed by the event carrying `commitRepair`: here `REPAIRED` itself with `--gate end --commit ticket`, and no event otherwise (the commit is the human's).

## Adding or removing a step

Example: a design-check gate between the build and the review.

**1. Edit `flow.definition.mjs`.** Insert the states where they belong; `@next` / `@prev` rewire the neighbours. Add any new folder to `dirs` and any new file to `artifacts`.

```js
BUILD_GATE: gate(…, { approve: { target: '@next', … } }),   // now leads to DESIGN_CHECK
DESIGN_CHECK: {
  actor: 'agents',
  do: `Spawn design-checker … write review/DESIGN.md.`,
  on: { DESIGN_CHECKED: { target: '@next', fresh: ['review/DESIGN.md'] } },
},
DESIGN_GATE: gate(`Present review/DESIGN.md …`, { noteTo: DECISIONS, reject: 'REPAIR' }),
REVIEW: { … },
```

**2. Regenerate the docs:** `node docs.mjs --write`.

**3. Add the step to `STEPS` in `flow.test.mjs`, then run `node --test`.**

```js
[['review/DESIGN.md'], 'DESIGN_CHECKED'],
[[], 'APPROVE'],                            // DESIGN_GATE
```

To remove a step, do the reverse. `engine.test.mjs` should pass untouched either way.

## Definition format

Top-level fields:

- `id`: the flow's name, stored in `flow.json`; also the CLI name and the command the gate hook watches.
- `initial`: the state `init` enters.
- `dirs`: the folders `init` creates; it adds `input/` and `handoffs/` itself. `seed`: files `init` writes, path to content.
- `artifacts`: the paths `status` and `handoff` list. `resume`: those a resuming orchestrator reads after the newest handoff, in order. `report`: each ticket's report, listed by `{seedReports}` for the last ticket recorded and the current ticket's blockers. All may use `{ticket}`.
- `states`: the states, keyed by name. Their written order is the step order `@next` / `@prev` follow.

State fields:

- `actor`: `orchestrator`, `agents` or `human`.
- `do`: the instructions `next` prints, with `{placeholders}` from the run: `ticket`, `title`, `ticketFile`, `blockedBy`, `seedReports`, `approved` (the last ticket recorded), `run`, `repo`, `base`, `target`, `commit`, `resume`, `reviews`, `fixes`, and `left.<EVENT>` / `max.<EVENT>` for an event with a limit. Or a function of those values (plus `via`, the entering event, and `reviewed`) returning the text.
- `perTicket`: `true` on a gate that repeats per ticket; its human events must carry `--ticket`.
- `on`: map from EVENT to transition.

`steps.mjs` has the helpers: `link(def)` resolves `@next` / `@prev` on transitions and routes, and `gate(present, { noteTo, approve = '@next', reject = '@prev', ...stateFields })` builds a human gate whose REJECT appends the note to `noteTo`. `approve` and `reject` take a state name, a route list, or a transition object with extra fields.

Transition fields (paths are relative to the run folder). Any other field is refused at load, so a misspelled guard can't be skipped. Guards run in the order of `guards` in `flow.mjs`, effects in the order of `effects`; a new kind of rule is one entry there.

- `target`: a state name, `@next` / `@prev`, or `@resume` for the state the last escalation named.
- `routes`: instead of `target`, a list of `{ when, target, ... }`; the first whose `when` holds is taken and inherits the transition's other fields. `when` tests the engine's facts: `gate` (`ticket`/`end`), `more` (open tickets besides the current one), `reviewed` (a review has started) and `resume`. The last route has no `when`. `refuse`: on a route instead of `target`, why the event is refused.
- `human`: `true` marks a human gate.

Guards: `requires` (paths that exist and are non-empty), `fresh` (also modified since the state was entered), `verdict` (`{ file, is }`: the file's first `Verdict:` line), `section` (`{ file, heading }`: the file has a `## <heading>` with content before the next `#` or `##` heading), `max` (sends of the event from this state in the whole run), `maxPerPass` (sends in a row; entering the state by another event starts a new pass), `maxHint` (text shown once a limit is used up).

Effects: `workspace` (the check under "The workspace"), `verified` (records the working tree for drift), `accept` (records the ticket: a commit in commit mode ticket, else the patch at the value's path), `acceptPatch` (records the ticket as that patch in every commit mode: the commit is the human's), `startReview` (sets the `reviewed` fact), `archive` (copies the file to `<name>-N<ext>`), `recordRepair` (saves the change since the verified tree at this path, `{fixes}` numbered, pending a commit), `commitRepair` (commits a pending repair, on the same event as `recordRepair` or a later one; on an agent's event the transition's `message` shape applies), `noteTo` (appends the `--note`), `resume` (where `@resume` returns).

## Docs and tests

The events table above and the diagram in `LOGICAL-DIAGRAM.md` are generated from the definition between `<!-- generated … -->` markers; the prose around them is hand-written. After any change to the definition, run `node docs.mjs --write` in the skill folder (without `--write` it only prints). If you forget, `node --test` fails and names the command.

| File | Tests | On |
|---|---|---|
| `engine.test.mjs` | the engine's rules: guards, routes, refusals, `@resume`, per-ticket pins, effects, commits and patches, drift, init, handoff, the last-run fallback | `fixture.definition.mjs`, a made-up flow; never breaks when build-flow's steps change |
| `flow.test.mjs` | build-flow's own steps: the walk in each mode, where each REJECT returns, the escalations, the review rounds | the real definition; update it with the steps |
| `definition.test.mjs` | the definition's shape, the generated docs, no step names in `SKILL.md` | the real definition |
| `steps.test.mjs`, `gate.test.mjs`, `ctx.test.mjs`, `stop.test.mjs` | `link()`/`gate()`, the three hooks and the session record | — |

`harness.mjs` holds the shared helpers. The engine tests run a temp copy of `flow.mjs` with the fixture as its definition; the real engine can't load another one.
