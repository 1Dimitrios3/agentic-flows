// A minimal made-up flow for engine.test.mjs: every engine rule appears at least once. Not a real flow;
// changing build-flow's steps never touches it.
import { gate, link } from './steps.mjs';

const NOTES = 'in/NOTES.md';
const PATCH = 'out/{ticket}/all.patch';
// Where an item goes once recorded: the next one, or the gate on all of them after the last.
const afterItem = [
  { when: { more: true }, accept: PATCH, target: 'WORK' },
  { accept: PATCH, target: 'ALL_GATE' },
];

export default link({
  id: 'fixture',
  initial: 'START',
  dirs: ['in', 'out'],
  seed: { [NOTES]: '# Notes\n' },
  resume: [NOTES],
  report: 'out/{ticket}/R.md',
  artifacts: ['input/SPEC.md', 'input/tickets', NOTES, 'out/{ticket}/R.md', 'out/BRIEF.md', 'out/LOOK.md', 'out/FIX.md', 'HALT.md', 'out/REPORT.md'],

  states: {
    START: {
      actor: 'human',
      do: 'Pick the workspace for {repo}.',
      on: { GO: { target: '@next', human: true, workspace: true } },
    },

    WORK: {
      actor: 'agents',
      do: 'Work item {ticket}: {title} ({ticketFile}); blocked by {blockedBy}; built {seedReports}; AGAIN {left.AGAIN} of {max.AGAIN}.',
      on: {
        DONE_IT: {
          verified: true,
          fresh: ['out/{ticket}/R.md'],
          verdict: { file: 'out/{ticket}/R.md', is: 'OK' },
          routes: [{ when: { gate: 'ticket' }, target: '@next' }, ...afterItem],
        },
        AGAIN: { target: 'WORK', fresh: ['out/{ticket}/R.md'], verdict: { file: 'out/{ticket}/R.md', is: 'BAD' }, maxPerPass: 2, maxHint: 'give up' },
        HALT: { target: 'STOPPED', fresh: ['HALT.md'], resume: 'WORK' },
      },
    },

    ITEM_GATE: gate('Check item {ticket}.', { perTicket: true, noteTo: NOTES, approve: afterItem, reject: 'WORK' }),

    // A `do` function: the text depends on how the state was entered.
    ALL_GATE: gate((v) => `${v.via === 'APPROVE' && v.commit === 'none' ? 'Commit first. ' : ''}Check all.`, {
      noteTo: NOTES,
      approve: { target: '@next', noteTo: 'out/BRIEF.md', commitRepair: true, startReview: true },
      reject: { target: 'FIX', commitRepair: true },
    }),

    LOOK: {
      actor: 'agents',
      do: 'Look at everything.',
      on: { LOOKED: { target: '@next', archive: 'out/LOOK.md', fresh: ['out/LOOK.md'] } },
    },

    LOOK_GATE: gate('Decide ({left.REJECT} left).', {
      noteTo: NOTES,
      approve: { target: 'END', commitRepair: true },
      reject: { target: '@next', commitRepair: true, max: 2, maxHint: 'approve instead' },
    }),

    FIX: {
      actor: 'agents',
      do: 'Fix it.',
      on: {
        FIXED: {
          fresh: ['out/FIX.md'],
          verdict: { file: 'out/FIX.md', is: 'OK' },
          recordRepair: 'out/fix-{fixes}.patch',
          routes: [{ when: { reviewed: false }, target: 'ALL_GATE' }, { target: 'LOOK' }],
        },
        HALT: { target: 'STOPPED', fresh: ['HALT.md'], resume: 'FIX' },
      },
    },

    STOPPED: {
      actor: 'human',
      do: 'Stopped; resumes {resume}.',
      on: {
        RESUME: { target: '@resume', human: true, noteTo: NOTES },
        DROP: {
          human: true,
          routes: [
            { when: { resume: 'WORK' }, refuse: 'items left' },
            { when: { reviewed: false }, target: 'ALL_GATE' },
            { target: 'LOOK_GATE', requires: ['out/REPORT.md'] },
          ],
        },
      },
    },

    END: { actor: 'human', do: 'Stop.', on: {} },
  },
});
