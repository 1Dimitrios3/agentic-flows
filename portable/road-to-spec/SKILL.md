---
name: road-to-spec
description: Drive a feature from raw inputs (SRS, mocks, pages, text) to approved implementation tickets in seven ordered steps, resumable across sessions from a run folder.
argument-hint: "<run-folder> [target-repo]"
disable-model-invocation: true
---

# Road-to-spec

You orchestrate one run of road-to-spec: seven steps in a fixed order, each working from the files the earlier steps left in the **run folder**. You carry out the current step, talk to the human, and delegate the reading and the writing to subagents.

- `<run>` is the run folder: everything the run produces lives there, and nothing else is the run's memory.
- `<target>` is the repo the feature will be built in. This flow only reads it.
- `<skill>` is the folder that holds this file. Give subagents its absolute path.

## Steps

| # | Step | Who works | Ends with |
|---|---|---|---|
| 1 | INTAKE | you, with the human | the human confirms the source list |
| 2 | DISCOVERY | subagents | the discovery reports |
| 3 | SYNTHESIS | you | the understanding and its open questions |
| 4 | CLARIFY | you, with the human | **gate**: the understanding |
| 5 | SPEC | a subagent | **gate**: the spec |
| 6 | TICKETS | a subagent | **gate**: the tickets |
| 7 | DONE | you | the closing summary |

Each step's instructions are in `<skill>/steps/`: `1-intake.md`, `2-discovery.md`, `3-synthesis.md`, `4-clarify.md`, `5-spec.md`, `6-tickets.md`, `7-done.md`. Read a step's file when you enter that step, never earlier.

## 1. Open the run

`<run>/RUN.md` is the run's record: the target repo, the discovery baseline, and a log whose last line says where the run is.

- **`RUN.md` exists: resume.** Read it, then the newest `handoffs/NNN.md` if there is one, then `understanding/UNDERSTANDING.md` and `understanding/DECISIONS.md` if they exist. Read nothing else from the run folder yet.
- **No `RUN.md`: start the run.** The human gives the run folder and the target repo; ask for whichever is missing and never choose either yourself. The target must be an existing directory, and neither folder may be inside the other (compare their real paths; for a run folder that doesn't exist yet, take its nearest existing parent's): if a check fails, say which and stop. Then create the run folder if it is missing, with `sources/`, `discovery/`, `understanding/adr/`, `spec/`, `tickets/` and `handoffs/` in it, and write `RUN.md`:

  ```
  # road-to-spec run

  - Run: <absolute path>
  - Target: <absolute path>
  - Baseline: none yet

  ## Log

  - #1 · <YYYY-MM-DD> · 1 INTAKE · entered
  ```

Done when you know the current step from the last log line, and have checked for target drift (below).

- Where the last line is `entered`, start that step from the top.
- Where the last line is `done`, the run is finished: say so and stop.

## 2. Work the steps

Repeat until step 7 is done:

1. Read the current step's file in full, unless its text is already in this conversation.
2. Carry out its instructions until every part of its **Done when** holds. Check each part against the files in the run folder, never from memory.
3. If the step ends in a gate, run the gate (below).
4. Append the move to the log in `RUN.md`, then enter the step the file names under **Next**.

**The log.** One line per move, in the form `- #<n> · <YYYY-MM-DD> · <# STEP> · <what happened>`, where `<n>` counts up by one from `#1`. Before each append, look at the log's current last line in the file, and anchor the append on that line exactly as it reads there: its number makes it the only match. Never retype it from memory. Never change or remove a line. What happened is one of:

- `entered`
- `gate presented`
- `APPROVE — "<the human's words>"` or `REJECT — "<the human's words>"`
- `discovery round — "<the human's words>"`
- `drift <short sha of HEAD> — "<the human's words>"`
- `spec amended — "<the human's words>"`
- `handoff NNN`
- `void #<n> — <why>`, for a line written by mistake
- `done`, once step 7 is finished

A step without a gate has no closing line: the next step's `entered` closes it. After an APPROVE, write the APPROVE line and the next step's `entered` line in one edit. Write `entered` before you start a step's work, so a session that dies mid-step resumes in the right place.

## Gates

Steps 4, 5 and 6 end in a gate: the human approves the work, or rejects it and says what to change.

1. Present what the step file names. Log `gate presented` in an edit of its own, before the human replies, never in the same edit as the verdict.
2. Ask for one verdict: APPROVE, or REJECT with what to change.
3. Log the verdict with the human's own words.
   - **APPROVE:** enter the next step.
   - **REJECT:** append the note to `understanding/DECISIONS.md` under a `## <YYYY-MM-DD> REJECT at <# STEP>` heading, in the human's words. Then redo the step as its file says under **After a REJECT**. Its **Done when** must hold again, with the changed files, before you present the gate again.

Log only a clear verdict: a reply that names APPROVE or REJECT or plainly means one ("approve", "reject: …").

- A reply that approves with changes ("ok but change X") is a REJECT with those changes as the note: say so and confirm before you log it.
- A reply that asks for more work first ("first inspect X") is a REJECT too. Log it before you do the work: **never work inside a gate**.
- A REJECT whose note doesn't say what to change or where ("fix this ticket") is confirmed the same way, so the logged note is precise.
- When a verdict took more than one reply, log the reply that says what to change, and quote every reply in `DECISIONS.md`, in order.
- When a reply could mean either verdict, or doesn't read as a verdict at all ("fine", "as suggested" while something else is open), restate both verdicts with what each does and ask which one.
- A verdict given before the gate was presented doesn't count. Never log a verdict the human hasn't given in reply to the gate you presented.
- A REJECT logged by mistake stays in the log and in `DECISIONS.md`: the note is the record. The step is still redone before the gate is presented again.

## Target drift

The **baseline** in `RUN.md` is the target's commit that `discovery/CODEBASE.md` was read at. When you open a run, and before you present each gate, check it once the baseline is set:

```
git -C <target> rev-parse HEAD
```

If that is the baseline's commit, carry on. If it differs, list the changed files the code report cites:

```
git -C <target> diff --name-only --relative <baseline> HEAD | while read -r p; do grep -qF -- "$p" <run>/discovery/CODEBASE.md && echo "$p"; done
```

`<baseline>` is the commit alone, without the date beside it.

Tell the human that the target moved since discovery, and which cited files changed, then wait for their reply and log it as a `drift` line. With none cited, say so once, log `drift <short sha> — none cited`, and carry on without waiting. Report drift; don't act on it and don't read the changes: refreshing discovery is the human's call.

- **Report each HEAD once.** When the log already holds a `drift` line for the HEAD you find, say nothing.
- **In step 4**, a refresh is a discovery round, on their go-ahead (see the step file). At the step 4 gate it takes a REJECT first.
- **From step 5 on** there is no way back to discovery: the human weighs the changed files against the work in hand. Add the HEAD and the changed cited files to each writer's brief, so the writer checks those files in the repo and trusts the code report for the rest.

Only committed local history counts: nothing is fetched, and uncommitted edits are not seen.

## Working rules

- **Files are the memory.** Write each answer, decision and finding to its run-folder file the moment it exists. The conversation can be lost at any time; the run folder can't.
- **Change run files with your file-editing tools.** Never change a run-folder file with a shell command or script, so the human sees each change as a diff.
- **Keep `DECISIONS.md` in number order.** Each decision is `D<n>`, numbered in the order taken, and names the question it answers. Write a revision as an indented sub-bullet under the decision it changes, quoting the human. Never move or delete a decision.
- **The decisions win.** Where a decision and `understanding/UNDERSTANDING.md` disagree, update the understanding in the same turn.
- **A REJECT note that changes a decision is revised in place.** Write the revision under that decision before you brief the writer, so the dossier and the spec never disagree.
- **Record what each reply accepts.** When the human accepts several things with one reply (e.g. "as suggested"), list in the record exactly which items it accepts. A reply confirms only what was asked in that same message.
- **Recommend only what the repo shows.** Name only tokens, components, APIs and patterns you have seen in the target repo, with their code anchor (path › symbol). Mark anything you haven't checked as unverified.
- **Delegate the reading.** Subagents read the sources and the code and write the reports; you read the dossier in `understanding/` and the summaries they return, plus any report a step's file tells you to read in full.
- **Ask only what shapes the build.** Every question to the human must change what gets built or how it is tested.
- **Subagents can't ask the human.** Their questions come back to you, and you put them to the human.
- **A change goes to the writer that wrote the file.** Continue the same spec or ticket writer with the change, when your harness can message a subagent that has already returned. If it can't, or the writer is gone (e.g. a resumed session), spawn a fresh one with the change in its brief.

## Subagents

A subagent's instructions are a **role file** in `<skill>/roles/`. Spawn a subagent that can read and write files and run shell commands, and for the `researcher` role search the web. Give it this brief, and nothing the role file already says:

```
Read <skill>/roles/<role>.md in full and follow it.
Skill folder: <skill>
Run folder: <run>
Target repo: <target>
<what the step file says this role needs>
```

Spawn one subagent at a time, never in parallel: wait for each to return before you spawn the next.

## Ending a session

A run is built to cross sessions: after a gate's APPROVE, everything the next step needs is in the run folder. Offer the human a new session once, right after the step 4 APPROVE, and whenever this conversation has been compacted. If they decline, carry on.

When the human wants to stop:

1. Finish the current exchange and confirm every answer so far is in `understanding/DECISIONS.md`.
2. Write `handoffs/NNN.md`, numbered after the newest one (`001` first), with two sections, and log `handoff NNN`:
   - **In flight**: the thread that was open when the session ended: the last question asked, half-made decisions, what the human was weighing.
   - **Next step**: the first thing the next orchestrator should do.
3. Tell the human to continue in a new session with `/road-to-spec <run>`.
