// Tests flow-github against fake-gh.mjs: no network, no real GitHub. Run with: node --test
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { orderQueue, readTickets } from '../../skills/build-flow/queue.mjs';

const HERE = import.meta.dirname;
const CLI = path.join(HERE, 'github.mjs');
const FAKE = path.join(HERE, 'fake-gh.mjs');
const REPO = 'acme/app';
const MARK = '<!-- flow-github: spec -->';
fs.chmodSync(FAKE, 0o755);

const SPEC = '# Export to CSV\n\n## Problem\nUsers need their data.\n\n## Solution\nA CSV export.\n';
const TICKETS = {
  '01-schema.md': '# 01 Add the schema\n\n## What to build\nA table.\n\n## Acceptance criteria\n- It exists\n\n## Blocked by\nNone\n',
  '02-api.md': '# 02 Expose the API\n\n## What to build\nAn endpoint.\n\n## Acceptance criteria\n- It answers\n\n## Blocked by\n- 01 Add the schema\n',
  '03-ui.md':
    '# 03 Show it in the UI\n\n## What to build\nA page.\n\n## Blocked by\n- 01\n- 02\n\n## Acceptance criteria\n- It renders\n',
};

// A create-flow-shaped run: <root>/run/spec/SPEC.md and <root>/run/tickets/.
function setup({ tickets = TICKETS, spec = SPEC } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-github-'));
  const dir = path.join(root, 'run', 'tickets');
  const specFile = path.join(root, 'run', 'spec', 'SPEC.md');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.dirname(specFile));
  for (const [f, text] of Object.entries(tickets)) fs.writeFileSync(path.join(dir, f), text);
  fs.writeFileSync(specFile, spec);
  const stateFile = path.join(root, 'gh-state.json');
  const run = (...args) => {
    const r = spawnSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      env: { ...process.env, FLOW_GITHUB_GH: FAKE, FAKE_GH_STATE: stateFile },
    });
    return { code: r.status, out: r.stdout, err: r.stderr };
  };
  const state = () => (fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { issues: [], calls: [] });
  const setState = (fn) => {
    const s = state();
    fn(s);
    fs.writeFileSync(stateFile, JSON.stringify(s));
  };
  return { root, dir, specFile, run, state, setState, out: (p) => path.join(root, 'out', p) };
}

const creates = (s) => s.calls.filter((c) => c[0] === 'issue' && c[1] === 'create');

// --- export ---

test('export of tickets creates issues in blocker order and rewrites blockers as issue references', () => {
  const { dir, run, state } = setup();
  const r = run('export', '--repo', REPO, '--tickets', dir, '--label', 'feature-x');
  assert.equal(r.code, 0, r.err);
  const s = state();
  assert.deepEqual(s.labels, ['feature-x']);
  assert.deepEqual(s.issues.map((i) => i.title), ['Add the schema', 'Expose the API', 'Show it in the UI']);
  const ui = s.issues[2];
  assert.match(ui.body, /## Blocked by\n\n- #1 Add the schema\n- #2 Expose the API\n/);
  assert.doesNotMatch(ui.body, /^# /m, 'the title line is not repeated in the body');
  assert.doesNotMatch(ui.body, /^Spec: #/m, 'no spec, so no spec reference');
  assert.match(ui.body, /## Acceptance criteria\n- It renders/);
  assert.deepEqual(ui.labels, ['feature-x']);
  const map = JSON.parse(fs.readFileSync(path.join(dir, 'github-issues.json'), 'utf8'));
  assert.equal(map.repo, REPO);
  assert.deepEqual(Object.fromEntries(Object.entries(map.issues).map(([k, v]) => [k, v.number])), { '01': 1, '02': 2, '03': 3 });
});

test('export of spec and tickets creates the spec first and points every ticket to it', () => {
  const { dir, specFile, run, state } = setup();
  const r = run('export', '--repo', REPO, '--spec', specFile, '--tickets', dir, '--label', 'feature-x');
  assert.equal(r.code, 0, r.err);
  const [spec, ...tickets] = state().issues;
  assert.equal(spec.title, 'Spec: Export to CSV');
  assert.ok(spec.body.startsWith(MARK));
  assert.match(spec.body, /## Problem\nUsers need their data\./);
  assert.doesNotMatch(spec.body, /^# /m);
  assert.deepEqual(spec.labels, ['feature-x']);
  for (const t of tickets) assert.match(t.body, /\nSpec: #1\n$/);
  assert.match(tickets[2].body, /- #2 Add the schema\n- #3 Expose the API/);
  const map = JSON.parse(fs.readFileSync(path.join(dir, 'github-issues.json'), 'utf8'));
  assert.equal(map.spec.number, 1);
});

test('export of a spec alone keeps its map next to the spec', () => {
  const { specFile, run, state } = setup();
  const r = run('export', '--repo', REPO, '--spec', specFile);
  assert.equal(r.code, 0, r.err);
  assert.equal(state().issues.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(path.dirname(specFile), 'github-issues.json'), 'utf8')).spec.number, 1);
});

test('export of a spec alone, then with its tickets, publishes the spec once', () => {
  const { dir, specFile, run, state } = setup();
  assert.equal(run('export', '--repo', REPO, '--spec', specFile).code, 0);
  const r = run('export', '--repo', REPO, '--spec', specFile, '--tickets', dir);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /exists {3}spec → #1/);
  const [spec, ...tickets] = state().issues;
  assert.ok(spec.body.startsWith(MARK));
  assert.equal(tickets.length, 3);
  for (const t of tickets) {
    assert.ok(!t.body.includes(MARK), 'no second spec issue');
    assert.match(t.body, /\nSpec: #1\n$/);
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'github-issues.json'), 'utf8')).spec.number, 1);
});

test('export of a spec with its tickets, then alone, publishes the spec once', () => {
  const { dir, specFile, run, state } = setup();
  assert.equal(run('export', '--repo', REPO, '--spec', specFile, '--tickets', dir).code, 0);
  const r = run('export', '--repo', REPO, '--spec', specFile);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /exists {3}spec → #1/);
  assert.equal(creates(state()).length, 4);
});

test('export refuses a map next to the spec that was made for another repo', () => {
  const { dir, specFile, run, state } = setup();
  assert.equal(run('export', '--repo', 'acme/other', '--spec', specFile).code, 0);
  const r = run('export', '--repo', REPO, '--spec', specFile, '--tickets', dir);
  assert.equal(r.code, 1);
  assert.match(r.err, /spec.github-issues\.json records issues in acme\/other, not acme\/app/);
  assert.equal(creates(state()).length, 1);
});

test('export takes a title from a heading only, never from a "# " line inside a code fence', () => {
  const fence = '```sh\n# install deps\nnpm ci\n```\n';
  const { dir, specFile, run, state } = setup({
    spec: `## Problem\nRun this:\n\n${fence}`,
    tickets: {
      '01-SCHEMA.md': `## What to build\n${fence}\n## Acceptance criteria\n- It exists\n\n## Blocked by\nNone\n`,
      '02-api.md': `${fence}\n# 02 Expose the API\n\n## What to build\nAn endpoint.\n\n## Acceptance criteria\n- It answers\n\n## Blocked by\n- 01\n`,
    },
  });
  const r = run('export', '--repo', REPO, '--spec', specFile, '--tickets', dir);
  assert.equal(r.code, 0, r.err);
  const [spec, schema, api] = state().issues;
  assert.equal(spec.title, 'Spec: SPEC', 'no heading, so the file name');
  assert.equal(schema.title, 'SCHEMA', 'no heading, so the slug');
  assert.equal(api.title, 'Expose the API');
  for (const i of [spec, schema, api]) assert.match(i.body, /```sh\n# install deps\nnpm ci\n```/);
  assert.doesNotMatch(api.body, /Expose the API/, 'the heading is not repeated in the body');
});

test('export run twice creates nothing the second time', () => {
  const { dir, specFile, run, state } = setup();
  assert.equal(run('export', '--repo', REPO, '--spec', specFile, '--tickets', dir).code, 0);
  const r = run('export', '--repo', REPO, '--spec', specFile, '--tickets', dir);
  assert.equal(r.code, 0, r.err);
  assert.equal(creates(state()).length, 4);
  assert.match(r.out, /exists {3}spec → #1/);
  assert.match(r.out, /exists {3}03 → #4/);
});

test('export refuses a map made for another repo', () => {
  const { dir, run } = setup();
  run('export', '--repo', REPO, '--tickets', dir);
  const r = run('export', '--repo', 'acme/other', '--tickets', dir);
  assert.equal(r.code, 1);
  assert.match(r.err, /records issues in acme\/app, not acme\/other/);
});

test('export --dry-run calls no gh command and writes no map', () => {
  const { dir, specFile, run, state } = setup();
  const r = run('export', '--repo', REPO, '--spec', specFile, '--tickets', dir, '--label', 'x', '--dry-run');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /would create {2}spec Export to CSV/);
  assert.match(r.out, /would create {2}03 Show it in the UI \(blocked by 01, 02\)/);
  assert.equal(state().calls.length, 0);
  assert.equal(fs.existsSync(path.join(dir, 'github-issues.json')), false);
  assert.equal(fs.existsSync(path.join(path.dirname(specFile), 'github-issues.json')), false);
});

test('export reuses a label that exists under another case, and creates a new one once', () => {
  const { dir, run, state, setState } = setup();
  setState((s) => {
    s.next = 1;
    s.labels = ['Feature-X'];
  });
  const r = run('export', '--repo', REPO, '--tickets', dir, '--label', 'feature-x,New,new');
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(state().labels, ['Feature-X', 'New']);
  assert.equal(state().issues.length, 3);
});

test('export refuses tickets build-flow would refuse, before creating anything', () => {
  const { dir, specFile, run, state } = setup({
    tickets: { ...TICKETS, '04-bad.md': '# 04 Bad\n\n## What to build\nX\n\n## Blocked by\nNone\n' },
  });
  const r = run('export', '--repo', REPO, '--spec', specFile, '--tickets', dir);
  assert.equal(r.code, 1);
  assert.match(r.err, /04-bad\.md lacks a non-empty "## Acceptance criteria"/);
  assert.equal(state().calls.length, 0);
});

test('export refuses a spec too long for an issue body, before creating anything', () => {
  const { dir, specFile, run, state } = setup({ spec: `# Huge\n\n${'x'.repeat(70000)}\n` });
  const r = run('export', '--repo', REPO, '--spec', specFile, '--tickets', dir);
  assert.equal(r.code, 1);
  assert.match(r.err, /too long for a GitHub issue body .*SPEC\.md/);
  assert.equal(state().calls.length, 0);
});

// --- import ---

test('import of spec and tickets round-trips into files build-flow accepts', () => {
  const { dir, specFile, run, out } = setup();
  run('export', '--repo', REPO, '--spec', specFile, '--tickets', dir, '--label', 'feature-x');
  const r = run('import', '--repo', REPO, '--spec', out('SPEC.md'), '--tickets', out('tickets'), '--label', 'feature-x');
  assert.equal(r.code, 0, r.err);
  assert.equal(fs.readFileSync(out('SPEC.md'), 'utf8'), SPEC, 'the spec comes back as it was written');
  assert.deepEqual(fs.readdirSync(out('tickets')).sort(), ['2-add-the-schema.md', '3-expose-the-api.md', '4-show-it-in-the-ui.md']);
  const ui = fs.readFileSync(out('tickets/4-show-it-in-the-ui.md'), 'utf8');
  assert.doesNotMatch(ui, /Spec: #/, 'the spec reference is dropped from the ticket file');
  const queue = orderQueue(readTickets(out('tickets')));
  assert.deepEqual(queue.map((t) => [t.id, t.title, t.blockedBy]), [
    ['2', 'Add the schema', []],
    ['3', 'Expose the API', ['2']],
    ['4', 'Show it in the UI', ['2', '3']],
  ]);
  assert.match(r.out, /--spec .*SPEC\.md --tickets .*tickets --gate/);
});

test('import of a spec alone needs --spec-issue', () => {
  const { specFile, run, out } = setup();
  run('export', '--repo', REPO, '--spec', specFile);
  assert.match(run('import', '--repo', REPO, '--spec', out('SPEC.md')).err, /needs --spec-issue <n>/);
  const r = run('import', '--repo', REPO, '--spec', out('SPEC.md'), '--spec-issue', '1');
  assert.equal(r.code, 0, r.err);
  assert.equal(fs.readFileSync(out('SPEC.md'), 'utf8'), SPEC);
});

test('import with --spec-issue never takes that issue as a ticket, marker or not', () => {
  const { run, setState, out } = setup();
  const ticket = '## What to build\nX.\n\n## Acceptance criteria\n- ok\n\n## Blocked by\nNone\n';
  setState((s) => {
    s.next = 9;
    s.labels = ['x'];
    s.issues = [
      { number: 7, title: 'Spec: Loose', body: 'A spec written by hand.', state: 'OPEN', labels: ['x'], milestone: null },
      { number: 8, title: 'Do it', body: ticket, state: 'OPEN', labels: ['x'], milestone: null },
    ];
  });
  const r = run('import', '--repo', REPO, '--spec', out('SPEC.md'), '--tickets', out('tickets'), '--label', 'x', '--spec-issue', '7');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /#7 has no flow-github spec marker/);
  assert.equal(fs.readFileSync(out('SPEC.md'), 'utf8'), '# Loose\n\nA spec written by hand.\n');
  assert.deepEqual(fs.readdirSync(out('tickets')), ['8-do-it.md']);
});

test('import reads a selection larger than 1 MiB', () => {
  const { run, setState, out } = setup();
  const body = `## What to build\n${'x'.repeat(30000)}\n\n## Acceptance criteria\n- ok\n\n## Blocked by\nNone\n`;
  setState((s) => {
    s.next = 41;
    s.labels = ['x'];
    s.issues = Array.from({ length: 40 }, (_, k) => ({ number: k + 1, title: `Ticket ${k + 1}`, body, state: 'OPEN', labels: ['x'], milestone: null }));
  });
  const r = run('import', '--repo', REPO, '--tickets', out('tickets'), '--label', 'x');
  assert.equal(r.code, 0, r.err);
  assert.equal(fs.readdirSync(out('tickets')).length, 40);
});

test('import finds the spec in the selection when the tickets do not point to one', () => {
  const { dir, specFile, run, out } = setup();
  run('export', '--repo', REPO, '--tickets', dir, '--label', 'x');
  run('export', '--repo', REPO, '--spec', specFile, '--label', 'x');
  const r = run('import', '--repo', REPO, '--spec', out('SPEC.md'), '--tickets', out('tickets'), '--label', 'x');
  assert.equal(r.code, 0, r.err);
  assert.equal(fs.readFileSync(out('SPEC.md'), 'utf8'), SPEC);
  assert.equal(fs.readdirSync(out('tickets')).length, 3);
});

test('import refuses tickets that point to different specs', () => {
  const { dir, specFile, run, setState, out } = setup();
  run('export', '--repo', REPO, '--spec', specFile, '--tickets', dir, '--label', 'x');
  setState((s) => (s.issues[3].body = s.issues[3].body.replace('Spec: #1', 'Spec: #9')));
  const r = run('import', '--repo', REPO, '--spec', out('SPEC.md'), '--tickets', out('tickets'), '--label', 'x');
  assert.equal(r.code, 1);
  assert.match(r.err, /point to more than one spec \(#1, #9\); pass --spec-issue/);
});

test('import drops a blocker whose issue is closed', () => {
  const { dir, run, setState, out } = setup();
  run('export', '--repo', REPO, '--tickets', dir);
  setState((s) => (s.issues[0].state = 'CLOSED'));
  const r = run('import', '--repo', REPO, '--tickets', out('tickets'), '--issues', '2,3');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /#2: blocker #1 is closed, so it is dropped/);
  const queue = orderQueue(readTickets(out('tickets')));
  assert.deepEqual(queue.map((t) => [t.id, t.blockedBy]), [['2', []], ['3', ['2']]]);
  assert.match(fs.readFileSync(out('tickets/2-expose-the-api.md'), 'utf8'), /## Blocked by\n\nNone\n/);
});

test('import stops before writing when an open blocker is not selected', () => {
  const { dir, specFile, run, out } = setup();
  run('export', '--repo', REPO, '--spec', specFile, '--tickets', dir);
  const r = run('import', '--repo', REPO, '--spec', out('SPEC.md'), '--tickets', out('tickets'), '--issues', '4');
  assert.equal(r.code, 1);
  assert.match(r.err, /#4 is blocked by #2, which is open but not selected/);
  assert.match(r.err, /Nothing was written/);
  assert.equal(fs.existsSync(out('tickets')), false);
  assert.equal(fs.existsSync(out('SPEC.md')), false);
});

test('import keeps nothing, spec included, when an issue lacks a required section', () => {
  const { run, setState, out } = setup();
  setState((s) => {
    s.next = 9;
    s.labels = [];
    s.issues = [
      { number: 7, title: 'Spec: Loose', body: `${MARK}\n\nText`, state: 'OPEN', labels: ['x'], milestone: null },
      { number: 8, title: 'Loose issue', body: 'Just some text\n\nSpec: #7', state: 'OPEN', labels: ['x'], milestone: null },
    ];
  });
  const r = run('import', '--repo', REPO, '--spec', out('SPEC.md'), '--tickets', out('tickets'), '--label', 'x');
  assert.equal(r.code, 1);
  assert.match(r.err, /8-loose-issue\.md lacks a non-empty "## What to build"/);
  assert.deepEqual(fs.readdirSync(out('tickets')), []);
  assert.equal(fs.existsSync(out('SPEC.md')), false);
});

test('import refuses to overwrite and to run without a selector', () => {
  const { dir, specFile, run, out } = setup();
  assert.match(run('import', '--repo', REPO, '--tickets', dir, '--label', 'x').err, /is not empty; import into a new folder/);
  assert.match(run('import', '--repo', REPO, '--spec', specFile, '--spec-issue', '1').err, /already exists; import into a new path/);
  assert.match(run('import', '--repo', REPO, '--tickets', out('t')).err, /needs --label, --milestone or --issues/);
  assert.match(run('import', '--repo', REPO, '--tickets', out('t'), '--issues', '1', '--label', 'x').err, /can't be combined/);
  assert.match(run('import', '--repo', REPO, '--tickets', out('t'), '--label', 'x', '--spec-issue', '1').err, /needs --spec <file>/);
});

test('bad invocations print usage', () => {
  const { dir, run } = setup();
  assert.match(run('export', '--tickets', dir).err, /--repo <owner\/name> is required/);
  assert.match(run('export', '--repo', REPO).err, /export needs --spec, --tickets or both/);
  assert.match(run('import', '--repo', REPO, '--label', 'x').err, /import needs --spec, --tickets or both/);
  assert.match(run('sync', '--repo', REPO).err, /usage:/);
  assert.match(run('export', dir, '--repo', REPO).err, /usage:/, 'no positional folder any more');
  assert.match(run('export', '--repo', REPO, '--tickets', dir, '--force').err, /unknown option --force/);
  assert.match(run('import', '--repo', REPO, '--tickets', dir, '--dry-run').err, /--dry-run is for export only/);
  assert.match(run('export', '--repo', REPO, '--tickets', dir, '--spec-issue', '1').err, /for import only/);
});
