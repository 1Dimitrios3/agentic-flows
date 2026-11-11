#!/usr/bin/env node
// Generates the events table in README.md and the diagram in LOGICAL-DIAGRAM.md from flow.definition.mjs.
// node docs.mjs prints both blocks; node docs.mjs --write replaces them between the markers in place.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import def from './flow.definition.mjs';

export const START = '<!-- generated from flow.definition.mjs by docs.mjs: edit the definition, then run node docs.mjs --write -->';
export const END = '<!-- end generated -->';

const ACTOR_COLOURS = {
  orchestrator: 'fill:#1f4e8c,stroke:#0d2c55,stroke-width:2px,color:#ffffff',
  agents: 'fill:#1e7a46,stroke:#0f4a29,stroke-width:2px,color:#ffffff',
  human: 'fill:#b3261e,stroke:#6e1611,stroke-width:2px,color:#ffffff',
};

const transitions = (d) =>
  Object.entries(d.states).flatMap(([from, s]) => Object.entries(s.on).map(([ev, t]) => ({ from, ev, t })));

// The table's full wording and the diagram's short one, per guard.
const LONG = {
  max: (n) => `sent fewer than ${n} times in the run`,
  requires: (f) => `\`${f}\` exists`,
  fresh: (f) => `\`${f}\` rewritten in this state`,
  clear: (f) => `no open \`- [ ]\` in \`${f}\``,
};
const SHORT = {
  max: (n) => `at most ${n} times per run`,
  requires: (f) => path.posix.basename(f),
  fresh: (f) => `${path.posix.basename(f)} rewritten`,
  clear: (f) => `${path.posix.basename(f)} has no open question`,
};

// What must be true before the event, in the engine's guard order.
function guards(t, words) {
  return [
    ...('max' in t ? [words.max(t.max)] : []),
    ...(t.requires ?? []).map(words.requires),
    ...(t.fresh ?? []).map(words.fresh),
    ...(t.clear ?? []).map(words.clear),
  ];
}

// What the engine does on the move, in its effect order.
function effects(t) {
  return [
    ...(t.baseline ? [`records the target's HEAD as the baseline (drift checks \`${t.baseline.cites}\`)`] : []),
    ...(t.noteTo ? [`appends the note to \`${t.noteTo}\``] : []),
  ];
}

export function table(d) {
  const rows = transitions(d).map(({ from, ev, t }) => {
    const ready = [...(t.human ? ['human gate'] : []), ...guards(t, LONG)];
    return `| ${from} | \`${ev}\` | ${t.target} | ${ready.join('; ') || 'always'} | ${effects(t).join('; ') || '—'} |`;
  });
  return ['| State | Event | Goes to | Ready when | On the move |', '|---|---|---|---|---|', ...rows].join('\n');
}

export function diagram(d) {
  const lines = ['```mermaid', 'stateDiagram-v2', '    direction TB', '', `    [*] --> ${d.initial}: ${d.id} init (human)`];
  for (const [from, s] of Object.entries(d.states)) {
    const on = Object.entries(s.on);
    lines.push('');
    if (!on.length) lines.push(`    ${from} --> [*]`);
    for (const [ev, t] of on) {
      // A red state is a gate already; the label marks a human event leaving any other state.
      const asks = t.human && s.actor !== 'human' ? ['human gate'] : [];
      const g = [...asks, ...guards(t, SHORT), ...(t.baseline ? ['records HEAD'] : [])];
      lines.push(`    ${from} --> ${t.target}: ${ev}${g.length ? ` [${g.join(', ')}]` : ''}`);
    }
  }
  lines.push('');
  for (const [actor, style] of Object.entries(ACTOR_COLOURS)) lines.push(`    classDef ${actor} ${style}`);
  lines.push('');
  for (const actor of Object.keys(ACTOR_COLOURS)) {
    const names = Object.keys(d.states).filter((n) => d.states[n].actor === actor);
    if (names.length) lines.push(`    class ${names.join(',')} ${actor}`);
  }
  lines.push('```');
  return lines.join('\n');
}

export const blocks = (d) => ({ 'README.md': table(d), 'LOGICAL-DIAGRAM.md': diagram(d) });

// The text between the markers, or null when a marker is missing.
export function current(doc) {
  const a = doc.indexOf(START);
  const b = doc.indexOf(END, a);
  return a < 0 || b < 0 ? null : doc.slice(a + START.length, b).trim();
}

export function splice(doc, block) {
  const a = doc.indexOf(START);
  const b = doc.indexOf(END, a);
  if (a < 0 || b < 0) throw new Error('generated-block markers not found');
  return `${doc.slice(0, a + START.length)}\n${block}\n${doc.slice(b)}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const write = process.argv.includes('--write');
  for (const [file, block] of Object.entries(blocks(def))) {
    const f = path.join(import.meta.dirname, file);
    if (!write) {
      console.log(`=== ${file}\n${block}\n`);
      continue;
    }
    const doc = fs.readFileSync(f, 'utf8');
    const next = splice(doc, block);
    fs.writeFileSync(f, next);
    console.log(`${file}: ${next === doc ? 'unchanged' : 'updated'}`);
  }
}
