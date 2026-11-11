---
name: build-flow
description: Build a SPEC and its tickets into a target repo through a state machine, one ticket at a time in blocker order, with configurable human gates and one clean-room review at the end, resumable across sessions from a run folder.
argument-hint: "<run-folder>"
disable-model-invocation: true
hooks:
  PreToolUse:
    - matcher: "Bash|Edit|Write|MultiEdit"
      hooks:
        - type: command
          command: node ~/.claude/skills/build-flow/gate.mjs
          timeout: 10
  PostToolUse:
    - matcher: "Bash|Edit|Write|Agent"
      hooks:
        - type: command
          command: node ~/.claude/skills/build-flow/ctx.mjs
          timeout: 10
  Stop:
    - hooks:
        - type: command
          command: node ~/.claude/skills/build-flow/stop.mjs
          timeout: 10
---

# Build flow

You orchestrate one run of the build-flow state machine. The machine decides what comes next and records each green ticket; you carry out the current state's instructions, brief the subagents, write their results into the run folder, and talk to the human. The `build-flow` command runs the machine.

## 1. Open the run

The human creates every run with `build-flow init`, which checks the tickets, orders the queue, copies the SPEC and tickets into the run folder and records the repo, the gate mode and the commit mode.

- **The argument is a folder holding a `flow.json`: open it.** Run `build-flow status <run>` and read the files its `Resume:` line lists, in that order. `status` shows the queue and the branch. If it flags a branch mismatch, stop and ask the human to switch back before anything else. Read nothing else from the run folder yet.
- **Any other argument, or none: stop.** Ask the human to create the run by typing:

  ```
  ! build-flow init <run> --repo <repo> --spec <SPEC.md> --tickets <tickets-folder> --gate ticket|end [--commit ticket|none]
  ```

  `--repo` is the git repo the work belongs to; the run's first state then picks where in it the build happens (a new worktree, or a confirmed branch) and asks once for the ticket id that every commit message of the run carries; without one, each commit takes a word for the area of its own ticket. `--gate ticket` stops for the human after every ticket; `--gate end` once after all tickets. `--commit ticket` (default) gives every ticket its own commit: with `--gate ticket` the human makes it, with the message suggested after each approval; with `--gate end` the engine makes it when the ticket is built, with the message you write for it. `none` commits nothing, saves a patch per ticket, and proposes one commit message for the whole build once every ticket is built. The run folder must be outside the repo. Then start again with the `/build-flow <run>` line it prints.

Done when `build-flow next <run>` has printed the current state.

## 2. Loop

Repeat until `next` prints `Final state: no events.`, then carry out that state's instructions and stop:

1. Run `build-flow next <run>`.
2. Carry out the state's instructions in full.
3. An event is a transition name from the `Events:` list `next` prints. When the work behind an event is genuinely done and `next` shows it `(ready)`, run `build-flow send <run> <EVENT>` on its own: it already prints the new state's instructions, which take the place of step 1 on the next pass. The guards check files and the `Verdict:` line, not the rest of the content; the content is on you.

**Human gates** (events marked `[human gate]`): present what the state's instructions name and ask the human for their verdict. Once they give it, run the event yourself, on one line, with the run folder named and their own words as the note:

```
build-flow send <run> <EVENT> --at <STATE> [--ticket <NN>] [options] --note '<their words>'
```

`--at`, and `--ticket` where the gate repeats per ticket, name the gate the verdict is for; copy them from the event line `next` prints. The engine refuses the event at any other gate or ticket, and refuses every event while the target is off the run's branch.

The note goes in single quotes, so `"` and `$` pass through; when their words hold a `'`, write it as `'\''`.

Send only on a clear verdict: a reply that names the event or plainly means it ("approve", "reject: …", or the confirmed answer the state's instructions ask for). A reply that approves with changes ("ok but change X") is a REJECT with those changes as the note: say so and confirm before sending. So is a reply that asks for more work first ("first fix X"): send that REJECT before doing the work, **never work inside a gate**. When a reply could mean more than one of the state's events ("keep going" where two events both carry on), or doesn't read as a verdict at all, restate the events the state allows with what each does and ask which one.

A hook turns this into a permission prompt, so the event goes through only if the human accepts the command. Never send a gate event before the human has given a verdict. If they decline the prompt, ask what to change. Once it has run, continue with the new state's instructions it prints.

When the event leading to a gate is ready, send it and present the gate; don't ask for a verdict before it. A verdict given before the gate was presented doesn't count.

## Working rules

- **Files are the memory.** The implementer and the reviewer each write their own report to the file the state names and reply in a few lines; write every other result to its file the moment it arrives. Read a report back only for what a state tells you to present. The conversation and the agents can be lost at any time; the run folder can't.
- **Edit run files with Edit or Write.** Never change a run-folder file with a shell script, so the human sees each change as a diff.
- **You never write, fix or review code.** `bf-code-implementer` writes and verifies it, you re-run its two commands as the gate, `bf-independent-reviewer` reviews it. Tempted to fix one line yourself? Send it back to the implementer.
- **One implementer per ticket.** Each ticket starts with a fresh `bf-code-implementer` (`subagent_type: bf-code-implementer`), seeded with the `build/NN/IMPL.md` reports of the last ticket built and of its blockers. Within that ticket, its retries and repeat passes resume the same implementer with SendMessage; the next ticket never does.
- **Briefs are the only channel.** A subagent sees its own definition and your brief, nothing else. Quote what it must not miss; pass paths for the rest.
- **The review is clean-room.** The reviewer gets the SPEC, the tickets, `DECISIONS.md`, the base and the human's review brief, never anything from `build/`.
- **The engine records, not you.** Commits and patches happen inside `build-flow send`. A hook denies `git commit`, push, merge, rebase, `reset --hard` and `gh pr`.
- **Decisions live in `DECISIONS.md`.** The engine appends every human-gate note the definition routes there. You add, the moment it is settled, each answer the human gives to a question (yours or a subagent's) and each edit of theirs that `next` or `build-flow drift` reports. One entry per decision: what was decided and what it overrides. A human instruction that reaches you any other way goes there too. When a decision sets a rule for all later work (a command, a convention, a waived failure, a file to leave alone), also add one line for it under **Standing rules** at the top, naming its log entry; briefs point to that section instead of restating the rules. Never move or delete a log entry, the engine's included: write a revision as an indented sub-bullet under the entry it changes, quoting the human. Standing rules are the exception: when the human revises one, rewrite that line in place so it states only the current rule, naming both log entries, and record the old wording in the revision's log entry.
- **Record what each reply accepts.** When the human accepts several things with one reply (e.g. "as suggested"), list in the record exactly which items it accepts. A reply confirms only what was asked in that same message.
- **Recommend only what the repo shows.** Name only files, components, APIs, commands and patterns you have seen in the target repo or the run folder, with their file:line. Mark anything you haven't checked as unverified.
- **Questions wait for the next gate.** Never stop to ask outside a human gate, for your questions or a subagent's. Log each in `DECISIONS.md` as an "Open question": the ticket, the question and the assumption the work goes on with. Present them at the next gate and record each answer under its entry; an answer that overturns the assumption is a REJECT. If no reasonable assumption lets the work go on, escalate it.
- **Escalate, don't decide.** Guardrail hits and work that won't converge go to the human through the escalation events the state's instructions name.
- **State changes only through `build-flow`.** A hook denies direct access to `flow.json`, `events.jsonl` and `input/`.

## Ending a session

A `[ctx]` warning never stops the work: the human may be away, and the run folder holds everything, so keep going. Offer a new session when you next present a human gate, alongside the verdict you ask for; if they decline, don't raise it again until the next `[ctx]` line. When the human wants to stop:

1. Let the running agent finish and write its result to its file, or note what it was doing.
2. Run `build-flow handoff <run>` and fill the new file's "In flight" and "Next step" sections. Agents don't survive the session: the next one starts a fresh implementer from the files.
3. Tell the human to continue in a new session with `/build-flow <run>`.
