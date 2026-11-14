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

// One row per route: a routed event is listed once per route, each with its condition.
const branches = (t) => (t.routes ? t.routes.map((r) => ({ ...t, ...r, routes: undefined })) : [t]);
const transitions = (d) =>
  Object.entries(d.states).flatMap(([from, s]) => Object.entries(s.on).flatMap(([ev, t]) => branches(t).map((b) => ({ from, ev, b }))));

// The states an escalation can resume: '@resume' leads to one of them.
const resumes = (d) => [...new Set(transitions(d).map(({ b }) => b.resume).filter(Boolean))];

// Plain words for a route condition.
const WHEN = {
  gate: (v) => `gate \`${v}\``,
  more: (v) => (v ? 'more tickets' : 'last ticket'),
  reviewed: (v) => (v ? 'after a review' : 'before any review'),
  resume: (v) => `the escalation resumes ${v}`,
  worktree: (v) => `worktree \`${v}\``,
};
const conditions = (b) => Object.entries(b.when ?? {}).map(([k, v]) => (WHEN[k] ?? ((x) => `${k} = ${x}`))(v));

// The table's full wording and the diagram's short one, per guard.
const LONG = {
  max: (n) => `at most ${n} times per run`,
  maxPerPass: (n) => `at most ${n} times per pass`,
  requires: (f) => `\`${f}\` exists`,
  fresh: (f) => `\`${f}\` rewritten`,
  verdict: ({ file, is }) => `\`${path.posix.basename(file)}\` says \`Verdict: ${is}\``,
  section: ({ file, heading }) => `\`${path.posix.basename(file)}\` has a non-empty \`## ${heading}\``,
};
const SHORT = {
  max: (n) => `at most ${n} times per run`,
  maxPerPass: (n) => `at most ${n} times per pass`,
  requires: (f) => path.posix.basename(f),
  fresh: (f) => `${path.posix.basename(f)} rewritten`,
  verdict: ({ file, is }) => `${path.posix.basename(file)} says ${is}`,
  section: ({ file, heading }) => `${path.posix.basename(file)} has ${heading}`,
};

// What must be true before the event, in the engine's guard order.
function guards(b, words) {
  return [
    ...('max' in b ? [words.max(b.max)] : []),
    ...('maxPerPass' in b ? [words.maxPerPass(b.maxPerPass)] : []),
    ...(b.requires ?? []).map(words.requires),
    ...(b.fresh ?? []).map(words.fresh),
    ...(b.verdict ? [words.verdict(b.verdict)] : []),
    ...(b.section ? [words.section(b.section)] : []),
  ];
}

// What the engine does on the move, in its effect order.
function effects(b) {
  return [
    ...(b.workspace === 'new' ? ['checks the target is a new worktree, not the repo itself'] : []),
    ...(b.workspace ? ['records the target, branch, source, base and commit scope'] : []),
    ...(b.verified ? ['records the verified tree'] : []),
    ...(b.accept ? [`records the ticket (commit, or \`${b.accept}\`)`] : []),
    ...(b.acceptPatch ? [`records the ticket (\`${b.acceptPatch}\`; the commit is the human's)`] : []),
    ...(b.startReview ? ['marks the review started'] : []),
    ...(b.archive ? [`archives ${[b.archive].flat().map((f) => `\`${f}\``).join(', ')} per round`] : []),
    ...(b.recordRepair ? [`saves the repair as \`${b.recordRepair}\``] : []),
    ...(b.commitRepair ? ['commits a pending repair'] : []),
    ...(b.noteTo ? [`appends the note to \`${b.noteTo}\``] : []),
    ...(b.resume ? [`CONTINUE returns to ${b.resume}`] : []),
  ];
}

const gateWords = (b) => {
  if (b.human) return [`human gate${b.workspace ? ' with `--target`, `--branch`, (for a worktree) `--source` and (with a ticket id) `--scope`' : ''}`];
  // The agent's own pick: the ticket id came with init.
  return b.workspace === 'new' ? ['no gate; with `--target`, `--branch` and `--source`'] : [];
};

export function table(d) {
  const rows = transitions(d).map(({ from, ev, b }) => {
    const ready = [...gateWords(b), ...conditions(b), ...guards(b, LONG)];
    if (b.refuse) return `| ${from} | \`${ev}\` | — | refused: ${conditions(b).join(', ')}: ${b.refuse} | — |`;
    const to = b.target === '@resume' ? `${resumes(d).join(' or ')} (the state the escalation resumes)` : b.target;
    return `| ${from} | \`${ev}\` | ${to} | ${ready.join('; ') || 'always'} | ${effects(b).join('; ') || '—'} |`;
  });
  return ['| State | Event | Goes to | Ready when / route | On the move |', '|---|---|---|---|---|', ...rows].join('\n');
}

export function diagram(d) {
  // `initial` is a state name or a list of routes: one arrow per route, with its condition.
  const initial = Array.isArray(d.initial) ? d.initial : [{ target: d.initial }];
  const lines = ['```mermaid', 'stateDiagram-v2', '    direction TB', ''];
  for (const r of initial) {
    const g = conditions(r);
    lines.push(`    [*] --> ${r.target}: ${d.id} init (human)${g.length ? ` [${g.join(', ')}]` : ''}`);
  }
  for (const [from, s] of Object.entries(d.states)) {
    const on = Object.entries(s.on);
    lines.push('');
    if (!on.length) lines.push(`    ${from} --> [*]`);
    for (const [ev, t] of on)
      for (const b of branches(t)) {
        if (b.refuse) continue; // a refusal moves nowhere
        const g = [...conditions(b), ...guards(b, SHORT)];
        const targets = b.target === '@resume' ? resumes(d) : [b.target];
        for (const to of targets) lines.push(`    ${from} --> ${to}: ${ev}${g.length ? ` [${g.join(', ')}]` : ''}`);
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
