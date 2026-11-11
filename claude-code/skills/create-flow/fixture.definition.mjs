// A minimal made-up flow for engine.test.mjs: every engine rule appears at least once. Not a real flow;
// changing create-flow's steps never touches it.
import { gate, link } from './steps.mjs';

const NOTES = 'in/NOTES.md';

export default link({
  id: 'fixture',
  initial: 'START',
  dirs: ['in', 'out', 'items'],
  resume: [NOTES, 'in/LIST.md'],
  artifacts: ['in/LIST.md', NOTES, 'in/GLOSS.md', 'out/A.md', 'out/B.md', 'items'],

  states: {
    START: {
      actor: 'orchestrator',
      do: 'Write the list.',
      // AGAIN here shares its name with CHECK's limited AGAIN: each state has its own count.
      on: { GO: { target: '@next', requires: ['in/LIST.md'] }, AGAIN: { target: 'START' } },
    },

    WORK: {
      actor: 'agents',
      do: 'Write both reports.',
      on: { DONE_IT: { target: '@next', fresh: ['out/A.md', 'out/B.md'], baseline: { cites: 'out/A.md' } } },
    },

    CHECK: {
      actor: 'orchestrator',
      do: 'Check the list.',
      onDrift: 'Send AGAIN to redo the work.',
      on: {
        AGAIN: { target: 'WORK', max: 2, maxHint: 'finish the list instead' },
        // fresh before requires on purpose: blockers still print in the engine's order.
        CHECKED: { target: '@next', fresh: [NOTES], requires: ['in/GLOSS.md'], clear: ['in/LIST.md'] },
      },
    },

    // No onDrift: a way back to WORK exists (REJECT, then AGAIN), so drift prints no extra line here.
    REVIEW: gate('Present the check.', { noteTo: NOTES }),

    // No path leads back to WORK from here on: the engine prints its "No way back" line.
    BUILD: {
      actor: 'agents',
      do: 'Build the items.',
      on: { BUILT: { target: '@next', fresh: ['items'] } },
    },

    BUILD_GATE: gate('Present the items.', { noteTo: NOTES }),

    END: { actor: 'human', do: 'Stop.', on: {} },
  },
});
