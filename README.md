# agentic-flows

Two agentic workflows that take a feature from raw inputs to reviewed code, with a human approving each step that matters.

- **create-flow**: from raw inputs (an SRS, mocks, screenshots, live pages, plain text) to an approved SPEC and a set of implementation tickets.
- **build-flow**: from a SPEC and its tickets to code in your repo, one ticket at a time in blocker order, finished by one clean-room code review.

```
raw inputs ──▶ create-flow ──▶ SPEC + tickets ──▶ build-flow ──▶ reviewed code in your repo
```

They work well in sequence, since create-flow's output is build-flow's input, but each one stands alone.

Each flow is a state machine driven by a small Node CLI. The agent does the work and the engine decides what comes next. All of a run's state lives in a folder you choose, so a run can be resumed from any session.

## Pick your tool

| Tool | Folder | Status |
|---|---|---|
| [Claude Code](https://claude.com/claude-code) | [`claude-code/`](claude-code/README.md) | Available |

Each tool's folder has its own install steps and quick start.

## License

[MIT](LICENSE). Some reference files are adapted from [mattpocock/skills](https://github.com/mattpocock/skills) under the MIT License; see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
