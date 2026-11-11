#!/usr/bin/env node
// A stand-in for the gh CLI in github.test.mjs: keeps issues and labels in the JSON file $FAKE_GH_STATE
// and records every call. Supports only the gh commands github.mjs uses.
import fs from 'node:fs';

const file = process.env.FAKE_GH_STATE;
const st = fs.existsSync(file)
  ? JSON.parse(fs.readFileSync(file, 'utf8'))
  : { next: 1, issues: [], labels: [], calls: [] };
const args = process.argv.slice(2);
st.calls.push(args);
const save = () => fs.writeFileSync(file, JSON.stringify(st, null, 2));
const flags = (name) => args.flatMap((a, i) => (a === `--${name}` ? [args[i + 1]] : []));
const pick = (i) => ({ number: i.number, title: i.title, body: i.body, state: i.state });
// GitHub compares label names without regard to case.
const sameLabel = (a) => (b) => a.toLowerCase() === b.toLowerCase();

const [noun, verb] = args;
if (noun === 'issue' && verb === 'create') {
  const number = st.next++;
  const body = flags('body-file')[0] === '-' ? fs.readFileSync(0, 'utf8') : '';
  st.issues.push({ number, title: flags('title')[0], body, state: 'OPEN', labels: flags('label'), milestone: flags('milestone')[0] ?? null });
  console.log(`https://github.com/${flags('repo')[0]}/issues/${number}`);
} else if (noun === 'issue' && verb === 'list') {
  const labels = flags('label');
  const milestone = flags('milestone')[0];
  const found = st.issues.filter(
    (i) => i.state === 'OPEN' && labels.every((l) => i.labels.some(sameLabel(l))) && (!milestone || i.milestone === milestone),
  );
  console.log(JSON.stringify(found.map(pick)));
} else if (noun === 'issue' && verb === 'view') {
  const issue = st.issues.find((i) => i.number === Number(args[2]));
  if (!issue) {
    save();
    console.error(`GraphQL: Could not resolve to an issue with the number of ${args[2]}.`);
    process.exit(1);
  }
  console.log(JSON.stringify(pick(issue)));
} else if (noun === 'label' && verb === 'list') {
  console.log(JSON.stringify(st.labels.map((name) => ({ name }))));
} else if (noun === 'label' && verb === 'create') {
  if (st.labels.some(sameLabel(args[2]))) {
    save();
    console.error(`label with name "${args[2]}" already exists; use \`--force\` to update its color and description`);
    process.exit(1);
  }
  st.labels.push(args[2]);
} else {
  save();
  console.error(`fake gh: unsupported command: ${args.join(' ')}`);
  process.exit(1);
}
save();
