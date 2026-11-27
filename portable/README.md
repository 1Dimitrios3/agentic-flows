# Portable flows

The [agentic-flows](../README.md) written as prose only: a skill is a folder of Markdown files, with no engine, hooks or agent definitions. Any harness that loads skills and can spawn subagents can run one.

- **road-to-spec**: from raw inputs (an SRS, mocks, screenshots, live pages, plain text) to an approved SPEC and a set of implementation tickets. It follows the same steps as [create-flow](../claude-code/skills/create-flow/README.md), with instructions in place of the engine.

## How road-to-spec differs from create-flow

| | create-flow | road-to-spec |
|---|---|---|
| Harness | Claude Code | Any that loads skills |
| Needs | Node.js, the `create-flow` CLI | Nothing but the skill folder |
| Run state | `flow.json` and `events.jsonl`, written by the engine | `RUN.md`, a log the agent appends to |
| Human gates | A permission prompt for each verdict | Asked and answered in the conversation |
| Guardrails | Hooks block edits to the state files | None: the rules are instructions, and nothing enforces them |

The two are separate skills and their run folders are not interchangeable. Both write `spec/SPEC.md` and `tickets/` in the run folder, so [build-flow](../claude-code/skills/build-flow/README.md) takes the output of either.

## Install

Clone the repo, then link the skill folder into your harness's skills directory. `<clone-dir>` is the folder you keep the repo in.

For Claude Code:

```sh
ln -s <clone-dir>/portable/road-to-spec ~/.claude/skills/road-to-spec
```

For another harness, link the same folder into that harness's skills directory.

**Update:** `git pull`. The link points into the repo, so changes apply immediately.

**Uninstall:** remove the link. Your run folders are left alone.

## Quick start

```
/road-to-spec <run> <repo>
```

| Placeholder | What to put there |
|---|---|
| `<run>` | A folder for one run. It holds everything the run produces: sources, requirements, decisions, the spec and the tickets. The skill creates it if it is missing. |
| `<repo>` | Your project's repo: the existing codebase the feature is built into. road-to-spec only reads it. |

Neither folder may be inside the other. The agent walks you through adding sources, answering open questions, and approving the understanding, the spec and the tickets. They end up in `<run>/spec/SPEC.md` and `<run>/tickets/`.

To resume in a later session, pass the run folder alone: `/road-to-spec <run>`.

Optional: the chrome-devtools MCP server, if you want road-to-spec to inspect live pages or drive a prototype.

## License

[MIT](../LICENSE). Some reference files are adapted from [mattpocock/skills](https://github.com/mattpocock/skills) under the MIT License; see [THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md).
