// Reads a tickets folder into a build queue. See README.md, "Input format".
import fs from 'node:fs';
import path from 'node:path';

const SECTIONS = ['What to build', 'Acceptance criteria', 'Blocked by'];

// Body of a "## <name>" section, up to the next "## " heading; null when the heading is absent.
function section(text, name) {
  const m = text.match(new RegExp(String.raw`^##[ \t]+${name}[ \t]*$([\s\S]*?)(?=^##[ \t]|(?![\s\S]))`, 'mi'));
  return m ? m[1].trim() : null;
}

// "None …" means no blockers. Otherwise each bullet names one ticket by the first number on it
// ("- 01 …", "- #3", "- Ticket 02: …", "- [01-EXPORT](01-EXPORT.md)"); without bullets, every number counts.
function parseBlockers(body) {
  if (/^[-*\s]*none\b/i.test(body)) return [];
  const bullets = body.split('\n').map((l) => l.match(/^\s*[-*]\s+\D*?(\d+)/)).filter(Boolean);
  if (bullets.length) return bullets.map((m) => Number(m[1]));
  return [...body.matchAll(/\d+/g)].map((m) => Number(m[0]));
}

export function readTickets(dir) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d+-.+\.md$/i.test(f))
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
  if (!files.length) throw new Error(`no ticket files named <NN>-<slug>.md in ${dir}`);
  const seen = new Map();
  return files.map((file) => {
    const id = file.match(/^\d+/)[0];
    const n = Number(id);
    if (seen.has(n)) throw new Error(`${seen.get(n)} and ${file} share ticket number ${n}`);
    seen.set(n, file);
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    const missing = SECTIONS.filter((s) => !section(text, s));
    if (missing.length) throw new Error(`${file} lacks a non-empty ${missing.map((s) => `"## ${s}"`).join(', ')}`);
    const blockedBy = parseBlockers(section(text, 'Blocked by'));
    // A heading may repeat the ticket number ("# 01 Lift…"); the queue prints the id itself.
    const title = (text.match(/^#[ \t]+(.+)$/m)?.[1].trim() ?? file.replace(/^\d+-|\.md$/gi, '').replace(/[-_]/g, ' '))
      .replace(new RegExp(String.raw`^(ticket\s+)?${id}\b[\s:.-]*`, 'i'), '');
    return { id, n, file, title, blockedBy };
  });
}

// Blocker order: repeatedly take the lowest-numbered ticket whose blockers are all queued.
export function orderQueue(tickets) {
  const byN = new Map(tickets.map((t) => [t.n, t]));
  for (const t of tickets)
    for (const b of t.blockedBy)
      if (!byN.has(b)) throw new Error(`${t.file} is blocked by ticket ${b}, which is not in the folder`);
  const queued = new Set();
  const out = [];
  while (out.length < tickets.length) {
    const next = tickets.find((t) => !queued.has(t.n) && t.blockedBy.every((b) => queued.has(b)));
    if (!next)
      throw new Error(`blocking cycle among: ${tickets.filter((t) => !queued.has(t.n)).map((t) => t.file).join(', ')}`);
    queued.add(next.n);
    out.push(next);
  }
  return out.map(({ id, file, title, blockedBy }) => ({
    id,
    file,
    title,
    blockedBy: blockedBy.map((b) => byN.get(b).id),
    done: false,
  }));
}
