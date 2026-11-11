# create-flow

A deterministic workflow that goes from raw inputs to a set of approved tickets ready for implementation. A run folder chosen by the human holds all of a run's state, so the work can be resumed from any session.

## Hooks

Both are declared in the `SKILL.md` frontmatter, so they exist only in sessions where `/create-flow` was run. For every other tool call they print nothing, leaving the normal permission flow (auto mode included) unchanged.

- `gate.mjs` (PreToolUse on Bash, Edit, Write, MultiEdit):
  - **asks** the human to confirm `create-flow send` (or `create-flow/flow.mjs send`) with a human-gate event (any event marked `human: true` in the definition). A gate word inside `--note` doesn't count. Another flow's commands and run folders are left alone. The human sees the exact command; the event goes through only if they accept. They can also send it from their own shell, which no hook guards.
  - **denies** the agent `create-flow init` (as the subcommand only), any Bash command that names `flow.json` or `events.jsonl`, and any Edit/Write to those files in a run folder.
- `ctx.mjs` (PostToolUse on Bash, Edit, Write, Agent) reads the session's context size from the transcript tail. Above `THRESH` it tells the orchestrator to recommend a new session, then again every `STEP` tokens; below `THRESH` again (e.g. after `/compact`) it resets. The numbers are at the top of the file.

## CLI

### One-time setup

`flow.mjs` is the engine; everything calls it as `create-flow`, through a symlink on your `PATH`:

```
ln -s ~/.claude/skills/create-flow/flow.mjs ~/.local/bin/create-flow
```

Once per machine; edits to `flow.mjs` apply at once. Redo it only if the skill folder moves or on a new machine. `create-flow` with no arguments prints the usage line; `command not found` means the link or `PATH` is missing. build-flow needs its own link (`~/.local/bin/build-flow`).

Any harness that runs shell commands here can call `create-flow` (Windows-native tools can't see it inside WSL). Only the engine carries over: without tool hooks, nothing asks the human before the agent sends a gate event.

### Commands

```
create-flow init    <run> --target <repo>      create the run (human only)
create-flow status  <run>                      state, target, baseline and drift, resume files, artifacts, recent events
create-flow next    <run>                      instructions for the current state and its events, (ready) or (blocked)
create-flow send    <run> <EVENT> [--at <STATE>] [--note "..."]
                                               take a transition; human gates need --at <current state> and --note
create-flow handoff <run>                      write handoffs/NNN.md for the next session
```

State lives in `<run>/flow.json` and changes only through `send`; every change is appended to `<run>/events.jsonl`.

### Target drift

`DISCOVERY_DONE` records the target repo's HEAD as the run's **baseline**. After that, `next`, `status` and `handoff` print a `Target drift:` line when HEAD has moved, naming the changed files that `discovery/CODEBASE.md` cites. The human decides whether to refresh discovery.

- Only committed local history counts: nothing is fetched, uncommitted edits are ignored.
- "Cited" is a plain substring match on the repo-relative path, so it can over-report (`a.ts` matches `a.tsx`), never under-report.
- A refresh that rewrites `discovery/CODEBASE.md` (`DISCOVERY_REFRESHED`, `CODEBASE_REFRESHED`) records a new baseline; `REQUIREMENTS_REFRESHED` keeps the old one. A target with no commits gets none.

### Events

The whole flow as a diagram: [LOGICAL-DIAGRAM.md](LOGICAL-DIAGRAM.md). Each state allows only its own events. `APPROVE` and `REJECT` have the same name at every gate, so they must carry `--at <STATE>`: a replayed command is refused at any later gate.

<!-- generated from flow.definition.mjs by docs.mjs: edit the definition, then run node docs.mjs --write -->
| State | Event | Goes to | Ready when | On the move |
|---|---|---|---|---|
| INTAKE | `SOURCES_REGISTERED` | DISCOVERY | `sources/INDEX.md` exists | — |
| DISCOVERY | `DISCOVERY_DONE` | SYNTHESIS | `discovery/REQUIREMENTS.md` rewritten in this state; `discovery/CODEBASE.md` rewritten in this state | records the target's HEAD as the baseline (drift checks `discovery/CODEBASE.md`) |
| REDISCOVERY | `DISCOVERY_REFRESHED` | SYNTHESIS | `discovery/REQUIREMENTS.md` rewritten in this state; `discovery/CODEBASE.md` rewritten in this state | records the target's HEAD as the baseline (drift checks `discovery/CODEBASE.md`) |
| REDISCOVERY | `CODEBASE_REFRESHED` | SYNTHESIS | `discovery/CODEBASE.md` rewritten in this state | records the target's HEAD as the baseline (drift checks `discovery/CODEBASE.md`) |
| REDISCOVERY | `REQUIREMENTS_REFRESHED` | SYNTHESIS | `discovery/REQUIREMENTS.md` rewritten in this state | — |
| SYNTHESIS | `SYNTHESIZED` | CLARIFY | `understanding/OPEN-QUESTIONS.md` exists; `understanding/UNDERSTANDING.md` rewritten in this state | — |
| CLARIFY | `NEEDS_MORE_DISCOVERY` | REDISCOVERY | human gate; sent fewer than 10 times in the run | — |
| CLARIFY | `CLARIFIED` | UNDERSTANDING_GATE | `understanding/GLOSSARY.md` exists; `understanding/DECISIONS.md` rewritten in this state; `understanding/UNDERSTANDING.md` rewritten in this state; no open `- [ ]` in `understanding/OPEN-QUESTIONS.md` | — |
| UNDERSTANDING_GATE | `APPROVE` | SPEC_DRAFTING | human gate | — |
| UNDERSTANDING_GATE | `REJECT` | CLARIFY | human gate | appends the note to `understanding/DECISIONS.md` |
| SPEC_DRAFTING | `SPEC_DRAFTED` | SPEC_GATE | `spec/SPEC.md` rewritten in this state | — |
| SPEC_GATE | `APPROVE` | TICKETING | human gate | — |
| SPEC_GATE | `REJECT` | SPEC_DRAFTING | human gate | appends the note to `understanding/DECISIONS.md` |
| TICKETING | `TICKETS_DRAFTED` | TICKETS_GATE | `tickets` rewritten in this state | — |
| TICKETS_GATE | `APPROVE` | DONE | human gate | — |
| TICKETS_GATE | `REJECT` | TICKETING | human gate | appends the note to `understanding/DECISIONS.md` |
<!-- end generated -->

### Starting a run

In your agent session (with the `!` prefix) or in a terminal:

```
! create-flow init ~/flows/my-feature --target ~/code/my-app
```

- `<run>`: the **run folder**, where all of this run's documents live. One per feature, named after it. Created if missing; must not already hold a `flow.json`.
- `--target <repo>`: the **target repo** the feature will be built in. Must exist and must not contain the run folder (or sit inside it). Only read, never written to.

Both are stored absolute in `flow.json`. `init` prints `/create-flow <run>`, which starts the orchestrator and resumes the run in any later session.

## Adding or removing a step

Example: a design step and its gate after the spec gate.

**1. Edit `flow.definition.mjs`.** Insert the states where they belong. `@next` / `@prev` rewire the neighbours. Add any new folder to `dirs` and any new file to `artifacts`.

```js
SPEC_GATE: gate(`…`, { noteTo: DECISIONS }),
DESIGN: {
  actor: 'agents',
  do: `Spawn design-writer … output design/DESIGN.md.`,
  on: { DESIGN_DRAFTED: { target: '@next', fresh: ['design/DESIGN.md'] } },
},
DESIGN_GATE: gate(`Present design/DESIGN.md …`, { noteTo: DECISIONS }),
TICKETING: { … },
```

**2. Regenerate the docs:** `node docs.mjs --write`.

**3. Add the step to `STEPS` in `flow.test.mjs`, then run `node --test`.**

```js
[[], 'APPROVE'],                            // SPEC_GATE
[['design/DESIGN.md'], 'DESIGN_DRAFTED'],
[[], 'APPROVE'],                            // DESIGN_GATE
```

To remove a step, do the reverse. `engine.test.mjs` should pass untouched either way.

## Definition format

Top-level fields:

- `id`: the flow's name, stored in `flow.json`; also the CLI name in messages and the command the gate hook watches.
- `initial`: the state `init` enters.
- `dirs`: the folders `init` creates (it adds `handoffs/` itself). Every artifact lives in one (tested).
- `artifacts`: the paths `status` and `handoff` list.
- `resume`: the artifacts a resuming orchestrator reads, in order, after the newest handoff; `status` prints those that exist on its `Resume:` line.
- `states`: the states, keyed by name. Their written order is the step order `@next` / `@prev` follow.

State fields:

- `actor`: `orchestrator`, `agents` or `human`.
- `do`: the instructions `next` prints. They name no other state, only the state's own events (tested).
- `onDrift`: optional line `next` prints under `Target drift:`, e.g. how to get back to discovery. Without it, the engine prints `No way back to <state> …` when no path leads back to where the baseline is recorded.
- `on`: map from EVENT to transition.

SKILL.md names no state and no event except `APPROVE` / `REJECT` (tested), so a step lives entirely in the definition.

`steps.mjs` has the helpers: `link(def)` resolves `@next` / `@prev` when the definition loads, and `gate(present, { noteTo, approve = '@next', reject = '@prev', ...stateFields })` builds a human gate whose REJECT appends the note to `noteTo`.

Transition fields (paths are relative to the run folder). Any other field is refused at load, so a misspelled guard can't be skipped. Guards run in the order of `guards` in `flow.mjs` and effects in the order of `effects`; a new kind of rule is one entry there.

- `target`: a state name, or `@next` / `@prev`. Use a name for any jump over more than one state.
- `human`: `true` marks a human gate (`send` needs `--at` and `--note`).
- `noteTo`: file the `--note` is appended to on the move. It then counts as fresh in the state the run returns to.
- `requires`: paths that must exist and be non-empty (a directory must have entries).
- `fresh`: like `requires`, and modified since the current state was entered.
- `clear`: checklist files with no open `- [ ]` (answered `- [x]`, deferred `- [-]`).
- `max`: how many times the event may be sent from this state in the whole run; a REJECT back doesn't reset it, and the same event name in another state has its own count. `maxHint`: optional text shown once it's used up.
- `baseline`: `{ cites: '<report>' }` records the target's HEAD on the move and the report drift checks. Not a guard: without git the move still goes ahead.

## Docs

The events table above and the diagram in `LOGICAL-DIAGRAM.md` are generated from the definition, between `<!-- generated … -->` markers; the prose around them is hand-written. After any change to the definition, run:

```
cd ~/.claude/skills/create-flow && node docs.mjs --write
```

Without `--write` it only prints the blocks. If you forget, `node --test` fails and names this command.

## Tests

```
cd ~/.claude/skills/create-flow && node --test
```

| File | Tests | On |
|---|---|---|
| `engine.test.mjs` | the engine's rules: guards, gates, effects, drift, init, handoff, resume, definition checks | `fixture.definition.mjs`, a made-up flow; never breaks when create-flow's steps change |
| `flow.test.mjs` | create-flow's own steps: the walk, the discovery refresh, where each REJECT returns, the drift lines | the real definition; update it with the steps |
| `definition.test.mjs` | the definition's shape, the generated docs, no stale step names | the real definition |
| `steps.test.mjs`, `gate.test.mjs`, `ctx.test.mjs` | `link()`/`gate()` and the two hooks | — |

`harness.mjs` holds the shared helpers. The engine tests run a temp copy of `flow.mjs` with the fixture as its definition; the real engine can't load another one.
