---
name: migrate-build-flow
description: Port the Claude Code build-flow to opencode as build-flow-oc, or re-sync the opencode port after the Claude side changed.
disable-model-invocation: true
---

# Migrate build-flow to opencode

You turn the Claude Code build-flow into its opencode port, **`build-flow-oc`**. build-flow is an orchestrator skill, a Node engine beside it, three hooks (gate, ctx, stop), the agents its definition names and the reference files they read. The same steps cover a fresh port (no opencode files yet) and a sync (the port exists and Claude moved on).

- Claude side: `~/.claude/skills/build-flow/` and `~/.claude/agents/`, the links that `claude-code/install.sh` makes into this repo's `claude-code/` folder. It is the **source**: never edit it here.
- opencode side: `~/.config/opencode/` (written `C/` below). Written for opencode 1.x (checked against 1.19.5): on another major version, check that the plugin hooks named below still exist before you start.
- opencode also loads `~/.claude/skills/` and offers each skill as a slash command, so the unported `/build-flow` would sit beside `/build-flow-oc` with none of its guards. The human exports `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1` in their shell profile; step 4 checks it.
- When a mapping below seems wrong, ask the human before you break it.

The port is **Claude's text run through the harness mapping below**, nothing more. Any opencode-side difference the mapping doesn't explain is drift: replace it with Claude's text and list it in your report.

## Steps

### 1. Inventory

Collect the flow's files: everything in `~/.claude/skills/build-flow/`, every hook in its `SKILL.md` frontmatter and in any agent's frontmatter, every agent the definition names (`grep -o 'bf-[a-z-]*' flow.definition.mjs | sort -u`), every reference file a text reads by path (`grep -rno 'references/[a-z-]*\.md' flow.definition.mjs SKILL.md references ~/.claude/agents/<agent>.md`). For each, find its opencode target (see "Where files go") and compare: same, differs, or missing.

Done when every file has a verdict. Show the human the list before step 2.

### 2. Port

For each differing or missing file, apply the mapping row that fits it. A file with no matching row: stop and ask the human how it maps.

Done when re-running step 1 shows differences only in mapped files, and each remaining hunk is explained by a mapping row.

### 3. Generated docs

```bash
cd ~/.config/opencode/build-flow && node docs.mjs --write
```

### 4. Verify

```bash
cd ~/.config/opencode/build-flow && node --test
build-flow-oc                        # prints the usage line
opencode debug config > /dev/null && echo "config ok"
opencode debug skill | grep '"location"'
opencode debug agent <name>          # every agent you touched
```

Done when the tests are green, the config loads, no skill location is under `~/.claude/`, and every touched agent shows its `permission` block and an empty `options`. A skill location under `~/.claude/` means `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1` is not exported in this shell: say so in the report.

### 5. Report

Tell the human what changed per file, the drift you replaced, which "verify on first run" items below are still open, whether `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1` still has to be exported, and that opencode must be restarted (it reads config only at startup).

## Where files go

| Claude | opencode |
|---|---|
| `skills/build-flow/SKILL.md` | `C/command/build-flow-oc.md` |
| engine: `flow.mjs`, `flow.definition.mjs`, `steps.mjs`, `queue.mjs`, `session.mjs`, `docs.mjs`, `harness.mjs`, `fixture.definition.mjs`, `flow.test.mjs`, `engine.test.mjs`, `definition.test.mjs`, `steps.test.mjs`, `README.md`, `LOGICAL-DIAGRAM.md`, `references/` (`commit-msg.md`, `code-review.md`) | `C/build-flow/` (same names; `SKILL.md` is not copied, it becomes the command above) |
| hooks: `gate.mjs`, `ctx.mjs`, `stop.mjs`, and `usage.mjs` (the transcript reader only `ctx.mjs` uses) | one plugin, `C/plugins/build-flow.js`, + `C/opencode.json` rules |
| hook tests: `gate.test.mjs`, `ctx.test.mjs`, `stop.test.mjs` | not ported (they test the Claude hook protocol) |
| `agents/bf-code-implementer.md`, `agents/bf-independent-reviewer.md` (and any agent step 1 finds) | `C/agent/<name>.md` |
| `~/.local/bin/build-flow` | `~/.local/bin/build-flow-oc` → symlink to `C/build-flow/flow.mjs`. Leave the Claude CLI alone. |

## Harness mapping

### Names

The flow is `build-flow-oc` wherever a name is seen: the definition `id`, the CLI in every text, the slash command, plugin messages and temp markers, the `opencode.json` rules, the README title. The folder `C/build-flow/` and the plugin file keep the plain name. Agent names and reference file names stay as Claude has them. Another ported flow named in a text (e.g. `create-flow`) also takes its `-oc` name.

### Engine files

Copy unchanged, except where a file names the harness:

- the definition: `id: "build-flow-oc"`; reference paths `~/.claude/skills/build-flow/references/` → `~/.config/opencode/build-flow/references/`; a tool named in a state text takes the Tools wording below (each "resume … with SendMessage", each "in Bash"); `subagent_type: <name>` stays (the task tool takes that parameter);
- `flow.mjs` reads the session id from `CLAUDE_CODE_SESSION_ID`: leave the engine as it is, the plugin sets that variable (see Hooks);
- a test that reads `SKILL.md` reads `../command/build-flow-oc.md`;
- a test that matches the CLI name in the engine's output or in a state text (`definition.test.mjs`, `flow.test.mjs`) takes the `-oc` name;
- `harness.mjs`: the env key `BUILD_FLOW_LAST_RUN` becomes `BUILD_FLOW_OC_LAST_RUN` (the engine derives the key from the id), or the tests write to the real `~/.local/state/build-flow-oc/`;
- the README: see below.

### Orchestrator: skill → command

opencode skills can't turn off model invocation, so the skill becomes a command.

- **Frontmatter**: only `description`, with the usage folded in (`Usage - /build-flow-oc <run-folder>`). Drop `name`, `argument-hint`, `disable-model-invocation`, `hooks`.
- **Argument**: first line after the title: ``The run folder argument is: `$ARGUMENTS`. Below, `<run>` means that folder.``
- **Tools**, by Claude name → opencode wording:
  - Agent / subagent → "the task tool, with the agent named … as `subagent_type`"
  - SendMessage to an agent → keep the agent's `task_id` from its task result and continue it with the task tool; spawn a fresh one when the id is gone
  - Edit, Write, MultiEdit → "the edit or write tool"
  - Bash → bash
  - `! <cmd>` typed by the human → add "(or running it in a terminal)"
- **Guards**: "a hook asks / turns this into a permission prompt" → "a permission rule …"; "a hook denies" → "a plugin denies".

### Hooks → one plugin + permission rules

opencode has no hooks in skill, command or agent frontmatter. A plugin in `C/plugins/` runs in **every** session, subagent sessions included. Import the definition from `../build-flow/flow.definition.mjs` (and `session.mjs` where a hook used it) instead of copying names. Constants (thresholds, caps, regexes) keep Claude's values. Every `client.*` call returns `{ data, error }`: read the result from `.data`.

| Claude hook | opencode |
|---|---|
| PreToolUse `permissionDecision: deny` | `tool.execute.before`: `throw new Error(reason)`. Bash command in `args.command`; file path in `args.filePath` / `file_path` / `path`; `apply_patch` paths from the `*** Add/Update/Delete File:` lines of `args.patchText`. Tool names are lowercase. Every denial of `gate.mjs` carries over (init, state files, `input/`, the git and `gh pr` commands); the last row says in which sessions. The `CLI` regex matches `build-flow-oc` and `build-flow/flow.mjs`: the folder keeps the plain name. |
| PreToolUse `ask` | A plugin can't ask: an `"ask"` rule in `opencode.json` `permission.bash`, one glob per asked command. A glob matches from the start of a command, so the rules see only a plain `build-flow-oc send …` command. Where Claude's gate would ask (its `send` + gate-word test) but no simple command in the line starts with `build-flow-oc send` and holds the gate word itself (the CLI by path or as `flow.mjs`, the event in a variable), the plugin denies and tells the agent to send the event as one plain `build-flow-oc send …` command. |
| text the `ask` shows the human (`awayWarning`: a `--gate end` run in a mode that can still prompt) | An ask rule carries no text. Move it into the README's Guards section and the command's human-gate paragraph, as a fact the human reads before a `--gate end` run. |
| a hook in an agent's frontmatter (`bf-code-implementer` registers `gate.mjs`), `input.agent_id` set | The plugin already sees subagent calls. A session is a subagent's when `client.session.get({ path: { id: sessionID } })` returns a `parentID` (in `.data`), and a flow subagent's when that parent is a marked session (last row); apply the subagent denials (`init`, `send`, `handoff`) there. Cache the answer per session. |
| PostToolUse `additionalContext` | `tool.execute.after`: append to `output.output`. Measure only the orchestrator's session (no `parentID`). |
| transcript reads (`usage.mjs`) | `client.session.messages({ path: { id: sessionID }, query: { limit: 20 } })`; context = `input + cache.read + cache.write` of `info.tokens` on the last assistant message where that sum is not zero (the message in progress has zero tokens until its step ends). |
| Stop `decision: block` with a `reason` | `event` hook on `event.type === "session.idle"` (session id in `event.properties.sessionID`), orchestrator sessions only: where `stop.mjs` would block, send its reason as a new user message with `client.session.prompt`. Claude Code ends the loop after 8 blocks in a row with no tool call between; opencode has no cap, so the plugin counts its own pushes per session (reset by any `tool.execute.after`) and stops at the same number. `stop-hook.log` lines stay as they are. Before pushing, read the session's last assistant message: when its `info.error?.name` is `"MessageAbortedError"` the human interrupted the turn, so don't push and log an `allow` (opencode goes idle on an interrupt; Claude's Stop hook never runs on one). Claude's "background tasks still running" check: opencode's task tool returns before the turn ends, so `session.idle` means nothing is running (unless `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS` is set: then ask the human). |
| engine reads `CLAUDE_CODE_SESSION_ID` | `shell.env`: set `output.env.CLAUDE_CODE_SESSION_ID = input.sessionID`, so the engine records the session as it does under Claude Code. |
| hook scoped to the skill's sessions | The plugin marks the session in `command.execute.before` when `input.command === "build-flow-oc"` (temp file `build-flow-oc-session-<sid>`); ctx and stop speak only in marked sessions. The gate's denials that name the CLI (`init`, a gate `send`) or a file inside a run folder of this flow (`flow.json`, `events.jsonl`, `input/`) are silent for unrelated calls and apply in every session. Its other bash denials (a command naming `flow.json` or `events.jsonl`, the git and `gh pr` commands) match any project's commands, so they apply only in flow sessions: a marked session, or a subagent session whose parent is marked. |

**Verify on first run** (from the plugin API types, not yet seen working): the `session.idle` event and `client.session.prompt` (shape: `{ path: { id }, body: { parts: [{ type: "text", text }] } }`), `parentID` on subagent sessions, `shell.env` reaching the bash tool. Log once in each hook and check before you report the port done.

### Agents

- **Frontmatter**: `description`, `mode: subagent`, `permission`. Drop `name`, `tools` and `model: inherit` (neither loads as Claude writes it), and `hooks` (moved to the plugin; opencode silently moves a field it doesn't know into `options`). A named model (`model: opus`): ask the human for its opencode `provider/model` id, or drop it so the agent uses the session's model.
- **`tools` → `permission`**: no Write or Edit → `edit: deny`, else `edit: allow` (an agent's rule beats the global one, so `ask` would stall a `--gate end` run at the first edit; the orchestrator's re-run and the end review check the work); no Agent → `task: deny`; Bash commands the body runs → `bash: "<cmd> *": allow` or leave them to the global rule; WebFetch/WebSearch keep the global rule.
- **Folders**: an agent that reads or writes the target repo gets `external_directory` for the human's repo globs (ask the human, or read the existing port). Run folders and the flow's `references/` folder go in `opencode.json`, not the agent.
- **Body**: Claude's, with paths `~/.claude/skills/build-flow/references/` → `~/.config/opencode/build-flow/references/` "(expand `~` to the home directory)", and "resume / message you" → "continue this task".

### Reference files

Copy `references/` into `C/build-flow/references/` unchanged, except a path inside a file that names `~/.claude/skills/build-flow/` (`code-review.md` has one): rewrite it as in the definition. The files are read by path and never loaded as skills (none is named `SKILL.md`), so their frontmatter stays as it is.

### `opencode.json` (inside `"permission"`)

The file may be `opencode.jsonc` instead: edit the one the human has, and keep its comments. Back it up first: opencode refuses to start on an invalid config. Show the human the change.

- `bash`, at the end, in this order (the last matching rule wins): `"build-flow-oc *": "allow"`, `"build-flow-oc init *": "deny"`, then one `"build-flow-oc send *<EVENT>*": "ask"` per gate event. List the gate events from the definition, not from this file:

  ```bash
  cd ~/.config/opencode/build-flow && node -e 'import("./flow.definition.mjs").then(({default:d})=>console.log([...new Set(Object.values(d.states).flatMap(s=>Object.entries(s.on).filter(([,t])=>t.human).map(([e])=>e)))].join("\n")))'
  ```

  A gate word inside `--note`, `--message` or `--unchanged` also prompts (a glob can't skip it): the safe side.
- `external_directory`: `"*": "ask"` plus `"allow"` for the human's run folders and build workspaces (worktrees sit outside the project too), and for `~/.config/opencode/build-flow/references/` (the orchestrator and agents read it by path).

### README

Engine sections follow Claude's text with the CLI renamed. Harness sections are rewritten for opencode: Hooks → "Guards (opencode)" (plugin denials, subagent denials, `ask` rules, context warning, the idle push for `--gate end` with its cap, the away warning); the setup at the top of "CLI" (the `C/` layout, the `build-flow-oc` symlink, the `opencode.json` snippet, per-agent permission YAML, "answer prompts with Allow once, never Allow always", the check commands); starting a run (`init` in a terminal); tests without the hook tests. No mention of Claude anywhere.
