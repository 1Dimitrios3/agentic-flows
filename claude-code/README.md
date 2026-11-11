# agentic-flows for Claude Code

The [agentic-flows](../README.md) for [Claude Code](https://claude.com/claude-code): two workflows that take a feature from raw inputs to reviewed code, with a human approving each step that matters.

- **create-flow**: from raw inputs (an SRS, mocks, screenshots, live pages, plain text) to an approved SPEC and a set of implementation tickets.
- **build-flow**: from a SPEC and its tickets to code in your repo, one ticket at a time in blocker order, finished by one clean-room code review.

They work well in sequence (create-flow's output is build-flow's input), but each one stands alone.

## How they work

Each flow is a **state machine** driven by a small Node CLI. Claude orchestrates; the engine decides what comes next.

- **Resumable.** All of a run's state lives in a run folder you choose. Close the session, open a new one, and pick up where you left off with `/create-flow <create-run>` or `/build-flow <build-run>` (see [Quick start](#quick-start)).
- **Human gates.** Approvals (the understanding of the requirements, the spec, the tickets, each built ticket, the build, the review) are events only you can confirm. A hook turns each one into a permission prompt that shows you the exact command.
- **Guardrails.** Hooks stop the agent from editing the run's state files directly. In build-flow they also stop it from running `git commit`, `push`, `merge`, `rebase`, `reset --hard` or `gh pr` itself. Commits go through the engine, and you choose who makes them (see `--commit` below). Pushing, merging and opening PRs always stay yours.
- **Focused subagents.** Reading, writing and reviewing are delegated to subagents that each get only what they need. The final review is clean-room: the reviewer never sees the implementer's notes.

| Flow | Subagents |
|---|---|
| create-flow | `cf-requirements-analyst`, `cf-codebase-explorer`, `cf-researcher`, `cf-spec-writer`, `cf-ticket-writer` |
| build-flow | `bf-code-implementer`, `bf-independent-reviewer` |

## Requirements

- Claude Code
- Node.js 20.11 or newer
- git
- macOS or Linux (on Windows, use WSL)
- Optional: the chrome-devtools MCP server, if you want create-flow to inspect live pages

## Install

```sh
git clone https://github.com/1Dimitrios3/agentic-flows.git <clone-dir>
cd <clone-dir>/claude-code
./install.sh
```

`<clone-dir>` is any folder you choose to keep the repo in. Keep it there: the installed links point into it.

`install.sh` creates symlinks only; it copies nothing:

| Link | Points to |
|---|---|
| `~/.claude/skills/create-flow`, `~/.claude/skills/build-flow` | `claude-code/skills/…` in the repo |
| `~/.claude/agents/cf-*.md`, `~/.claude/agents/bf-*.md` | `claude-code/agents/…` in the repo |
| `~/.local/bin/create-flow`, `~/.local/bin/build-flow` | each skill's `flow.mjs` |

It checks every path first and installs nothing if any of them already exists. Make sure `~/.local/bin` is on your `PATH`, or set `BIN_DIR` to put the two CLIs somewhere else.

**Update:** `git pull`. The links point into the repo, so changes apply immediately.

**Uninstall:** `./install.sh --uninstall`. It removes only the links that point into this repo, and leaves your run folders alone.

## Quick start

The flows never start on their own: each one runs only when you type its command. You create every run yourself; Claude can't. In Claude Code, `!` runs a shell command in the session.

The commands below use these placeholders:

| Placeholder | What to put there |
|---|---|
| `<repo>` | Your project's git repo: the existing codebase the feature is built into. create-flow only reads it; build-flow writes the code there. |
| `<create-run>` | A new, empty folder for one create-flow run. It holds everything the run produces: sources, requirements, decisions, the spec and the tickets. |
| `<build-run>` | A new, empty folder for one build-flow run. It holds the run's state, per-ticket reports, the review and decisions. |

Both run folders must be outside `<repo>`. You pass `<repo>` only to `init`. After that, the run folder is all a flow needs, including to resume in a later session.

**1. Turn inputs into tickets.**

```
! create-flow init <create-run> --target <repo>
/create-flow <create-run>
```

Claude walks you through adding sources, answering open questions, and approving the spec and the tickets. They end up in `<create-run>/spec/SPEC.md` and `<create-run>/tickets/`.

**2. Build the tickets.**

```
! build-flow init <build-run> --repo <repo> --spec <create-run>/spec/SPEC.md --tickets <create-run>/tickets --gate ticket
/build-flow <build-run>
```

- `--gate ticket` has you approve every ticket. `--gate end` lets the build run unattended and shows it to you once, after the last ticket. In both modes you approve the review and choose which findings to fix.
- `--commit ticket` (the default) gives every ticket its own commit. With `--gate ticket`, you make each commit from a suggested message. With `--gate end`, the engine commits each ticket itself, with a message the agent writes.
- `--commit none` commits nothing. At the end you get one suggested message for the whole build, to commit when you choose.

The run folder must be outside the repo. Where the build happens (the repo's current branch or a new worktree) is chosen with you at the start of the run. See the [build-flow README](skills/build-flow/README.md) for every option.

## Documentation

- [create-flow](skills/create-flow/README.md), and its [state diagram](skills/create-flow/LOGICAL-DIAGRAM.md)
- [build-flow](skills/build-flow/README.md), and its [state diagram](skills/build-flow/LOGICAL-DIAGRAM.md)

Each README covers the CLI, every event, the hooks, the input formats, and how to change a flow.

## Development

Each skill has its own test suite:

```sh
cd skills/create-flow && node --test
cd skills/build-flow && node --test
```

The events table in each README and each `LOGICAL-DIAGRAM.md` are generated from `flow.definition.mjs`. After you change a definition, run `node docs.mjs --write` in that skill's folder.

## License

[MIT](../LICENSE). Some reference files are adapted from [mattpocock/skills](https://github.com/mattpocock/skills) under the MIT License; see [THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md).
