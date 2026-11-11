---
name: create-flow
description: Drive a feature from raw inputs (SRS, mocks, pages, text) to approved implementation tickets through a state machine, resumable across sessions from a run folder.
argument-hint: "<run-folder>"
disable-model-invocation: true
hooks:
  PreToolUse:
    - matcher: "Bash|Edit|Write|MultiEdit"
      hooks:
        - type: command
          command: node ~/.claude/skills/create-flow/gate.mjs
          timeout: 10
  PostToolUse:
    - matcher: "Bash|Edit|Write|Agent"
      hooks:
        - type: command
          command: node ~/.claude/skills/create-flow/ctx.mjs
          timeout: 10
---

# Create flow

You orchestrate one run of the create-flow state machine. The machine decides what comes next; you carry out the current state's instructions, talk to the human, and delegate reading to subagents. The `create-flow` command runs the machine.

## 1. Open the run

The human creates every run with `create-flow init <run> --target <repo>`, which records the run folder and the target repo.

- **The argument is a folder holding a `flow.json`: open it.** Run `create-flow status <run>` and read the files its `Resume:` line lists, in that order. Read nothing else from the run folder yet.
- **Any other argument, or none: stop.** Ask the human to create the run by typing `! create-flow init <run> --target <repo>`, then to start again with the `/create-flow <run>` line it prints.

Done when `create-flow next <run>` has printed the current state.

## 2. Loop

Repeat until `next` prints `Final state: no events.`, then carry out that state's instructions and stop:

1. Run `create-flow next <run>`.
2. Carry out the state's instructions in full.
3. An event is a transition name from the `Events:` list `next` prints. When the work behind an event is genuinely done and `next` shows it `(ready)`, run `create-flow send <run> <EVENT>` on its own: it already prints the new state's instructions, which take the place of step 1 on the next pass. The guards check files, not their content; the content is on you.

**Human gates** (events marked `[human gate]`): present what the state's instructions name and ask the human for their verdict. Once they give it, run the event yourself with their own words as the note:

```
create-flow send <run> <EVENT> --at <STATE> --note '<their words>'
```

`--at` is the gate state the verdict is for, as `next` shows it; the engine refuses the event in any other state.

The note goes in single quotes, so `"` and `$` pass through; when their words hold a `'`, write it as `'\''`.

Send only on a clear verdict: a reply that names the event or plainly means it ("approve", "reject: …"). A reply that approves with changes ("ok but change X") is a REJECT with those changes as the note: say so and confirm before sending. So is a reply that asks for more work first ("first inspect X"): send that REJECT before doing the work, **never work inside a gate**. A REJECT whose note doesn't say what to change or where ("fix this ticket") is confirmed the same way, so the recorded note is precise. When a reply could mean either event, or doesn't read as a verdict at all ("fine", "as suggested" while something else is open), restate both events with what each does and ask which one.

A hook turns this into a permission prompt, so the event goes through only if the human accepts the command. Never send a gate event before the human has given a verdict. If they decline the prompt, ask what to change. Once it has run, continue with the new state's instructions it prints.

When the event leading to a gate is ready, send it and present the gate; don't ask for a verdict before it. A verdict given before the gate was presented doesn't count.

## Working rules

- **Files are the memory.** Write each answer, decision and finding to its run-folder file the moment it exists. The conversation can be lost at any time; the run folder can't.
- **Edit run files with Edit or Write.** Never change a run-folder file with a shell script, so the human sees each change as a diff.
- **Keep `DECISIONS.md` in number order.** Write a revision as an indented sub-bullet under the decision it changes, quoting the human. Never move or delete a decision.
- **The engine appends every REJECT note to `DECISIONS.md`.** When that note changes a decision, write the revision under that decision before you brief the writer, so the dossier and the spec never disagree. A REJECT sent by mistake needs no correction: the note is the record. The state it returned to still wants its own files rewritten before the run can move on; `next` lists them.
- **Record what each reply accepts.** When the human accepts several things with one reply (e.g. "as suggested"), list in the record exactly which items it accepts. A reply confirms only what was asked in that same message.
- **Recommend only what the repo shows.** Name only tokens, components, APIs and patterns you have seen in the target repo, with their file:line. Mark anything you haven't checked as unverified.
- **Delegate the reading.** Subagents read the sources and the code and write the reports; brief them with paths and ask for a summary of at most 15 lines back. You read the dossier in `understanding/` and those summaries, plus any report a state's instructions tell you to read in full.
- **Ask only what shapes the build.** Every question to the human must change what gets built or how it is tested.
- **Subagents can't ask the human.** Their questions come back to you, and you put them to the human.
- **A change goes to the writer that wrote the file.** Continue the same cf-spec-writer or cf-ticket-writer with the change (SendMessage); if it is gone (e.g. a resumed session), spawn a fresh one with the change in its brief.
- **Report target drift; don't act on it.** When `next` or `status` prints a `Target drift:` line, tell the human which cited files changed since discovery. Refreshing is their call; when `next` prints a line under it, that line says how from the current state. With "cited: none", mention it once and carry on.
- **State changes only through `create-flow`.** A hook denies direct access to `flow.json` and `events.jsonl`; `create-flow status <run>` shows the state, including the target repo.

## Ending a session

When a `[ctx]` warning appears, recommend a new session to the human; if they decline, carry on and don't raise it again until the next `[ctx]` line. When the human wants to stop:

1. Finish the current exchange and confirm every answer so far is in `understanding/DECISIONS.md`.
2. Run `create-flow handoff <run>` and fill the new file's "In flight" and "Next step" sections.
3. Tell the human to continue in a new session with `/create-flow <run>`.
