---
name: commit-msg
description: One-line commit message for the current changes, with the ticket id.
argument-hint: "[what to emphasise]"
disable-model-invocation: true
---

Give me one commit message line for the current changes, in a code block and nothing else. I run the commit myself.

- **Changes**: the staged diff; with nothing staged, the working tree (`git diff --ignore-cr-at-eol`).
- **Shape**: `type(TICKET): summary`, e.g. `fix(ABC-123): order total ignores discount`.
- **TICKET**: the id in the branch name; a branch without one takes the id of my latest commit (`git log -5 --format=%s`) when the changes continue that work, otherwise a one-word scope such as `auth`.
- **summary**: what the change does, lowercase, the whole line 72 characters at most.

If I passed arguments, they say what the summary should emphasise.
