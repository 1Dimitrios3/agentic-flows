// Format: see README.md. States run in the order written: '@next' / '@prev' point at the neighbour.
import { gate, link } from "./steps.mjs";

const DECISIONS = "understanding/DECISIONS.md";
const REQUIREMENTS = "discovery/REQUIREMENTS.md";
const CODEBASE = "discovery/CODEBASE.md";

// How the two discovery agents are briefed, on the first pass and on a refresh.
const BRIEF = `Brief cf-requirements-analyst with the run folder;
brief cf-codebase-explorer with the run folder, the target repo and a one-paragraph description of the feature.`;

// Facts neither the sources nor the repo hold; the file must be indexed before cf-requirements-analyst starts.
const RESEARCH = `When the feature depends on facts that neither sources/ nor the target repo holds (a third-party API, a library's docs, a standard),
tell the human what will be looked up, then spawn cf-researcher with the run folder, the questions and a topic name. It writes research-<topic>.md in sources/.
List that file in sources/INDEX.md before spawning cf-requirements-analyst, which reads every source listed there.`;

export default link({
  id: "create-flow",
  initial: "INTAKE",

  // Folders init creates in the run folder; the engine adds handoffs/ itself.
  dirs: ["sources", "discovery", "understanding/adr", "spec", "tickets"],

  // What a resuming orchestrator reads after the newest handoff, in order; status lists the ones that exist.
  resume: ["understanding/UNDERSTANDING.md", DECISIONS],

  artifacts: [
    "sources/INDEX.md",
    "discovery/REQUIREMENTS.md",
    "discovery/CODEBASE.md",
    "understanding/UNDERSTANDING.md",
    "understanding/OPEN-QUESTIONS.md",
    "understanding/DECISIONS.md",
    "understanding/GLOSSARY.md",
    "understanding/adr",
    "spec/SPEC.md",
    "tickets",
  ],

  states: {
    INTAKE: {
      actor: "orchestrator",
      do: `Collect every input source from the human: SRS documents, raw text, Figma exports, screenshots, pages to inspect.
Copy files into sources/ or record their path/URL. For a page, read ~/.claude/skills/create-flow/references/inspect-page.md and follow it with the human, and save its report into sources/, along with the raw JSON response
of each data request the area makes (list_network_requests, get_network_request), one file per request, and any form markup that holds its field rules.
List every source in sources/INDEX.md: path or URL, type, one-line purpose.
Ask the human whether the list is complete before sending SOURCES_REGISTERED.`,
      on: {
        SOURCES_REGISTERED: { target: "@next", requires: ["sources/INDEX.md"] },
      },
    },

    DISCOVERY: {
      actor: "agents",
      do: `${RESEARCH}
Spawn cf-requirements-analyst and cf-codebase-explorer in parallel. ${BRIEF}
They write discovery/REQUIREMENTS.md and discovery/CODEBASE.md. Read only the summaries they return.`,
      on: {
        DISCOVERY_DONE: {
          target: "SYNTHESIS",
          fresh: [REQUIREMENTS, CODEBASE],
          baseline: { cites: CODEBASE },
        },
      },
    },

    // The refresh pass: only the report the open questions need is rewritten.
    REDISCOVERY: {
      actor: "agents",
      do: `Sort the open "- [ ]" items in understanding/OPEN-QUESTIONS.md: what the feature must do is answered by the sources (cf-requirements-analyst);
where and how the code does it, by the target repo (cf-codebase-explorer); an item you can't place goes to both.
An item only an outside source can answer is researched first and then goes to cf-requirements-analyst. ${RESEARCH}
Tell the human which agent runs and for which items. Spawn only an agent that has items, both in parallel when both do. ${BRIEF}
Give each its items. Each rewrites its own report in full: discovery/REQUIREMENTS.md or discovery/CODEBASE.md. Read only the summaries they return.
Send the event for what was rewritten: DISCOVERY_REFRESHED for both reports, CODEBASE_REFRESHED or REQUIREMENTS_REFRESHED for one.`,
      onDrift: `The drift line clears only once cf-codebase-explorer has reread the repo: REQUIREMENTS_REFRESHED keeps the old baseline.`,
      on: {
        DISCOVERY_REFRESHED: {
          target: "@next",
          fresh: [REQUIREMENTS, CODEBASE],
          baseline: { cites: CODEBASE },
        },
        CODEBASE_REFRESHED: {
          target: "@next",
          fresh: [CODEBASE],
          baseline: { cites: CODEBASE },
        },
        // No baseline: the code report still describes the commit it was read at.
        REQUIREMENTS_REFRESHED: { target: "@next", fresh: [REQUIREMENTS] },
      },
    },

    SYNTHESIS: {
      actor: "orchestrator",
      do: `Read both discovery reports in full. Write understanding/UNDERSTANDING.md: what will be built, in the target codebase's terms, citing sources.
Write understanding/OPEN-QUESTIONS.md with one "- [ ] " line per unresolved question. Keep only questions whose answer
changes what gets built or how it is tested; process details (ticket ids, branch or commit naming) stay out.
A choice between options (e.g. which codebase pattern to follow) is a question with your recommendation, never decided here or Dropped.
Done when every "- [ ]" in both discovery reports is accounted for: carried over, merged into another line (note which),
or listed under "## Dropped" as a plain "- " line with a one-line reason. A question only an external source can answer is carried over
with "(awaits: <source>)", so the human can defer it when the questions are put to them.`,
      on: {
        SYNTHESIZED: {
          target: "@next",
          fresh: ["understanding/UNDERSTANDING.md"],
          requires: ["understanding/OPEN-QUESTIONS.md"],
        },
      },
    },

    CLARIFY: {
      actor: "orchestrator",
      do: `Read ~/.claude/skills/create-flow/references/grilling.md and ~/.claude/skills/create-flow/references/domain-modeling/domain-modeling.md
in full and follow them together over understanding/OPEN-QUESTIONS.md (they are reference files, not invocable skills).
The glossary goes to understanding/GLOSSARY.md, ADRs to understanding/adr/ (in the run folder, not the target repo).
Each recommendation you give cites its evidence (path:line or source), or is marked "(guess)".
After EACH answer: append it to understanding/DECISIONS.md, update understanding/UNDERSTANDING.md, mark the question
"- [x]" (answered) or "- [-]" (deferred by the human).
If an answer needs new evidence, including one that sends you to look ("inspect X"), keep it "- [ ]" until you have it:
for a page, follow ~/.claude/skills/create-flow/references/inspect-page.md with the human, save its report and the raw JSON of each data request into sources/, and list each new file
in sources/INDEX.md; otherwise add the gap as a "- [ ]" item.
A discovery round is the human's call. Before NEEDS_MORE_DISCOVERY, show them one line per item that needs it: what is missing,
what the reports say about it now (quoted with its path:line or source, or "nothing"), and whether the sources or the code would answer it.
Send it only on their go-ahead, with their words as --note; if they decline, answer or defer the item with them instead.`,
      onDrift: `Refreshing discovery is the human's call: on their go-ahead, send NEEDS_MORE_DISCOVERY.`,
      on: {
        // A jump two states back, so it names its state.
        NEEDS_MORE_DISCOVERY: {
          target: "REDISCOVERY",
          // A permission prompt: the round starts only if the human accepts the command.
          human: true,
          max: 10,
          maxHint: "answer or defer (- [-]) the open questions with the human",
        },
        CLARIFIED: {
          target: "@next",
          fresh: [
            "understanding/DECISIONS.md",
            "understanding/UNDERSTANDING.md",
          ],
          requires: ["understanding/GLOSSARY.md"],
          clear: ["understanding/OPEN-QUESTIONS.md"],
        },
      },
    },

    UNDERSTANDING_GATE: gate(
      `Present understanding/UNDERSTANDING.md, the decisions taken and any deferred "- [-]" questions.
Ask the human whether this is enough to write the spec. Send APPROVE or REJECT with their words as --note.`,
      {
        noteTo: DECISIONS,
        onDrift: `Refreshing discovery is the human's call: it takes a REJECT back to CLARIFY first, then NEEDS_MORE_DISCOVERY there.`,
      },
    ),

    SPEC_DRAFTING: {
      actor: "agents",
      do: `Spawn cf-spec-writer. Brief it with the target repo, the run folder, the output path spec/SPEC.md and, after a REJECT,
the human's note.
Confirm the test seams and open questions it returns with the human; wait for any rewrite before sending SPEC_DRAFTED.
Any other change to the spec waits for the human's review that follows.`,
      on: {
        SPEC_DRAFTED: { target: "@next", fresh: ["spec/SPEC.md"] },
      },
    },

    SPEC_GATE: gate(
      `Present the spec from the cf-spec-writer's summary, without reading spec/SPEC.md yourself; point the human to the file to read in full.
Ask them to approve it or say what to change. Send APPROVE or REJECT with their words as --note.`,
      { noteTo: DECISIONS },
    ),

    TICKETING: {
      actor: "agents",
      do: `Spawn cf-ticket-writer. Brief it with the target repo, the run folder, the output folder tickets/
and, after a REJECT, the human's note.`,
      on: {
        TICKETS_DRAFTED: { target: "@next", fresh: ["tickets"] },
      },
    },

    TICKETS_GATE: gate(
      `Give the human one overview of all tickets: a table with number, title, one-line scope and "blocked by"
(copied from each ticket file's Blocked by, never inferred), then the dependency order (e.g. 01 → 02 → {03, 04}). Point them to the ticket files in tickets/ to read in full,
and ask for one verdict on the whole set: APPROVE, or REJECT with what to change as --note.`,
      { noteTo: DECISIONS },
    ),

    DONE: {
      actor: "human",
      do: `The run is finished: the tickets in tickets/ are approved. Tell the human the path and the ticket order.

Then give them the build-flow command for them to type, since only the human creates a build run. Fill in <run> and <target> from the Run and Target lines of create-flow status. Leave every other placeholder exactly as written, and pick no option for them:

  ! build-flow init <build-folder> --repo <target> --spec <run>/spec/SPEC.md --tickets <run>/tickets --gate <ticket|end> [--commit <ticket|none>]

Below it, explain only what they must choose, one line each:
- <build-folder>: a new folder for the build run, outside the target repo.
- --gate: ticket = approve each ticket as it is built; end = review the whole build once, after the last ticket.
- --commit (optional): ticket = build-flow commits each ticket (default); none = they commit themselves.

Then stop. Building is build-flow's job, not this run's: do not run build-flow yourself, and do not offer to implement, branch or commit.`,
      on: {},
    },
  },
});
