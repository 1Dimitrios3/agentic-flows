# 2. DISCOVERY

Two subagents do the reading. The `requirements-analyst` role reads the sources and writes `discovery/REQUIREMENTS.md`. The `codebase-explorer` role reads the target repo and writes `discovery/CODEBASE.md`. You read only the summaries they return.

The step runs as a **first pass**, or as a **refresh pass** when the last log line before `2 DISCOVERY · entered` is a `discovery round`.

## Research comes first

When the feature depends on facts that neither `sources/` nor the target repo holds (a third-party API, a library's docs, a standard), tell the human what will be looked up, then spawn the `researcher` role with the questions and a topic name. It writes `sources/research-<topic>.md`. List that file in `sources/INDEX.md` before you spawn the requirements analyst, which reads every source listed there.

## First pass

Spawn one role at a time, each with the standard brief alone: `requirements-analyst` first, then, once it has returned, `codebase-explorer`, which reads the requirements report to know what the feature is.

## Refresh pass

Sort the items the discovery round was called for: the ones you showed the human before it. Every other open `- [ ]` item in `understanding/OPEN-QUESTIONS.md` waits for the human in step 4 and goes to no role.

- what the feature must do is answered by the sources: `requirements-analyst`;
- where and how the code does it is answered by the target repo: `codebase-explorer`;
- an item you can't place goes to both;
- an item only an outside source can answer is researched first (above), then goes to `requirements-analyst`.

Tell the human which role runs, and for which items. Spawn only a role that has items, one at a time and in the same order when both do, and add each role's items to its brief, by Q number with one line each. Each rewrites its own report in full.

## Baseline

Whenever `codebase-explorer` has written `discovery/CODEBASE.md`, in either pass, run `git -C <target> rev-parse HEAD` and set the Baseline line in `RUN.md` to `<sha> (<YYYY-MM-DD>)`. If the command fails, set it to `none: the target has no git commits, so drift is not tracked`.

A refresh that reran only `requirements-analyst` keeps the old baseline: the code report still describes the commit it was read at, so a drift report clears only once `codebase-explorer` has reread the repo.

**Done when** every report due in this pass is non-empty and was rewritten in this pass (first pass: both), and the Baseline line matches what was rewritten.

**Next:** step 3, SYNTHESIS.
