# flow-github

An optional adapter that moves a spec and its tickets between files and GitHub issues. The flows are folder-first and don't need it: use it only if you want your spec and tickets on GitHub. It runs before or after a flow, never during one, and you run it yourself: neither engine calls it. When it's linked, create-flow's last step reminds you of the `export` command.

- **`export`**: after create-flow, publish its approved spec and tickets as issues.
- **`import`**: before build-flow, pull a spec and tickets from issues into files for `build-flow init`.

Each direction takes `--spec`, `--tickets` or both, the same pair `build-flow init` takes.

It talks to GitHub only through the [GitHub CLI](https://cli.github.com), so `gh` must be installed and signed in (`gh auth status`). It isn't installed by default. To link it as `flow-github` next to the other CLIs, run `./install.sh --with-github` from `claude-code/`.

## On GitHub

| File | Issue |
|---|---|
| `SPEC.md` | One issue titled `Spec: <the spec's # title>`. The body is the spec, after a hidden `<!-- flow-github: spec -->` marker that identifies it as a spec. |
| Each ticket | One issue titled with the ticket's `# title`, without its number. The body is the ticket, with `## Blocked by` rewritten as issue references (`- #12 Add the schema`) and, when a spec was exported, a last line `Spec: #N`. |

A title is the file's first `# ` heading outside code blocks. Without one, the spec takes its file name and a ticket its slug, as in build-flow.

Labels and a milestone apply to every issue, the spec's included.

## export

```
flow-github export --repo <owner/name> [--spec <SPEC.md>] [--tickets <dir>] [--label <a,b>] [--milestone <title>] [--dry-run]
```

- **Checks everything before creating anything.** The tickets are validated with build-flow's own parser (`skills/build-flow/queue.mjs`), so it refuses anything build-flow would refuse. A spec or ticket too long for an issue body (65,536 characters) is refused too.
- **Creates the spec first,** so every ticket can point to it, then the tickets in blocker order, so every blocker's issue exists before the tickets it blocks.
- **Labels:** `--label` adds labels to every issue, and creates any that are missing. Label names match as on GitHub, without regard to case. `--milestone` sets a milestone, which must already exist.
- **Saves `github-issues.json`,** mapping the spec and each ticket to its issue. It lives in the tickets folder, or next to the spec when you export the spec alone. When you export both, the spec's entry is kept in both places, so the spec is published once whether you also export it alone before or after. It's written after every issue, so a re-run creates only what's missing: no duplicates, and a failed run picks up where it stopped. build-flow ignores the file.
- **Never edits an existing issue.** To publish a changed spec or ticket, edit its issue on GitHub, or remove its entry from the map to create a new one.
- **`--dry-run`** prints what would be created and calls GitHub not at all.

## import

```
flow-github import --repo <owner/name> --spec <SPEC.md> --tickets <dir> --label <a,b> [--milestone <title>]
flow-github import --repo <owner/name> --tickets <dir> --issues <n,n,...>
flow-github import --repo <owner/name> --spec <SPEC.md> --spec-issue <n>
```

- **Selects tickets** by labels (all must match) and/or milestone, open issues only, or by an explicit list of numbers. Importing tickets needs a selector, so it never pulls a whole repo. Spec issues are never imported as tickets, even when a label selects them; neither is the issue named with `--spec-issue`.
- **Finds the spec** from `--spec-issue <n>`; else from the `Spec: #N` line the selected tickets share; else from the one spec issue the selection holds. If the tickets point to more than one spec, it asks for `--spec-issue`.
- **Writes the spec** to `--spec <file>`, which must not exist yet, with `Spec: ` dropped from its title.
- **Writes the tickets** as `<issue#>-<slug>.md` into `--tickets <dir>`, which must be new or empty. The issue number is the ticket number, so build-flow's queue reads `- #12` blockers as is. The `Spec: #N` line is dropped from each file.
- **Blockers:**
  - a blocker in the selection is kept;
  - a **closed** blocker is treated as done and dropped, and it says so;
  - an **open** blocker that isn't selected stops the import before anything is written. Select it too, or close it.
- **Writes all or nothing.** The tickets are validated with build-flow's parser before the spec is written. If any issue lacks a required section, it removes what it wrote and names the issue to fix on GitHub.
- **Prints the build order** and the `build-flow init` command to run next.

### Issues written by hand

A ticket issue becomes a valid ticket when its body has the three sections build-flow requires: `## What to build`, `## Acceptance criteria` and `## Blocked by`. `export` always produces them. Write blockers as issue references (`- #12`) or `None`; a bare number is read as an issue number too.

Any issue can serve as a spec with `--spec-issue <n>`, marker or not.

## End to end

```
# 1. Plan: create-flow produces <create-run>/spec/SPEC.md and <create-run>/tickets
flow-github export --repo <owner/name> --spec <create-run>/spec/SPEC.md --tickets <create-run>/tickets --label <feature> --dry-run
flow-github export --repo <owner/name> --spec <create-run>/spec/SPEC.md --tickets <create-run>/tickets --label <feature>

# 2. The team reviews, edits, re-orders or closes issues on GitHub.

# 3. Build: pull the spec and what's open into new files
flow-github import --repo <owner/name> --spec <plan>/SPEC.md --tickets <plan>/tickets --label <feature>
build-flow init <build-run> --repo <repo> --spec <plan>/SPEC.md --tickets <plan>/tickets --gate ticket
```

`<plan>` is any new folder for the imported files.

Not covered yet: build-flow doesn't update the issues as it builds (no comments, no closing). Close them yourself, or by putting `Closes #N` in the commit or PR.

## Tests

```
node --test
```

The tests run against `fake-gh.mjs`, a stand-in for `gh` that keeps issues in a temp file: no network, no real GitHub.
