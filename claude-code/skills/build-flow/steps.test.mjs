import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gate, link } from './steps.mjs';

test('link resolves @next and @prev by the written order, on transitions and on routes', () => {
  const d = link({
    states: {
      A: { on: { GO: { target: '@next' }, BACK: { target: '@prev' } } },
      B: { on: { GO: { routes: [{ when: { more: true }, target: '@prev' }, { target: '@next' }] }, JUMP: { target: 'A' }, OUT: { target: '@resume' } } },
      C: { on: { GO: { target: '@next' } } },
    },
  });
  assert.equal(d.states.A.on.GO.target, 'B');
  assert.equal(d.states.A.on.BACK.target, '@prev', 'nothing before the first: left for the engine to refuse');
  assert.deepEqual(d.states.B.on.GO.routes.map((r) => r.target), ['A', 'C']);
  assert.equal(d.states.B.on.JUMP.target, 'A', 'a name is untouched');
  assert.equal(d.states.B.on.OUT.target, '@resume', '@resume is the engine\'s');
  assert.equal(d.states.C.on.GO.target, '@next', 'nothing after the last');
});

test('gate builds a human state whose REJECT appends the note', () => {
  const g = gate('Present.', { noteTo: 'N.md' });
  assert.equal(g.actor, 'human');
  assert.equal(g.do, 'Present.');
  assert.deepEqual(g.on.APPROVE, { human: true, target: '@next' });
  assert.deepEqual(g.on.REJECT, { human: true, noteTo: 'N.md', target: '@prev' });
});

test('gate takes a name, a route list or a transition object for each event, and passes other fields to the state', () => {
  const routes = [{ when: { more: true }, target: 'X' }, { target: 'Y' }];
  const g = gate((v) => `Check ${v.ticket}.`, {
    perTicket: true,
    approve: routes,
    reject: { target: 'Z', commitRepair: true, noteTo: 'OTHER.md' },
  });
  assert.equal(g.perTicket, true);
  assert.equal(typeof g.do, 'function');
  assert.deepEqual(g.on.APPROVE, { human: true, routes });
  assert.deepEqual(g.on.REJECT, { human: true, target: 'Z', commitRepair: true, noteTo: 'OTHER.md' }, 'the event\'s own noteTo wins');
  assert.deepEqual(gate('P.', {}).on.REJECT, { human: true, target: '@prev' }, 'no noteTo, no append');
});
