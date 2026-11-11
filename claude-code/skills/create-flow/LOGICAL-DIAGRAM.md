# create-flow: logical diagram

The state machine in `flow.definition.mjs`, drawn as a diagram. Boxes are states, arrows are events (the `<EVENT>` of `create-flow send`), and the text in brackets is what has to be true before the event is ready. `flow.definition.mjs` is the source of truth. The diagram is generated from it: after changing the definition, run `node docs.mjs --write` (the tests fail until you do).

<!-- generated from flow.definition.mjs by docs.mjs: edit the definition, then run node docs.mjs --write -->
```mermaid
stateDiagram-v2
    direction TB

    [*] --> INTAKE: create-flow init (human)

    INTAKE --> DISCOVERY: SOURCES_REGISTERED [INDEX.md]

    DISCOVERY --> SYNTHESIS: DISCOVERY_DONE [REQUIREMENTS.md rewritten, CODEBASE.md rewritten, records HEAD]

    REDISCOVERY --> SYNTHESIS: DISCOVERY_REFRESHED [REQUIREMENTS.md rewritten, CODEBASE.md rewritten, records HEAD]
    REDISCOVERY --> SYNTHESIS: CODEBASE_REFRESHED [CODEBASE.md rewritten, records HEAD]
    REDISCOVERY --> SYNTHESIS: REQUIREMENTS_REFRESHED [REQUIREMENTS.md rewritten]

    SYNTHESIS --> CLARIFY: SYNTHESIZED [OPEN-QUESTIONS.md, UNDERSTANDING.md rewritten]

    CLARIFY --> REDISCOVERY: NEEDS_MORE_DISCOVERY [human gate, at most 10 times per run]
    CLARIFY --> UNDERSTANDING_GATE: CLARIFIED [GLOSSARY.md, DECISIONS.md rewritten, UNDERSTANDING.md rewritten, OPEN-QUESTIONS.md has no open question]

    UNDERSTANDING_GATE --> SPEC_DRAFTING: APPROVE
    UNDERSTANDING_GATE --> CLARIFY: REJECT

    SPEC_DRAFTING --> SPEC_GATE: SPEC_DRAFTED [SPEC.md rewritten]

    SPEC_GATE --> TICKETING: APPROVE
    SPEC_GATE --> SPEC_DRAFTING: REJECT

    TICKETING --> TICKETS_GATE: TICKETS_DRAFTED [tickets rewritten]

    TICKETS_GATE --> DONE: APPROVE
    TICKETS_GATE --> TICKETING: REJECT

    DONE --> [*]

    classDef orchestrator fill:#1f4e8c,stroke:#0d2c55,stroke-width:2px,color:#ffffff
    classDef agents fill:#1e7a46,stroke:#0f4a29,stroke-width:2px,color:#ffffff
    classDef human fill:#b3261e,stroke:#6e1611,stroke-width:2px,color:#ffffff

    class INTAKE,SYNTHESIS,CLARIFY orchestrator
    class DISCOVERY,REDISCOVERY,SPEC_DRAFTING,TICKETING agents
    class UNDERSTANDING_GATE,SPEC_GATE,TICKETS_GATE,DONE human
```
<!-- end generated -->

## Legend

| Colour | Actor | Who sends the event |
|---|---|---|
| Blue | orchestrator: works with the human in the main session | the orchestrator |
| Green | agents: subagents write the reports, spec or tickets | the orchestrator, once they return |
| Red | human: a gate | the orchestrator, with the human's verdict as `--note`, and only once the human accepts the permission prompt |

## Reading the loops

- **REJECT** sends the run back one step to the state that produced the work, with the human's note. The work has to be rewritten there before the event can be sent again.
- **NEEDS_MORE_DISCOVERY** goes from CLARIFY to REDISCOVERY when an answer needs evidence the reports don't have, and only once the human accepts the permission prompt. Only the report the open questions need is rewritten, and the event sent from REDISCOVERY says which: both, the code report or the requirements report. After 10 rounds in a run the engine refuses it, so the remaining questions are answered or deferred with the human.
