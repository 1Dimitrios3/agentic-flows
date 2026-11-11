import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gate, link } from './steps.mjs';

const step = (next) => ({ actor: 'agents', do: '', on: { DONE_IT: { target: next } } });
const edges = (def) =>
  Object.entries(def.states).flatMap(([from, s]) => Object.entries(s.on).map(([ev, t]) => `${from} --${ev}--> ${t.target}`));

const flow = (states) => link({ states });

test('@next and @prev point at the neighbours in the order the states are written', () => {
  const def = flow({ A: step('@next'), GATE: gate('', { noteTo: 'D.md' }), DONE: { on: {} } });
  assert.deepEqual(edges(def), ['A --DONE_IT--> GATE', 'GATE --APPROVE--> DONE', 'GATE --REJECT--> A']);
});

test('removing a step and its gate rewires the neighbours, with no other edit', () => {
  const full = { A: step('@next'), A_GATE: gate('', { noteTo: 'D.md' }), B: step('@next'), B_GATE: gate('', { noteTo: 'D.md' }), DONE: { on: {} } };
  const { B: _b, B_GATE: _g, ...without } = full;
  assert.deepEqual(edges(flow(without)), ['A --DONE_IT--> A_GATE', 'A_GATE --APPROVE--> DONE', 'A_GATE --REJECT--> A']);
});

test('named targets stay as written, so a jump of any length is a state name', () => {
  const def = flow({
    A: step('@next'),
    B: { on: { BACK_TWO: { target: 'A' }, SKIP: { target: 'DONE' } } },
    GATE: gate('', { noteTo: 'D.md', reject: 'A' }),
    DONE: { on: {} },
  });
  assert.deepEqual(edges(def).slice(1), ['B --BACK_TWO--> A', 'B --SKIP--> DONE', 'GATE --APPROVE--> DONE', 'GATE --REJECT--> A']);
});

test('a neighbour that does not exist is left as written, for the engine to refuse', () => {
  const def = flow({ A: { on: { BACK: { target: '@prev' } } }, B: { on: { ON: { target: '@next' } } } });
  assert.deepEqual(edges(def), ['A --BACK--> @prev', 'B --ON--> @next']);
});

test('gate: human APPROVE and REJECT; the note goes to noteTo on REJECT only', () => {
  const g = gate('Present it.', { noteTo: 'D.md' });
  assert.equal(g.actor, 'human');
  assert.equal(g.do, 'Present it.');
  assert.deepEqual(g.on, {
    APPROVE: { target: '@next', human: true },
    REJECT: { target: '@prev', human: true, noteTo: 'D.md' },
  });
});

test('link leaves the definition it is given unchanged', () => {
  const states = { A: step('@next'), B: { on: {} } };
  link({ states });
  assert.equal(states.A.on.DONE_IT.target, '@next');
});
