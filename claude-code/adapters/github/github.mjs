#!/usr/bin/env node
// flow-github: moves a spec and its tickets (the files build-flow reads) to GitHub issues and back.
// See README.md. Talks to GitHub only through the gh CLI ($FLOW_GITHUB_GH replaces it, for tests).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { findTitle, orderQueue, parseBlockers, readTickets, section } from '../../skills/build-flow/queue.mjs';

const GH = process.env.FLOW_GITHUB_GH || 'gh';
const MAP = 'github-issues.json';
const SPEC_MARK = '<!-- flow-github: spec -->';
const SPEC_REF = /^Spec: #(\d+)[ \t]*$/m;
const BODY_MAX = 65536; // GitHub's limit on an issue body, in characters.
const USAGE = `usage:
  flow-github export --repo <owner/name> [--spec <SPEC.md>] [--tickets <dir>] [--label <a,b>] [--milestone <title>] [--dry-run]
  flow-github import --repo <owner/name> [--spec <SPEC.md>] [--tickets <dir>]
                     [--label <a,b>] [--milestone <title>] [--issues <n,n,...>] [--spec-issue <n>]`;

function fail(msg) {
  console.error(`flow-github: ${msg}`);
  process.exit(1);
}

function gh(args, input) {
  // No output limit: a selection of issues with their bodies soon passes spawnSync's default of 1 MiB.
  const r = spawnSync(GH, args, { encoding: 'utf8', input, maxBuffer: Infinity });
  if (r.error)
    fail(r.error.code === 'ENOENT' ? `${GH} not found: install the GitHub CLI (https://cli.github.com)` : r.error.message);
  if (r.status !== 0) fail(`gh ${args.slice(0, 2).join(' ')} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout;
}

const list = (v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);
const repeat = (flag, values) => values.flatMap((v) => [flag, v]);
const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const clean = (body) => (body ?? '').replace(/\r\n/g, '\n').trim();

// Replaces the body of a "## <name>" section, with the same section rule as queue.mjs.
const replaceSection = (text, name, body) =>
  `${text
    .replace(
      new RegExp(String.raw`(^##[ \t]+${name}[ \t]*$)[\s\S]*?(?=^##[ \t]|(?![\s\S]))`, 'mi'),
      (_, heading) => `${heading}\n\n${body}\n\n`,
    )
    .trimEnd()}\n`;

// A file's "# Title", by the same rule as queue.mjs, and the file without that line: the issue's title carries it.
const titleOf = (text) => findTitle(text)?.title;
const withoutTitle = (text) => {
  const at = findTitle(text)?.line;
  return (at === undefined ? text : text.split('\n').filter((_, i) => i !== at).join('\n')).trim();
};

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/, '') || 'issue';

function createIssue(opt, labels, title, body) {
  const url = gh(
    [
      'issue', 'create', '--repo', opt.repo, '--title', title, '--body-file', '-',
      ...repeat('--label', labels),
      ...(opt.milestone ? ['--milestone', opt.milestone] : []),
    ],
    body,
  )
    .trim()
    .split('\n')
    .pop();
  const number = Number(url.match(/\/issues\/(\d+)$/)?.[1]);
  if (!number) fail(`gh issue create printed no issue URL: ${url}`);
  return { number, url };
}

function exportPlan(opt) {
  if (!opt.spec && !opt.tickets) fail(`export needs --spec, --tickets or both\n${USAGE}`);
  let tickets = [];
  if (opt.tickets) {
    try {
      tickets = orderQueue(readTickets(opt.tickets));
    } catch (e) {
      fail(`tickets: ${e.message}`);
    }
  }
  let spec = null;
  if (opt.spec) {
    if (!fs.existsSync(opt.spec) || !fs.statSync(opt.spec).isFile()) fail(`spec file not found: ${opt.spec}`);
    const text = read(opt.spec);
    spec = { title: titleOf(text) ?? path.basename(opt.spec, '.md'), body: `${SPEC_MARK}\n\n${withoutTitle(text)}\n` };
  }

  // Everything that can't fit is refused before the first issue is created.
  const tooLong = [
    ...(spec && spec.body.length > BODY_MAX ? [`${opt.spec} (${spec.body.length} characters)`] : []),
    ...tickets
      .map((t) => [t.file, read(path.join(opt.tickets, t.file)).length])
      .filter(([, n]) => n > BODY_MAX - 1000)
      .map(([f, n]) => `${f} (${n} characters)`),
  ];
  if (tooLong.length) fail(`too long for a GitHub issue body (${BODY_MAX} characters at most): ${tooLong.join(', ')}`);

  // The map sits with the tickets when there are any, else next to the spec.
  const loadMap = (file) => {
    const m = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { repo: opt.repo, issues: {} };
    if (m.repo !== opt.repo) fail(`${file} records issues in ${m.repo}, not ${opt.repo}`);
    m.issues ??= {};
    return m;
  };
  const writeMap = (file, m) => fs.writeFileSync(file, `${JSON.stringify(m, null, 2)}\n`);
  const mapFile = path.join(opt.tickets ?? path.dirname(opt.spec), MAP);
  const map = loadMap(mapFile);
  // With both, the spec's entry is also kept in the map next to the spec, where an export of the spec alone
  // looks for it: whichever comes first, the spec is published once.
  const specMapFile = opt.spec && opt.tickets ? path.join(path.dirname(opt.spec), MAP) : null;
  const specMap = specMapFile && path.resolve(specMapFile) !== path.resolve(mapFile) ? loadMap(specMapFile) : null;
  if (specMap?.spec) map.spec ??= specMap.spec;
  const save = () => {
    writeMap(mapFile, map);
    if (specMap && map.spec && !specMap.spec) {
      specMap.spec = map.spec;
      writeMap(specMapFile, specMap);
    }
  };
  const dry = opt['dry-run'];
  const labels = list(opt.label);

  if (labels.length && !dry) {
    // GitHub compares label names without regard to case, so "Bug" exists when "bug" does.
    const have = new Set(
      JSON.parse(gh(['label', 'list', '--repo', opt.repo, '--limit', '1000', '--json', 'name'])).map((l) => l.name.toLowerCase()),
    );
    for (const l of labels) {
      if (have.has(l.toLowerCase())) continue;
      gh(['label', 'create', l, '--repo', opt.repo]);
      have.add(l.toLowerCase());
      console.log(`label    ${l} (created)`);
    }
  }

  // The spec first, so every ticket can point to it.
  if (spec) {
    if (map.spec) {
      console.log(`exists   spec → #${map.spec.number} ${spec.title}`);
      // The entry may have come from the map next to the spec, or be missing there: record it in both.
      if (specMap && !dry) save();
    } else if (dry) console.log(`would create  spec ${spec.title}`);
    else {
      map.spec = createIssue(opt, labels, `Spec: ${spec.title}`, spec.body);
      save();
      console.log(`created  spec → #${map.spec.number} ${map.spec.url}`);
    }
  }

  // Then the tickets in blocker order, so every blocker's issue exists before the tickets it blocks.
  const titles = new Map(tickets.map((t) => [t.id, t.title]));
  for (const t of tickets) {
    const known = map.issues[t.id];
    if (known) {
      console.log(`exists   ${t.id} → #${known.number} ${t.title}`);
      continue;
    }
    if (dry) {
      const by = t.blockedBy.length ? ` (blocked by ${t.blockedBy.join(', ')})` : '';
      console.log(`would create  ${t.id} ${t.title}${by}`);
      continue;
    }
    const blockers = t.blockedBy.map((b) => `- #${map.issues[b].number} ${titles.get(b)}`);
    let body = replaceSection(withoutTitle(read(path.join(opt.tickets, t.file))), 'Blocked by', blockers.join('\n') || 'None');
    if (map.spec) body += `\nSpec: #${map.spec.number}\n`;
    map.issues[t.id] = createIssue(opt, labels, t.title, body);
    // Saved after every issue, so a failed run resumes without duplicates.
    save();
    console.log(`created  ${t.id} → #${map.issues[t.id].number} ${map.issues[t.id].url}`);
  }
  console.log(dry ? '\nDry run: nothing was created.' : `\nIssue map: ${mapFile}`);
}

function importPlan(opt) {
  if (!opt.spec && !opt.tickets) fail(`import needs --spec, --tickets or both\n${USAGE}`);
  const labels = list(opt.label);
  const wanted = list(opt.issues).map(Number);
  const specIssue = opt['spec-issue'] === undefined ? null : Number(opt['spec-issue']);
  if (wanted.some((n) => !Number.isInteger(n) || n < 1)) fail(`--issues takes issue numbers: ${opt.issues}`);
  if (specIssue !== null && (!Number.isInteger(specIssue) || specIssue < 1))
    fail(`--spec-issue takes an issue number: ${opt['spec-issue']}`);
  if (specIssue !== null && !opt.spec) fail('--spec-issue needs --spec <file> to write the spec to');
  if (wanted.length && (labels.length || opt.milestone)) fail('--issues can\'t be combined with --label or --milestone');
  const selector = wanted.length > 0 || labels.length > 0 || Boolean(opt.milestone);
  if (opt.tickets && !selector)
    fail('importing tickets needs --label, --milestone or --issues, so it never pulls a whole repo');
  if (opt.spec && !opt.tickets && specIssue === null)
    fail('importing a spec on its own needs --spec-issue <n>');
  if (opt.tickets && fs.existsSync(opt.tickets) && fs.readdirSync(opt.tickets).length)
    fail(`${opt.tickets} is not empty; import into a new folder`);
  if (opt.spec && fs.existsSync(opt.spec)) fail(`${opt.spec} already exists; import into a new path`);

  const fields = 'number,title,body,state';
  const cache = new Map();
  const view = (n) => {
    if (!cache.has(n)) cache.set(n, JSON.parse(gh(['issue', 'view', String(n), '--repo', opt.repo, '--json', fields])));
    return cache.get(n);
  };
  const isSpec = (i) => clean(i.body).includes(SPEC_MARK);

  // Spec issues are never tickets, even when a label selects them too: neither the marked ones
  // nor the one named with --spec-issue, which needs no marker.
  let tickets = [];
  let selectedSpecs = [];
  if (opt.tickets) {
    const issues = wanted.length
      ? wanted.map(view)
      : JSON.parse(
          gh([
            'issue', 'list', '--repo', opt.repo, '--state', 'open', '--limit', '1000', '--json', fields,
            ...repeat('--label', labels),
            ...(opt.milestone ? ['--milestone', opt.milestone] : []),
          ]),
        );
    for (const i of issues) cache.set(i.number, i);
    tickets = issues.filter((i) => !isSpec(i) && i.number !== specIssue);
    selectedSpecs = issues.filter(isSpec).map((i) => i.number);
    if (!tickets.length) fail('no matching open ticket issues');
  }

  // The spec: --spec-issue, else the one issue the selected tickets point to with "Spec: #N",
  // else the one spec issue the selection itself holds.
  let specText = null;
  if (opt.spec) {
    let n = specIssue;
    if (n === null) {
      let refs = [...new Set(tickets.map((i) => clean(i.body).match(SPEC_REF)?.[1]).filter(Boolean).map(Number))];
      if (!refs.length) refs = selectedSpecs;
      if (refs.length !== 1)
        fail(
          refs.length
            ? `the selected tickets point to more than one spec (${refs.map((r) => `#${r}`).join(', ')}); pass --spec-issue <n>`
            : 'none of the selected tickets points to a spec ("Spec: #N"); pass --spec-issue <n>',
        );
      n = refs[0];
    }
    const s = view(n);
    if (!isSpec(s)) console.log(`note: #${n} has no flow-github spec marker; its body is imported as the spec`);
    specText = `# ${s.title.replace(/^Spec:\s*/i, '')}\n\n${clean(s.body).replace(SPEC_MARK, '').trim()}\n`;
  }

  // Blockers are issue references ("- #12 …"). A closed one is done and is dropped; an open one must be selected too.
  const byN = new Map(tickets.map((i) => [i.number, i]));
  const problems = [];
  const files = [...tickets]
    .sort((a, b) => a.number - b.number)
    .map((i) => {
      const body = clean(i.body).replace(new RegExp(`${SPEC_REF.source}\\n?`, 'm'), '').trim();
      let text = `# ${i.title}\n\n${body}\n`;
      const blocked = section(text, 'Blocked by');
      if (blocked) {
        const kept = [];
        for (const n of parseBlockers(blocked)) {
          if (byN.has(n)) kept.push(`- #${n} ${byN.get(n).title}`);
          else if (view(n).state === 'CLOSED') console.log(`#${i.number}: blocker #${n} is closed, so it is dropped`);
          else problems.push(`#${i.number} is blocked by #${n}, which is open but not selected`);
        }
        text = replaceSection(text, 'Blocked by', kept.join('\n') || 'None');
      }
      return { file: `${i.number}-${slug(i.title)}.md`, text };
    });
  if (problems.length)
    fail(`${problems.join('\n')}\nSelect those issues too, or close the ones that are done. Nothing was written.`);

  // Tickets first: they are validated by build-flow's parser, and nothing is kept if they fail.
  let queue = [];
  if (opt.tickets) {
    fs.mkdirSync(opt.tickets, { recursive: true });
    for (const f of files) fs.writeFileSync(path.join(opt.tickets, f.file), f.text);
    try {
      queue = orderQueue(readTickets(opt.tickets));
    } catch (e) {
      for (const f of files) fs.rmSync(path.join(opt.tickets, f.file));
      fail(`tickets: ${e.message}\nNothing was kept: fix the issues on GitHub, then run import again.`);
    }
  }
  if (specText !== null) {
    fs.mkdirSync(path.dirname(path.resolve(opt.spec)), { recursive: true });
    fs.writeFileSync(opt.spec, specText);
    console.log(`Wrote the spec to ${opt.spec}.`);
  }
  if (opt.tickets) {
    console.log(`Wrote ${files.length} ticket(s) to ${opt.tickets}. Build order:`);
    for (const t of queue) console.log(`- ${t.id} ${t.title}`);
    const specArg = opt.spec ? path.resolve(opt.spec) : '<SPEC.md>';
    console.log(
      `\nBuild them with:\n  build-flow init <build-run> --repo <repo> --spec ${specArg} --tickets ${path.resolve(opt.tickets)} --gate ticket|end`,
    );
  }
}

const FLAGS = ['repo', 'spec', 'tickets', 'label', 'milestone', 'issues', 'spec-issue'];
const BOOLS = ['dry-run'];
const pos = [];
const opt = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  const k = a.slice(2);
  if (!a.startsWith('--')) pos.push(a);
  else if (BOOLS.includes(k)) opt[k] = true;
  else if (!FLAGS.includes(k)) fail(`unknown option ${a}\n${USAGE}`);
  else if (i + 1 < process.argv.length) opt[k] = process.argv[++i];
  else fail(`missing value for ${a}`);
}
const [cmd, ...extra] = pos;
if (!['export', 'import'].includes(cmd) || extra.length) fail(USAGE);
if (!/^[\w.-]+\/[\w.-]+$/.test(opt.repo ?? '')) fail(`--repo <owner/name> is required\n${USAGE}`);
if (cmd === 'import' && opt['dry-run']) fail('--dry-run is for export only');
if (cmd === 'export' && (opt.issues || opt['spec-issue'])) fail('--issues and --spec-issue are for import only');

if (cmd === 'export') exportPlan(opt);
else importPlan(opt);
