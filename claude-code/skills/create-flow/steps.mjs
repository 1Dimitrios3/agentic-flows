// Building blocks for a flow definition; they know nothing about any flow's steps. See README.md, "Definition format".

// A human gate: APPROVE moves on, REJECT goes back with the human's note appended to noteTo.
// Either can name any state instead, to jump further back or forward. Other options are state fields (e.g. onDrift).
export function gate(present, { noteTo, approve = '@next', reject = '@prev', ...fields }) {
  return {
    ...fields,
    actor: 'human',
    do: present,
    on: {
      APPROVE: { target: approve, human: true },
      // Only when given: an undefined noteTo would still run the append effect.
      REJECT: { target: reject, human: true, ...(noteTo && { noteTo }) },
    },
  };
}

// Turns '@next' / '@prev' into the state after / before, in the order the states are written.
// One with no state there (e.g. '@prev' on the first) is left as is; the engine refuses it at load.
export function link(def) {
  const order = Object.keys(def.states);
  const near = { '@next': 1, '@prev': -1 };
  const states = Object.fromEntries(
    order.map((name, i) => {
      const s = def.states[name];
      const on = Object.fromEntries(
        Object.entries(s.on).map(([ev, t]) => {
          const to = t.target in near ? order[i + near[t.target]] : t.target;
          return [ev, { ...t, target: to ?? t.target }];
        }),
      );
      return [name, { ...s, on }];
    }),
  );
  return { ...def, states };
}
