#!/usr/bin/env node
// Usage: see README.md.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import def from "./flow.definition.mjs";

const NAME = def.id;

function fail(msg) {
  console.error(`${NAME}: ${msg}`);
  process.exit(1);
}

if (!Array.isArray(def.dirs)) fail("definition: dirs must list the folders init creates in the run folder");
// handoffs/ is the engine's own: the handoff command writes there whatever the steps are.
const DIRS = [...def.dirs, "handoffs"];

// The report drift reads, for a baseline recorded before it carried its own (older runs).
let CITES;
for (const [name, s] of Object.entries(def.states))
  for (const [ev, t] of Object.entries(s.on)) {
    if (!def.states[t.target])
      fail(
        `definition: ${name} --${ev}--> ` +
          (/^@(next|prev)$/.test(t.target)
            ? `${t.target} has no state there: ${name} is the ${t.target === "@next" ? "last" : "first"} state`
            : `unknown state ${t.target}`),
      );
    if (t.baseline && typeof t.baseline.cites !== "string")
      fail(`definition: ${name} --${ev}--> baseline needs { cites: "<report path>" }, the report whose cited files drift checks`);
    CITES ??= t.baseline?.cites;
  }

// File times come from a coarse kernel clock and can trail the real time by a few ms;
// a file written right after entering a state must still count as fresh.
const CLOCK_SLACK_MS = 20;

const at = (run, p) => path.join(run, p);
const now = () => new Date().toISOString();

// Symlink-free absolute path; the path need not exist yet (its nearest existing ancestor is resolved).
function real(p) {
  const rest = [];
  for (p = path.resolve(p); !fs.existsSync(p); p = path.dirname(p)) rest.unshift(path.basename(p));
  return path.join(fs.realpathSync(p), ...rest);
}

function load(run) {
  const f = at(run, "flow.json");
  if (!fs.existsSync(f))
    fail(
      `no flow.json in ${run} (the human starts one with: ${NAME} init <run> --target <repo>)`,
    );
  return JSON.parse(fs.readFileSync(f, "utf8"));
}

// A run created with an older definition may sit in a state that no longer exists.
function loadCurrent(run) {
  const st = load(run);
  if (st.flow !== def.id || !def.states[st.state])
    fail(
      `${st.run} is in state ${st.state} of flow "${st.flow}", which the current "${def.id}" definition does not have: ` +
        `the run was created with an older definition. Inspect it with ${NAME} status ${st.run}.`,
    );
  return st;
}

function save(run, st) {
  const f = at(run, "flow.json");
  fs.writeFileSync(`${f}.tmp`, JSON.stringify(st, null, 2) + "\n");
  fs.renameSync(`${f}.tmp`, f);
}

function log(run, entry) {
  fs.appendFileSync(
    at(run, "events.jsonl"),
    JSON.stringify({ at: now(), ...entry }) + "\n",
  );
}

function events(run) {
  const f = at(run, "events.jsonl");
  if (!fs.existsSync(f)) return [];
  return fs
    .readFileSync(f, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

// Newest modification time of a non-empty file or directory (a directory's entries), else 0.
function mtime(run, p) {
  const f = at(run, p);
  if (!fs.existsSync(f)) return 0;
  const s = fs.statSync(f);
  if (!s.isDirectory()) return s.size > 0 ? s.mtimeMs : 0;
  return Math.max(0, ...fs.readdirSync(f).map((e) => mtime(f, e)));
}

// Checks before a move, keyed by their transition field and run in this order, so the
// reasons print in a fixed order. Each reads only the run folder and returns why the event is blocked.
const guards = {
  max({ run, st, ev, t }, n) {
    // Sends from this state in the whole run: a REJECT back to an earlier state doesn't reset it.
    const used = events(run).filter((e) => e.from === st.state && e.event === ev).length;
    return used >= n ? [`used ${used} of ${n} times${t.maxHint ? `: ${t.maxHint}` : ""}`] : [];
  },
  requires({ run }, paths) {
    return paths.filter((p) => !mtime(run, p)).map((p) => `missing or empty: ${p}`);
  },
  fresh({ run, st }, paths) {
    return paths.flatMap((p) => {
      const m = mtime(run, p);
      if (!m) return [`missing or empty: ${p}`];
      return m < Date.parse(st.enteredAt) - CLOCK_SLACK_MS ? [`not updated since entering ${st.state}: ${p}`] : [];
    });
  },
  clear({ run }, paths) {
    return paths.flatMap((p) => {
      const f = at(run, p);
      const open = fs.existsSync(f) ? (fs.readFileSync(f, "utf8").match(/^[ \t]*- \[ \]/gm) ?? []).length : 0;
      return open ? [`${p} still has ${open} open "- [ ]" item(s)`] : [];
    });
  },
};

function blockers(run, st, ev, t) {
  return Object.entries(guards).flatMap(([k, check]) => (k in t ? check({ run, st, ev, t }, t[k]) : []));
}

// Read-only git in the target repo; null when it fails (not a repo, commit gone).
function git(dir, ...args) {
  const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

// One line on how the target moved since the discovery baseline; "" when it hasn't.
// Only the local history is read: commits not yet pulled into the target are not seen.
function drift(run, st) {
  const b = st.baseline;
  if (!b || git(st.target, "rev-parse", "HEAD") === b.sha) return "";
  const changed = git(st.target, "diff", "--name-only", "--relative", b.sha, "HEAD");
  if (changed === null) return `Target drift: cannot compare HEAD with the discovery baseline ${b.sha.slice(0, 7)}`;
  const cites = b.cites ?? CITES;
  const f = at(run, cites);
  const report = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
  const hit = changed.split("\n").filter((p) => p && report.includes(p));
  return `Target drift: HEAD moved since discovery (${b.sha.slice(0, 7)}, ${b.at}); changed files cited in ${cites}: ${hit.join(", ") || "none"}`;
}

// Actions on the move, keyed by their transition field and run in this order, after the run has entered
// the new state and before it is saved. Each may update st; it returns fields for the event log and a line to print.
const effects = {
  // The commit the discovery reports were read against; every later next/status compares HEAD with it.
  // It keeps the report it was recorded for, so a later definition change can't repoint an existing run.
  baseline({ st }, { cites }) {
    const h = git(st.target, "rev-parse", "HEAD");
    if (!h) {
      delete st.baseline;
      return { say: `No baseline recorded: ${st.target} has no git commits, so drift is not tracked` };
    }
    st.baseline = { sha: h, at: st.enteredAt, cites };
    return { log: { baseline: h } };
  },
  // The human's words are the record of the verdict; written after enteredAt so the file counts as fresh in the new state.
  noteTo({ run, st, ev, from, opt }, file) {
    fs.appendFileSync(at(run, file), `\n## ${st.enteredAt} ${ev} at ${from}\n\n${opt.note}\n`);
    return {};
  },
};

// A misspelled field would otherwise be ignored, leaving its event unchecked.
const FIELDS = new Set(["target", "human", "maxHint", ...Object.keys(guards), ...Object.keys(effects)]);
for (const [name, s] of Object.entries(def.states))
  for (const [ev, t] of Object.entries(s.on)) {
    const unknown = Object.keys(t).filter((k) => !FIELDS.has(k));
    if (unknown.length)
      fail(`definition: ${name} --${ev}--> unknown field(s) ${unknown.join(", ")}; known: ${[...FIELDS].join(", ")}`);
    if ("maxHint" in t && !("max" in t)) fail(`definition: ${name} --${ev}--> maxHint needs max`);
  }

// The states whose events record the baseline: going back to one is the only way to refresh what drift checks.
const BASELINE_FROM = Object.keys(def.states).filter((n) => Object.values(def.states[n].on).some((t) => t.baseline));

// Whether any path of events leads from the state back to one of those.
function wayBack(from) {
  const seen = new Set([from]);
  for (const s of seen) for (const t of Object.values(def.states[s].on)) seen.add(t.target);
  return BASELINE_FROM.some((b) => seen.has(b));
}

// The line under Target drift: the state's own onDrift, else the engine's note when no path leads back.
const driftHint = (st) =>
  def.states[st.state].onDrift ??
  (wayBack(st.state)
    ? ""
    : `No way back to ${BASELINE_FROM.join(" or ")} from ${st.state}: the human weighs the changed files against the work in hand.`);

const fmtBaseline = (st) => (st.baseline ? `${st.baseline.sha.slice(0, 7)} (${st.baseline.at})` : "none yet");

const fmtEvent = (e) =>
  `- ${e.at} ${e.event}${e.from ? ` ${e.from} -> ${e.to}` : ""}${e.note ? ` — "${e.note}"` : ""}${e.file ? ` (${e.file})` : ""}`;

const fmtArtifacts = (run) =>
  def.artifacts.map((p) => `- [${mtime(run, p) ? "x" : " "}] ${p}`).join("\n");

const handoffNums = (run) =>
  fs
    .readdirSync(at(run, "handoffs"))
    .filter((f) => /^\d{3}\.md$/.test(f))
    .map((f) => Number.parseInt(f, 10));

// What a resuming orchestrator reads first, in order: the newest handoff, then the definition's resume files that exist.
function fmtResume(run) {
  const nums = fs.existsSync(at(run, "handoffs")) ? handoffNums(run) : [];
  const newest = nums.length ? [`handoffs/${String(Math.max(...nums)).padStart(3, "0")}.md`] : [];
  const files = [...newest, ...(def.resume ?? []).filter((p) => mtime(run, p))];
  return files.join(", ") || "nothing yet";
}

const commands = {
  init(run, _, opt) {
    if (!opt.target) fail("init needs --target <repo>");
    if (fs.existsSync(at(run, "flow.json")))
      fail(
        `${run} already holds a flow; resume it with /${NAME} ${path.resolve(run)}`,
      );
    if (!fs.existsSync(opt.target) || !fs.statSync(opt.target).isDirectory())
      fail(`target repo not found: ${path.resolve(opt.target)}`);
    const [r, t] = [real(run), real(opt.target)];
    if (r === t || r.startsWith(t + path.sep) || t.startsWith(r + path.sep))
      fail(`the run folder must be outside the target repo, and the target outside the run folder (${t})`);
    for (const d of DIRS) fs.mkdirSync(at(run, d), { recursive: true });
    const st = {
      flow: def.id,
      run: path.resolve(run),
      target: path.resolve(opt.target),
      state: def.initial,
      enteredAt: now(),
    };
    save(run, st);
    log(run, { event: "INIT", to: def.initial });
    console.log(
      `Created ${st.run} (state ${st.state}, target ${st.target})\n\nStart the orchestrator with:\n\n  /${NAME} ${st.run}\n`,
    );
  },

  status(run) {
    const st = load(run);
    console.log(
      `Run:      ${st.run}\nTarget:   ${st.target}\nBaseline: ${fmtBaseline(st)}\nState:    ${st.state} (since ${st.enteredAt})\nResume:   ${fmtResume(run)}\n`,
    );
    const d = drift(run, st);
    if (d) console.log(`${d}\n`);
    console.log(`Artifacts:\n${fmtArtifacts(run)}\n`);
    console.log(
      `Recent events:\n${events(run).slice(-5).map(fmtEvent).join("\n")}`,
    );
  },

  next(run) {
    const st = loadCurrent(run);
    const s = def.states[st.state];
    const last = events(run).findLast((e) => e.to === st.state);
    console.log(`State: ${st.state} (actor: ${s.actor})`);
    if (last?.note) console.log(`Entered via ${last.event} — "${last.note}"`);
    const d = drift(run, st);
    if (d) console.log(`\n${d}`);
    // What drift means in this state; the human still decides whether to refresh.
    if (d && driftHint(st)) console.log(driftHint(st));
    console.log(`\n${s.do}\n`);
    const on = Object.entries(s.on);
    if (!on.length) return console.log("Final state: no events.");
    console.log("Events:");
    for (const [ev, t] of on) {
      const b = blockers(run, st, ev, t);
      console.log(
        `  ${ev} -> ${t.target}${t.human ? ` [human gate: --at ${st.state} and --note required]` : ""} ${b.length ? "(blocked)" : "(ready)"}`,
      );
      for (const x of b) console.log(`      ${x}`);
    }
  },

  send(run, [ev], opt) {
    if (!ev) fail("send needs an EVENT");
    const st = loadCurrent(run);
    // --at names the state the event was meant for, so a stale or replayed command can't land on a later gate.
    if (opt.at && opt.at !== st.state)
      fail(`${ev} --at ${opt.at}: the run is now in ${st.state}, so this event is not for it; nothing was sent`);
    const t = def.states[st.state].on[ev];
    if (!t)
      fail(
        `${ev} is not allowed in ${st.state}; allowed: ${Object.keys(def.states[st.state].on).join(", ") || "none"}`,
      );
    if (t.human && !opt.note)
      fail(`${ev} is a human gate: pass --note "<the human's own words>"`);
    if (t.human && !opt.at)
      fail(`${ev} is a human gate: pass --at ${st.state}, the state the human's verdict is for`);
    const b = blockers(run, st, ev, t);
    if (b.length) fail(`${ev} blocked:\n  ${b.join("\n  ")}`);
    const from = st.state;
    Object.assign(st, { state: t.target, enteredAt: now() });
    const done = Object.entries(effects)
      .filter(([k]) => k in t)
      .map(([k, apply]) => apply({ run, st, ev, from, opt }, t[k]));
    save(run, st);
    log(run, {
      event: ev,
      from,
      to: t.target,
      ...(t.human && { human: true }),
      ...(opt.note && { note: opt.note }),
      ...Object.assign({}, ...done.map((d) => d.log)),
    });
    console.log(`${from} --${ev}--> ${t.target}\n`);
    for (const d of done) if (d.say) console.log(`${d.say}\n`);
    commands.next(run);
  },

  handoff(run) {
    const st = load(run);
    const d = drift(run, st);
    fs.mkdirSync(at(run, "handoffs"), { recursive: true }); // a run made by hand may lack it
    const n = String(Math.max(0, ...handoffNums(run)) + 1).padStart(3, "0");
    const file = `handoffs/${n}.md`;
    fs.writeFileSync(
      at(run, file),
      `# Handoff ${n}

State: **${st.state}** · Target repo: \`${st.target}\` · Written: ${now()}

Resume with: \`/${NAME} ${st.run}\`

Baseline: ${fmtBaseline(st)}${d ? `\n\n${d}` : ""}

## Recent transitions
${events(run).slice(-5).map(fmtEvent).join("\n")}

## Artifacts
${fmtArtifacts(run)}

## In flight
<!-- The thread that was open when the session ended: last question asked, half-made decisions, what the human was weighing. -->

## Next step
<!-- The first thing the next orchestrator should do. -->
`,
    );
    log(run, { event: "HANDOFF", file });
    console.log(at(st.run, file));
  },
};

const FLAGS = ["target", "at", "note"];
const pos = [];
const opt = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith("--")) pos.push(a);
  else if (!FLAGS.includes(a.slice(2))) fail(`unknown option ${a}; known: ${FLAGS.map((f) => `--${f}`).join(", ")}`);
  else if (i + 1 < process.argv.length) opt[a.slice(2)] = process.argv[++i];
  else fail(`missing value for ${a}`);
}
const [cmd, run, ...rest] = pos;
if (!commands[cmd] || !run)
  fail(
    `usage: ${NAME} <init|status|next|send|handoff> <run-folder> [EVENT] [--target <repo>] [--at <STATE>] [--note "..."]`,
  );
// Only send takes a positional after the run folder; anything else is a mistake, not noise.
const stray = rest.slice(cmd === "send" ? 1 : 0);
if (stray.length) fail(`unexpected argument(s): ${stray.join(" ")}`);
commands[cmd](run, rest, opt);
