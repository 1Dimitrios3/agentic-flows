---
name: migrate-create-flow
description: Port a Claude Code flow (skill + engine + hooks + agents) to opencode, or re-sync the opencode port after the Claude side changed.
argument-hint: "<flow-name>"
disable-model-invocation: true
---

# Migrate a flow to opencode

You turn a Claude Code flow (example: create-flow) into its opencode port, **`<flow>-oc`**. A flow is an orchestrator skill, a Node engine beside it, the hooks its frontmatter declares, the agents its text names, and the reference files in its `references/` folder. The same steps cover a fresh port (no opencode files yet) and a sync (the port exists and Claude moved on).

- Claude side: `~/.claude/skills/<flow>/` and `~/.claude/agents/`, the links that `claude-code/install.sh` makes into this repo's `claude-code/` folder. It is the **source**: never edit it here.
- opencode side: `~/.config/opencode/` (written `C/` below). Written for opencode 1.x (checked against 1.19.5): on another major version, check that the plugin hooks named below still exist before you start.
- opencode also loads `~/.claude/skills/` and offers each skill as a slash command, so the unported `/<flow>` would sit beside `/<flow>-oc` with none of its guards. The human exports `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1` in their shell profile; step 4 checks it.
- When a mapping below seems wrong, ask the human before you break it.

The port is **Claude's text run through the harness mapping below**, nothing more. Any opencode-side difference the mapping doesn't explain is drift: replace it with Claude's text and list it in your report.

## Steps

### 1. Inventory

Collect the flow's files: everything in `~/.claude/skills/<flow>/`, every hook command in its `SKILL.md` frontmatter, every agent its text and its definition name (grep the state texts for agent names: create-flow's start with `cf-`), every file in `references/`. For each, find its opencode target (see "Where files go") and compare: same, differs, or missing.

Done when every file has a verdict. Show the human the list before step 2.

### 2. Port

For each differing or missing file, apply the mapping row that fits it. A file with no matching row: stop and ask the human how it maps.

Done when re-running step 1 shows differences only in mapped files, and each remaining hunk is explained by a mapping row.

### 3. Generated docs

If the engine generates docs (create-flow: `node docs.mjs --write` in `C/<flow>/`), regenerate them from the opencode definition.

### 4. Verify

```bash
cd ~/.config/opencode/<flow> && node --test
<flow>-oc                            # prints the usage line
opencode debug config > /dev/null && echo "config ok"
opencode debug skill | grep '"location"'
opencode debug agent <name>          # every agent you touched
```

Done when the tests are green, the config loads, no skill location is under `~/.claude/`, and every touched agent shows its `permission` block and an empty `options`. A skill location under `~/.claude/` means `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1` is not exported in this shell: say so in the report.

### 5. Report

Tell the human what changed per file, the drift you replaced, whether `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1` still has to be exported, and that opencode must be restarted (it reads config only at startup).

## Where files go

| Claude | opencode |
|---|---|
| `skills/<flow>/SKILL.md` | `C/command/<flow>-oc.md` |
| `skills/<flow>/*` (engine, definition, tests, README, diagrams, `references/`) | `C/<flow>/` (same names; `SKILL.md` is not copied, it becomes the command above) |
| hook scripts (`gate.mjs`, `ctx.mjs`, …) and their tests | `C/plugins/<flow>.js` + `C/opencode.json` rules; hook-protocol tests are not ported |
| `agents/<name>.md` | `C/agent/<name>.md` |
| `~/.local/bin/<flow>` | `~/.local/bin/<flow>-oc` → symlink to `C/<flow>/flow.mjs`. Leave the Claude CLI alone. |

## Harness mapping

### Names

The flow is `<flow>-oc` wherever a name is seen: the definition `id`, the CLI in every text, the slash command, plugin messages and temp markers, the `opencode.json` rules, the README title. The folder `C/<flow>/` and the plugin file keep the plain name. Agent names and reference file names stay as Claude has them. Another ported flow named in a text (create-flow's last step names `build-flow`) also takes its `-oc` name. `flow-github`, the optional GitHub Issues adapter in `claude-code/adapters/github/`, is not a flow: it has no port and keeps its name.

### Engine files

Copy unchanged, except where a file names the harness:

- the definition: `id: "<flow>-oc"`; reference paths `~/.claude/skills/<flow>/references/` → `~/.config/opencode/<flow>/references/`;
- a test that reads `SKILL.md` reads `../command/<flow>-oc.md`;
- a test that matches a CLI name in the engine's output or in a state text takes the `-oc` name (create-flow: `flow.test.mjs` matches the `build-flow init` line);
- the README: see below.

### Orchestrator: skill → command

opencode skills can't turn off model invocation, so a `disable-model-invocation` skill becomes a command.

- **Frontmatter**: only `description`, with the usage folded in (`Usage - /<flow>-oc <run-folder>`). Drop `name`, `argument-hint`, `disable-model-invocation`, `hooks`.
- **Argument**: first line after the title: ``The run folder argument is: `$ARGUMENTS`. Below, `<run>` means that folder.``
- **Tools**, by Claude name → opencode wording:
  - Agent / subagent → "the task tool, with the agent named … as `subagent_type`"
  - SendMessage to an agent → keep the agent's `task_id` from its task result and continue it with the task tool; spawn a fresh one when the id is gone
  - Edit, Write, MultiEdit → "the edit or write tool"
  - Bash → bash
  - `! <cmd>` typed by the human → add "(or running it in a terminal)"
- **Guards**: "a hook asks / turns this into a permission prompt" → "a permission rule …"; "a hook denies" → "a plugin denies".

### Hooks → plugin + permission rules

opencode has no hooks in skill or command frontmatter. A plugin in `C/plugins/` runs in **every** session. Every `client.*` call returns `{ data, error }`: read the result from `.data`.

| Claude hook | opencode |
|---|---|
| PreToolUse `permissionDecision: deny` | `tool.execute.before`: `throw new Error(reason)`. Bash command in `args.command`; file path in `args.filePath` / `file_path` / `path`; `apply_patch` paths from the `*** Add/Update/Delete File:` lines of `args.patchText`. Tool names are lowercase. A regex for the CLI matches `<flow>-oc` and `<flow>/flow.mjs`: the folder keeps the plain name. |
| PreToolUse `ask` | A plugin can't ask: an `"ask"` rule in `opencode.json` `permission.bash`, one glob per asked command. A glob matches from the start of a command, so the rules see only a plain `<flow>-oc send …` command. Where Claude's gate would ask (its `send` + gate-word test) but no simple command in the line starts with `<flow>-oc send` and holds the gate word itself (the CLI by path or as `flow.mjs`, the event in a variable), the plugin denies and tells the agent to send the event as one plain `<flow>-oc send …` command. |
| PostToolUse `additionalContext` | `tool.execute.after`: append to `output.output`. |
| transcript reads (e.g. context size) | `client.session.messages({ path: { id: sessionID }, query: { limit: 20 } })`; context = `input + cache.read + cache.write` of `info.tokens` on the last assistant message where that sum is not zero (the message in progress has zero tokens until its step ends). |
| hook scoped to the skill's sessions | The plugin marks the session in `command.execute.before` when `input.command === "<flow>-oc"` (temp file `<flow>-oc-session-<sid>`) and speaks only in marked sessions. A denial that names the CLI (`init`, a gate `send`) or a file inside a run folder of this flow is silent for unrelated calls and needs no mark. One that matches any project's commands (create-flow: a bash command naming `flow.json` or `events.jsonl`) applies only in marked sessions. |

Constants (thresholds, regexes) keep Claude's values. Import the definition from `../<flow>/flow.definition.mjs` instead of copying event names.

### Agents

- **Frontmatter**: `description`, `mode: subagent`, `permission`. Drop `name`, `tools` (Claude's list doesn't load: opencode takes `permission` instead), and `model: inherit`. A named model (`model: opus`): ask the human for its opencode `provider/model` id, or drop it so the agent uses the session's model. opencode silently moves any field it doesn't know into `options`.
- **`tools` → `permission`**: no Write or Edit → `edit: deny`, else `edit: ask`; no Agent → `task: deny`; Bash commands the body runs (e.g. `pandoc`, `rm`) → `bash: "<cmd> *": allow` or leave them to the global rule; WebFetch/WebSearch keep the global rule.
- **Folders**: an agent that reads the target repo gets `external_directory` for the human's repo globs (ask the human, or read the existing port). Run folders and the flow's `references/` folder go in `opencode.json`, not the agent.
- **Body**: Claude's, with paths `~/.claude/skills/<flow>/references/` → `~/.config/opencode/<flow>/references/` "(expand `~` to the home directory)", and "messages you back" → "continues this task".

### Reference files

Copy `references/` into `C/<flow>/references/` unchanged, except a path inside a file that names `~/.claude/skills/<flow>/`: rewrite it as in the definition. The files are read by path and never loaded as skills (none is named `SKILL.md`), so their frontmatter stays as it is.

### `opencode.json` (inside `"permission"`)

The file may be `opencode.jsonc` instead: edit the one the human has, and keep its comments. Back it up first: opencode refuses to start on an invalid config. Show the human the change.

- `bash`, at the end, in this order (the last matching rule wins): `"<flow>-oc *": "allow"`, then `"deny"` for each subcommand only the human may run (create-flow: `init *`), then one `"<flow>-oc send *<EVENT>*": "ask"` per gate event. Read the gate events from the definition (events with `human: true`), not from this file. A gate word inside `--note` also prompts (a glob can't skip it): the safe side.
- `external_directory`: `"*": "ask"` plus `"allow"` for the human's run folders and for `~/.config/opencode/<flow>/references/` (the orchestrator and agents read it by path).

### README

Engine sections follow Claude's text with the CLI renamed. Harness sections are rewritten for opencode: hooks → "Guards (opencode)" (plugin denials, `ask` rules, context warning); "One-time setup" (the `C/` layout, the `<flow>-oc` symlink, the `opencode.json` snippet, per-agent permission YAML, "answer prompts with Allow once, never Allow always", the check commands); starting a run (`init` in a terminal); tests without the hook tests. No mention of Claude anywhere.
