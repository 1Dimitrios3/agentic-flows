// Building blocks for a flow definition; they know nothing about any flow's steps. See README.md, "Definition format".

// A transition given as a target name, a list of routes, or a full transition object.
const transition = (x) => (typeof x === 'string' ? { target: x } : Array.isArray(x) ? { routes: x } : x);

// A human gate: APPROVE moves on, REJECT goes back with the human's note appended to noteTo.
// `approve` / `reject` are a state name ('@next' / '@prev' included), a route list, or a transition object
// carrying extra fields (another noteTo, effects). Other options are state fields (e.g. perTicket).
export function gate(present, { noteTo, approve = '@next', reject = '@prev', ...fields }) {
  return {
    ...fields,
    actor: 'human',
    do: present,
    on: {
      APPROVE: { human: true, ...transition(approve) },
      // Only when given: an undefined noteTo would still run the append effect.
      REJECT: { human: true, ...(noteTo && { noteTo }), ...transition(reject) },
    },
  };
}

// Turns '@next' / '@prev' into the state after / before, in the order the states are written, on a transition's
// target and on each of its routes. One with no state there (e.g. '@prev' on the first) is left as is; the engine
// refuses it at load. Any other target ('@resume', a name) is untouched.
export function link(def) {
  const order = Object.keys(def.states);
  const near = { '@next': 1, '@prev': -1 };
  const states = Object.fromEntries(
    order.map((name, i) => {
      const s = def.states[name];
      const to = (t) => (t.target in near ? order[i + near[t.target]] ?? t.target : t.target);
      const resolve = (t) => ('target' in t ? { ...t, target: to(t) } : t);
      const on = Object.fromEntries(
        Object.entries(s.on).map(([ev, t]) => [ev, { ...resolve(t), ...(t.routes && { routes: t.routes.map(resolve) }) }]),
      );
      return [name, { ...s, on }];
    }),
  );
  return { ...def, states };
}
