#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import def from "./flow.definition.mjs";
import { readTickets, orderQueue } from "./queue.mjs";
import { lastRunFile, recordSession } from "./session.mjs";

const NAME = def.id;

function fail(msg) {
  console.error(`${NAME}: ${msg}`);
  process.exit(1);
}

if (!Array.isArray(def.dirs))
  fail("definition: dirs must list the folders init creates in the run folder");
// input/ and handoffs/ are the engine's own: init copies the SPEC and tickets into input/, handoff writes handoffs/,
// whatever the steps are.
const DIRS = [...def.dirs, "input/tickets", "handoffs"];

// The run folder last named on the command line; a command without one uses it, so gate commands stay short.
const LAST_RUN = lastRunFile(NAME);
const RESUME = "@resume";
// File times come from a coarse kernel clock and can trail the real time by a few ms;
// a file written right after entering a state must still count as fresh.
const CLOCK_SLACK_MS = 20;

const at = (run, p) => path.join(run, p);

// Symlink-free absolute path; the path need not exist yet (its nearest existing ancestor is resolved).
// git reports a repo's real path, so a path compared with it has to be resolved the same way.
function real(p) {
  const rest = [];
  for (p = path.resolve(p); !fs.existsSync(p); p = path.dirname(p))
    rest.unshift(path.basename(p));
  return path.join(fs.realpathSync(p), ...rest);
}
const now = () => new Date().toISOString();

// A transition is either one branch or a list of routes; each route inherits the transition's fields.
function branches(t) {
  if (!t.routes) return [t];
  return t.routes.map((r) => ({
    ...t,
    ...r,
    routes: undefined,
    requires: [...(t.requires ?? []), ...(r.requires ?? [])],
    fresh: [...(t.fresh ?? []), ...(r.fresh ?? [])],
  }));
}

function load(run) {
  const f = at(run, "flow.json");
  if (!fs.existsSync(f))
    fail(
      `no flow.json in ${run} (the human starts one with: ${NAME} init <run> ...)`,
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

// Times `ev` was sent from `state` in the whole run: a move back to an earlier state doesn't reset it.
const usedInRun = (run, state, ev) =>
  events(run).filter((e) => e.from === state && e.event === ev).length;

// Times `ev` was sent from `state` in this pass: consecutively, since the state was last entered another way.
function usedInPass(run, state, ev) {
  let n = 0;
  for (const e of events(run).reverse()) {
    if (!e.from) continue; // handoffs and the like are not moves
    if (e.from === state && e.event === ev) n++;
    else break;
  }
  return n;
}

// Newest modification time of a non-empty file or directory (a directory's entries), else 0.
function mtime(run, p) {
  const f = at(run, p);
  if (!fs.existsSync(f)) return 0;
  const s = fs.statSync(f);
  if (!s.isDirectory()) return s.size > 0 ? s.mtimeMs : 0;
  return Math.max(0, ...fs.readdirSync(f).map((e) => mtime(f, e)));
}

// Values for the {placeholders} in instructions and guard paths, and the argument of a `do` function.
// `via` is the event the state was entered by. `left` / `max` hold, per event of the state with a limit, what remains.
function vars(st, via) {
  const q = st.queue;
  const cur = q.find((x) => x.id === st.ticket);
  const built = q.filter((x) => x.done);
  const named = (id) => `${id} ${q.find((x) => x.id === id).title}`;
  const left = {};
  const max = {};
  // status must still work for a run whose state an older definition had.
  for (const [ev, t] of Object.entries(def.states[st.state]?.on ?? {})) {
    if ("max" in t)
      [max[ev], left[ev]] = [
        t.max,
        Math.max(0, t.max - usedInRun(st.run, st.state, ev)),
      ];
    if ("maxPerPass" in t)
      [max[ev], left[ev]] = [
        t.maxPerPass,
        Math.max(0, t.maxPerPass - usedInPass(st.run, st.state, ev)),
      ];
  }
  return {
    ticket: st.ticket ?? "-",
    title: cur?.title ?? "-",
    ticketFile: cur ? `input/tickets/${cur.file}` : "-",
    blockedBy: cur?.blockedBy.length
      ? cur.blockedBy.map(named).join("; ")
      : "none",
    // The per-ticket report the definition names, for the last ticket recorded and the current ticket's blockers.
    seedReports: built.length
      ? [...new Set([built.at(-1).id, ...(cur?.blockedBy ?? [])])]
          .map((id) => (def.report ? fill(def.report, { ticket: id }) : id))
          .join(", ")
      : "none yet",
    approved: built.length ? named(built.at(-1).id) : "-",
    run: st.run,
    repo: st.repo,
    base: st.base ?? "-",
    target: st.target ?? "-",
    commit: st.commit,
    gate: st.gate,
    // Null when the human gave no ticket id: each commit message then takes its own one-word scope.
    scope: st.scope ?? null,
    resume: st.resume ?? "-",
    reviewed: !!st.reviewed,
    reviews: st.reviews ?? 0,
    fixes: st.fixes ?? 0,
    via: via ?? null,
    left,
    max,
  };
}
// {name} or {name.key}; an unknown placeholder is left as is.
const fill = (s, v) =>
  s.replace(/\{(\w+(?:\.\w+)?)\}/g, (m, k) => {
    const got = k
      .split(".")
      .reduce(
        (o, part) => (o && typeof o === "object" ? o[part] : undefined),
        v,
      );
    return got === undefined ? m : String(got);
  });
// A state's instructions: a string with {placeholders}, or a function of the run's values returning one.
const instructions = (s, v) =>
  fill(typeof s.do === "function" ? s.do(v) : s.do, v);

// Facts a route's `when` can test, read from the run.
const facts = {
  gate: (st) => st.gate,
  more: (st) => st.queue.some((x) => !x.done && x.id !== st.ticket),
  reviewed: (st) => !!st.reviewed,
  resume: (st) => st.resume ?? null,
};

function resolve(st, t) {
  const b = branches(t).find((b) =>
    Object.entries(b.when ?? {}).every(([k, v]) => facts[k](st) === v),
  );
  if (!b) fail(`definition: no route of ${st.state} matches the run`);
  return { ...b, target: b.target === RESUME ? st.resume : b.target };
}

// Checks before a move, keyed by their transition field and run in this order, so the reasons print in a fixed
// order. Each reads only the run folder and returns why the event is blocked. `v` holds the placeholders.
const guards = {
  refuse(_, reason) {
    return [`refused: ${reason}`];
  },
  max({ run, st, ev, b }, n) {
    const used = usedInRun(run, st.state, ev);
    return used >= n
      ? [`used ${used} of ${n} times${b.maxHint ? `: ${b.maxHint}` : ""}`]
      : [];
  },
  maxPerPass({ run, st, ev, b }, n) {
    const used = usedInPass(run, st.state, ev);
    return used >= n
      ? [
          `used ${used} of ${n} times this pass${b.maxHint ? `: ${b.maxHint}` : ""}`,
        ]
      : [];
  },
  requires({ run, v }, paths) {
    return paths
      .map((p) => fill(p, v))
      .filter((p) => !mtime(run, p))
      .map((p) => `missing or empty: ${p}`);
  },
  fresh({ run, st, v }, paths) {
    return paths
      .map((p) => fill(p, v))
      .flatMap((p) => {
        const m = mtime(run, p);
        if (!m) return [`missing or empty: ${p}`];
        return m < Date.parse(st.enteredAt) - CLOCK_SLACK_MS
          ? [`not updated since entering ${st.state}: ${p}`]
          : [];
      });
  },
  verdict({ run, v }, { file, is }) {
    const p = fill(file, v);
    const f = at(run, p);
    const got = fs.existsSync(f)
      ? fs.readFileSync(f, "utf8").match(/^Verdict:[ \t]*(\w+)/m)?.[1]
      : undefined;
    return got === is
      ? []
      : [`${p} must say "Verdict: ${is}" (found: ${got ?? "no verdict"})`];
  },
  // A `## <heading>` with content before the next `#` or `##` heading; `###` subsections count as content.
  section({ run, v }, { file, heading }) {
    const p = fill(file, v);
    const f = at(run, p);
    const lines = fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n") : [];
    const i = lines.findIndex((l) => l.trim() === `## ${heading}`);
    if (i < 0) return [`${p} has no "## ${heading}" section`];
    const rest = lines.slice(i + 1);
    const end = rest.findIndex((l) => /^#{1,2}\s/.test(l));
    const body = (end < 0 ? rest : rest.slice(0, end)).join("").trim();
    return body ? [] : [`${p}: "## ${heading}" is empty`];
  },
};

function blockers(run, st, ev, b) {
  const v = vars(st);
  const out = Object.entries(guards).flatMap(([k, check]) =>
    k in b ? check({ run, st, ev, b, v }, b[k]) : [],
  );
  if (!b.refuse && !b.target) out.push("no state to resume");
  return out;
}

function git(st, ...args) {
  const r = spawnSync("git", ["-C", st.target, ...args], {
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  if (r.status !== 0)
    fail(
      `git ${args.join(" ")} failed in ${st.target}:\n${(r.stderr || r.stdout).trim()}`,
    );
  return r.stdout;
}

function gitOk(cwd, ...args) {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

// The branch checked out in the target now; null when HEAD is detached.
const branchOf = (target) =>
  gitOk(target, "symbolic-ref", "--short", "-q", "HEAD") || null;

// Commits the whole working tree; returns the new sha, or null when there is nothing to commit and that is allowed.
function commit(st, msg, allowNothing) {
  git(st, "add", "-A");
  const staged =
    spawnSync("git", ["-C", st.target, "diff", "--cached", "--quiet"])
      .status === 1;
  if (!staged) {
    if (allowNothing) return null;
    fail(`nothing to commit in ${st.target} for "${msg}"`);
  }
  git(st, "commit", "-q", "-m", msg);
  return git(st, "rev-parse", "HEAD").trim();
}

// The target's working tree as a git tree object: tracked, modified and untracked files, .gitignore respected.
// Built in a throwaway index, so the target's own index and working tree are untouched.
function treeOf(st) {
  const idx = path.join(
    os.tmpdir(),
    `${NAME}-index-${process.pid}-${Date.now()}`,
  );
  const env = { ...process.env, GIT_INDEX_FILE: idx };
  const g = (...args) => {
    const r = spawnSync("git", ["-C", st.target, ...args], {
      encoding: "utf8",
      env,
      maxBuffer: 1 << 28,
    });
    if (r.status !== 0)
      fail(
        `git ${args.join(" ")} failed in ${st.target}:\n${(r.stderr || r.stdout).trim()}`,
      );
    return r.stdout.trim();
  };
  try {
    g("read-tree", "HEAD");
    g("add", "-A");
    return g("write-tree");
  } finally {
    fs.rmSync(idx, { force: true });
  }
}

// What changed in the target since the last verification, as a diff stat plus the test cases deleted from test
// files; "" when nothing changed.
function drift(st) {
  if (!st.verified || !st.target) return "";
  const now = treeOf(st);
  const stat = gitOk(st.target, "diff", "--stat", st.verified.tree, now) ?? "";
  const deleted = deletedTests(
    gitOk(st.target, "diff", "-U0", st.verified.tree, now) ?? "",
  );
  return deleted.length
    ? `${stat}\n\nDeleted test cases (ask the human whether each was deliberate, and record the answer):\n` +
        deleted.map((d) => `- ${d}`).join("\n")
    : stat;
}

const TEST_FILE = /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$/;
const TEST_CASE = /^-\s*(?:it|test|describe)(?:\.\w+)?\(\s*(['"`])(.+?)\1/;

// "file: name" for each it(…) / test(…) / describe(…) line a diff removes from a test file.
function deletedTests(diff) {
  const out = [];
  let file = null;
  for (const line of diff.split("\n")) {
    const header = line.match(/^diff --git a\/(\S+) b\//);
    if (header) file = TEST_FILE.test(header[1]) ? header[1] : null;
    const m = file && line.match(TEST_CASE);
    if (m) out.push(`${file}: ${m[2]}`);
  }
  return out;
}

// Everything since the base, committed or not, new files included.
function snapshot(run, st, p) {
  git(st, "add", "-A", "-N");
  fs.mkdirSync(path.dirname(at(run, p)), { recursive: true });
  fs.writeFileSync(at(run, p), git(st, "diff", st.base));
}

// Actions on the move, keyed by their transition field and run in this order, after the run has entered the new
// state and before it is saved: one that fails leaves the run where it was. Each may update st.
const effects = {
  // The workspace check: the target is the run's repo or one of its worktrees, on the named branch, outside the run
  // folder, and clean for engine commits. Records the target, the branch, the source and the base every diff is taken against,
  // and, when the human has a ticket id, the scope: the TICKET of every commit message in the run, type(TICKET): summary.
  workspace({ st, ev, opt }) {
    if (!opt.target || !opt.branch)
      fail(`${ev} needs --target <repo-or-worktree> and --branch <name>`);
    if (opt.scope && !/^[^()\s]+$/.test(opt.scope))
      fail(
        `--scope ${opt.scope} can't be a commit scope: no spaces or parentheses`,
      );
    const dir = path.resolve(opt.target);
    const top =
      fs.existsSync(dir) && gitOk(dir, "rev-parse", "--show-toplevel");
    if (!top) fail(`target is not a git repo: ${dir}`);
    const common = (d) =>
      gitOk(d, "rev-parse", "--path-format=absolute", "--git-common-dir");
    if (common(top) !== common(st.repo))
      fail(`${top} is neither ${st.repo} nor one of its worktrees`);
    const branch = branchOf(top);
    if (branch !== opt.branch)
      fail(`${top} is on ${branch ?? "a detached HEAD"}, not ${opt.branch}`);
    const within = (a, b) => a === b || a.startsWith(b + path.sep);
    const runReal = real(st.run);
    if (within(runReal, top) || within(top, runReal))
      fail(
        `the run folder must be outside the target, and the target outside the run folder (${top})`,
      );
    if (st.commit === "ticket" && gitOk(top, "status", "--porcelain"))
      fail(
        `--commit ticket needs a clean working tree in ${top}; commit or stash first`,
      );
    const base = gitOk(top, "rev-parse", "HEAD");
    // A worktree must name the source it was created from, and still sit on that commit: it becomes the base.
    if (top !== st.repo && !opt.source)
      fail(
        `${top} is a worktree: pass --source <the branch or commit it was created from>`,
      );
    if (opt.source) {
      const sha = gitOk(
        st.repo,
        "rev-parse",
        "--verify",
        "-q",
        `${opt.source}^{commit}`,
      );
      if (!sha)
        fail(`--source ${opt.source} is not a branch or commit of ${st.repo}`);
      if (sha !== base)
        fail(
          `${top} is at ${base.slice(0, 10)}, not at --source ${opt.source} (${sha.slice(0, 10)}); it has moved since it was created`,
        );
    }
    Object.assign(st, {
      target: top,
      branch,
      source: opt.source ?? null,
      base,
      scope: opt.scope ?? null,
    });
  },
  // The tree that just passed verification: later edits show up as drift against it.
  verified({ st }) {
    st.verified = { label: `ticket ${st.ticket}`, tree: treeOf(st) };
  },
  // Records the current ticket (a commit, or the patch at `patch` in commit mode none) and moves to the next one.
  accept({ run, st, opt, v }, patch) {
    const cur = st.queue.find((x) => x.id === st.ticket);
    if (st.commit === "ticket")
      cur.sha = commit(
        st,
        opt.message ?? `Ticket ${cur.id}: ${cur.title}`,
        false,
      );
    else snapshot(run, st, fill(patch, v));
    cur.done = true;
    st.ticket = st.queue.find((x) => !x.done)?.id ?? null;
  },
  // Records the current ticket as the patch at `patch` whatever the commit mode, and moves to the next one: the
  // commit, if any, is the human's own.
  acceptPatch({ run, st, v }, patch) {
    snapshot(run, st, fill(patch, v));
    st.queue.find((x) => x.id === st.ticket).done = true;
    st.ticket = st.queue.find((x) => !x.done)?.id ?? null;
  },
  startReview({ st }) {
    st.reviewed = true;
  },
  // Keeps each round of the files that are rewritten every round: each of `files` (one path or a list) is copied to
  // `<file>-N`.
  archive({ run, st }, files) {
    st.reviews = (st.reviews ?? 0) + 1;
    for (const file of [files].flat()) {
      const { dir, name, ext } = path.parse(file);
      fs.copyFileSync(
        at(run, file),
        at(run, path.join(dir, `${name}-${st.reviews}${ext}`)),
      );
    }
  },
  // A verified repair is saved as its own patch: what changed since the last verification, which a re-review checks.
  // In commit mode ticket it stays pending until an event carrying commitRepair commits it.
  recordRepair({ run, st }, patch) {
    st.fixes = (st.fixes ?? 0) + 1;
    const now = treeOf(st);
    const p = fill(patch, { fixes: st.fixes });
    fs.mkdirSync(path.dirname(at(run, p)), { recursive: true });
    fs.writeFileSync(
      at(run, p),
      st.verified ? git(st, "diff", st.verified.tree, now) : "",
    );
    st.verified = { label: `repair ${st.fixes}`, tree: now };
    st.pendingRepair = st.commit === "ticket";
  },
  // Commits a saved repair that is still uncommitted, on the event the definition puts it on: the same event as
  // recordRepair (which runs first), or a later one.
  commitRepair({ st, opt }) {
    if (!st.pendingRepair) return;
    const sha = commit(
      st,
      opt.message ?? `Repair ${st.fixes}: review findings`,
      true,
    );
    if (sha) st.repairShas.push(sha);
    st.pendingRepair = false;
  },
  // The human's words are the record of the verdict.
  noteTo({ run, st, ev, from, opt }, file) {
    fs.appendFileSync(
      at(run, file),
      `\n## ${st.enteredAt} ${ev} at ${from}${opt.ticket ? `, ticket ${opt.ticket}` : ""}\n\n${opt.note}\n`,
    );
  },
  // Where '@resume' returns to.
  resume({ st }, state) {
    st.resume = state;
  },
};

// Definition checks: a misspelled field would otherwise be ignored, leaving its event unchecked.
const FIELDS = new Set([
  "target",
  "human",
  "routes",
  "when",
  "maxHint",
  "message",
  ...Object.keys(guards),
  ...Object.keys(effects),
]);
for (const [name, s] of Object.entries(def.states))
  for (const [ev, t] of Object.entries(s.on)) {
    const where = `definition: ${name} --${ev}-->`;
    for (const b of branches(t)) {
      const unknown = Object.keys(b).filter(
        (k) => !FIELDS.has(k) && b[k] !== undefined,
      );
      if (unknown.length)
        fail(
          `${where} unknown field(s) ${unknown.join(", ")}; known: ${[...FIELDS].join(", ")}`,
        );
      for (const k of Object.keys(b.when ?? {}))
        if (!facts[k])
          fail(
            `${where} unknown fact ${k} in when; known: ${Object.keys(facts).join(", ")}`,
          );
      if (b.refuse) {
        if (!b.when || b.target)
          fail(`${where} a refusal has a condition and no target`);
      } else if (b.target !== RESUME && !def.states[b.target])
        fail(
          `${where} ` +
            (/^@(next|prev)$/.test(b.target)
              ? `${b.target} has no state there: ${name} is the ${b.target === "@next" ? "last" : "first"} state`
              : `unknown state ${b.target}`),
        );
      if (b.resume && !def.states[b.resume])
        fail(`${where} resumes unknown state ${b.resume}`);
      if ("maxHint" in b && !("max" in b) && !("maxPerPass" in b))
        fail(`${where} maxHint needs max or maxPerPass`);
    }
    if (t.routes && t.routes.at(-1).when)
      fail(`${where} the last route needs no condition, so one always matches`);
  }
// The state where the workspace is chosen: until then the run has no target.
const WORKSPACE_STATE = Object.keys(def.states).find((n) =>
  Object.values(def.states[n].on).some((t) => t.workspace),
);
const NO_TARGET = WORKSPACE_STATE ? `(chosen in ${WORKSPACE_STATE})` : "-";

// The queue in build order: done or open, blockers, and the commit that recorded it.
const fmtQueue = (st) =>
  st.queue
    .map(
      (x) =>
        `- [${x.done ? "x" : " "}] ${x.id} ${x.title}` +
        (x.blockedBy.length ? ` (blocked by ${x.blockedBy.join(", ")})` : "") +
        (x.sha ? ` · ${x.sha.slice(0, 10)}` : "") +
        (x.id === st.ticket ? "  ← current" : ""),
    )
    .join("\n");

const fmtEvent = (e) =>
  `- ${e.at} ${e.event}${e.from ? ` ${e.from} -> ${e.to}` : ""}${e.ticket ? ` [ticket ${e.ticket}]` : ""}` +
  `${e.note ? ` — "${e.note}"` : ""}${e.file ? ` (${e.file})` : ""}`;

function fmtArtifacts(run, st) {
  const v = vars(st);
  return def.artifacts
    .filter((p) => st.ticket || !p.includes("{ticket}"))
    .map((p) => fill(p, v))
    .map((p) => `- [${mtime(run, p) ? "x" : " "}] ${p}`)
    .join("\n");
}

// The flags a human gate event must carry to name its gate: the state, and the ticket where the gate repeats per ticket.
const pinOf = (st) =>
  `--at ${st.state}${def.states[st.state].perTicket ? ` --ticket ${st.ticket}` : ""}`;

// The run's branch, flagged when the target has moved off it since the workspace was chosen.
function fmtBranch(st) {
  if (!st.target) return NO_TARGET;
  const name = (b) => b ?? "(detached HEAD)";
  const now = branchOf(st.target);
  if (now === (st.branch ?? null)) return name(st.branch);
  return `${name(st.branch)} — MISMATCH: the target is now on ${name(now)}; switch back before building`;
}

const fmtTicket = (st) => {
  if (!st.ticket) return `all ${st.queue.length} built`;
  const i = st.queue.findIndex((x) => x.id === st.ticket);
  return `${st.ticket} ${st.queue[i].title} (${i + 1} of ${st.queue.length})`;
};

const handoffNums = (run) =>
  fs
    .readdirSync(at(run, "handoffs"))
    .filter((f) => /^\d{3}\.md$/.test(f))
    .map((f) => Number.parseInt(f, 10));

// What a resuming orchestrator reads first, in order: the newest handoff, then the definition's resume files that exist.
function fmtResume(run) {
  const nums = fs.existsSync(at(run, "handoffs")) ? handoffNums(run) : [];
  const newest = nums.length
    ? [`handoffs/${String(Math.max(...nums)).padStart(3, "0")}.md`]
    : [];
  const files = [...newest, ...(def.resume ?? []).filter((p) => mtime(run, p))];
  return files.join(", ") || "nothing yet";
}

const commands = {
  init(run, _, opt) {
    const missing = ["repo", "spec", "tickets", "gate"].filter((k) => !opt[k]);
    if (missing.length)
      fail(`init needs ${missing.map((k) => `--${k}`).join(", ")}`);
    if (!["ticket", "end"].includes(opt.gate))
      fail(
        "--gate is ticket (a human gate per ticket) or end (one gate after all tickets)",
      );
    const mode = opt.commit ?? "ticket";
    if (!["none", "ticket"].includes(mode))
      fail("--commit is ticket (default) or none");
    if (fs.existsSync(at(run, "flow.json")))
      fail(
        `${run} already holds a flow; resume it with /${NAME} ${path.resolve(run)}`,
      );

    // The target (this repo or a worktree of it), its branch and the base are chosen by the workspace effect.
    const repo = path.resolve(opt.repo);
    const top =
      fs.existsSync(repo) && gitOk(repo, "rev-parse", "--show-toplevel");
    if (!top) fail(`repo is not a git repo: ${repo}`);
    if (!gitOk(top, "rev-parse", "HEAD"))
      fail(`repo has no commit to build on: ${top}`);
    const abs = path.resolve(run);
    const absReal = real(run);
    if (absReal === top || absReal.startsWith(top + path.sep))
      fail(`the run folder must be outside the repo (${top})`);

    const spec = path.resolve(opt.spec);
    if (!fs.existsSync(spec) || !fs.statSync(spec).isFile())
      fail(`spec file not found: ${spec}`);
    const tickets = path.resolve(opt.tickets);
    if (!fs.existsSync(tickets) || !fs.statSync(tickets).isDirectory())
      fail(`tickets folder not found: ${tickets}`);
    let queue;
    try {
      queue = orderQueue(readTickets(tickets));
    } catch (e) {
      fail(`tickets: ${e.message}`);
    }

    for (const d of DIRS) fs.mkdirSync(at(run, d), { recursive: true });
    for (const [p, body] of Object.entries(def.seed ?? {}))
      fs.writeFileSync(at(run, p), body);
    fs.copyFileSync(spec, at(run, "input/SPEC.md"));
    for (const x of queue)
      fs.copyFileSync(
        path.join(tickets, x.file),
        at(run, `input/tickets/${x.file}`),
      );
    const st = {
      flow: def.id,
      run: abs,
      repo: top,
      target: null,
      spec,
      tickets,
      gate: opt.gate,
      commit: mode,
      branch: null,
      source: null,
      base: null,
      queue,
      ticket: queue[0].id,
      reviewed: false,
      reviews: 0,
      fixes: 0,
      repairShas: [],
      resume: null,
      state: def.initial,
      enteredAt: now(),
    };
    save(run, st);
    log(run, { event: "INIT", to: def.initial, ticket: st.ticket });
    console.log(
      `Created ${abs} (state ${st.state}, repo ${top}, gate ${st.gate}, commit ${st.commit})\n\nQueue:\n${fmtQueue(st)}\n\n` +
        `Start the orchestrator with:\n\n  /${NAME} ${abs}\n`,
    );
  },

  status(run) {
    const st = load(run);
    console.log(
      `Run:     ${st.run}\nRepo:    ${st.repo}\nTarget:  ${st.target ?? NO_TARGET}\nBranch:  ${fmtBranch(st)}\n` +
        `Source:  ${st.source ?? "-"}\n` +
        `Gate:    ${st.gate} · Commit: ${st.commit} · Scope: ${st.scope ?? "-"} · Base: ${st.base ?? "-"}\n` +
        `State:   ${st.state} (since ${st.enteredAt})\nTicket:  ${fmtTicket(st)}\nResume:  ${fmtResume(run)}\n`,
    );
    console.log(`Queue:\n${fmtQueue(st)}\n`);
    console.log(`Artifacts:\n${fmtArtifacts(run, st)}\n`);
    console.log(
      `Recent events:\n${events(run).slice(-5).map(fmtEvent).join("\n")}`,
    );
  },

  next(run) {
    const st = loadCurrent(run);
    const s = def.states[st.state];
    const last = events(run).findLast((e) => e.to === st.state);
    console.log(
      `State: ${st.state} (actor: ${s.actor}) · Ticket: ${fmtTicket(st)}`,
    );
    if (last?.note) console.log(`Entered via ${last.event} — "${last.note}"`);
    console.log(`\n${instructions(s, vars(st, last?.event))}\n`);
    // At a gate, or right after a human's event, a change since verification can only be the human's own edit.
    const d = (s.actor === "human" || last?.human) && drift(st);
    if (d)
      console.log(
        `Changed in the target since ${st.verified.label} was verified (the human's edits, unless work has started since);\n` +
          `record them in DECISIONS.md and tell the implementer in its next brief:\n${d}\n`,
      );
    const on = Object.entries(s.on);
    if (!on.length) return console.log("Final state: no events.");
    console.log("Events:");
    for (const [ev, t] of on) {
      const b = resolve(st, t);
      const bl = blockers(run, st, ev, b);
      console.log(
        `  ${ev} -> ${b.target ?? "?"}${t.human ? ` [human gate: ${pinOf(st)} and --note required]` : ""} ${bl.length ? "(blocked)" : "(ready)"}`,
      );
      for (const x of bl) console.log(`      ${x}`);
    }
  },

  send(run, [ev], opt) {
    if (!ev) fail("send needs an EVENT");
    const st = loadCurrent(run);
    // --at (and --ticket) name the gate the event was meant for, so a stale or replayed command can't land on a later one.
    if (opt.at && opt.at !== st.state)
      fail(
        `${ev} --at ${opt.at}: the run is now in ${st.state}, so this event is not for it; nothing was sent`,
      );
    if (opt.ticket && opt.ticket !== st.ticket)
      fail(
        `${ev} --ticket ${opt.ticket}: the current ticket is ${st.ticket ?? "none"}, so this event is not for it; nothing was sent`,
      );
    const t = def.states[st.state].on[ev];
    if (!t)
      fail(
        `${ev} is not allowed in ${st.state}; allowed: ${Object.keys(def.states[st.state].on).join(", ") || "none"}`,
      );
    if (t.human && !opt.note)
      fail(`${ev} is a human gate: pass --note "<the human's own words>"`);
    if (t.human && (!opt.at || (def.states[st.state].perTicket && !opt.ticket)))
      fail(
        `${ev} is a human gate: pass ${pinOf(st)}, the gate the human's verdict is for`,
      );
    // Commits, patches and drift are all taken on the run's branch: refuse to act from any other.
    if (st.branch) {
      const now = branchOf(st.target);
      if (now !== st.branch)
        fail(
          `${st.target} is on ${now ?? "a detached HEAD"}, not the run's branch ${st.branch}: switch back before sending ${ev}; nothing was sent`,
        );
    }
    const b = resolve(st, t);
    const bl = blockers(run, st, ev, b);
    if (bl.length) fail(`${ev} blocked:\n  ${bl.join("\n  ")}`);
    // An agent's event that commits (a ticket or a repair) has no human to read the message first: the definition's
    // `message` ({ pattern, max, hint }) is then the shape --message must have. A human's event keeps the default subject.
    if (
      b.message &&
      (b.accept || b.commitRepair) &&
      !t.human &&
      st.commit === "ticket"
    ) {
      const m = opt.message ?? "";
      if (!new RegExp(b.message.pattern).test(m) || m.length > b.message.max)
        fail(
          `${ev} makes a commit: pass --message '<line>', ${b.message.hint}; nothing was sent`,
        );
      // The pattern holds, so the scope is what sits between the first parentheses.
      if (st.scope && !m.slice(m.indexOf("(")).startsWith(`(${st.scope}): `))
        fail(
          `${ev} makes a commit: its --message must carry this run's scope, type(${st.scope}): summary; nothing was sent`,
        );
    }

    const from = st.state;
    const ticket = st.ticket;
    const v = vars(st);
    Object.assign(st, { state: b.target, enteredAt: now() });
    const ctx = { run, st, ev, from, opt: { ...opt, ticket }, v };
    for (const [k, apply] of Object.entries(effects))
      if (k in b) apply(ctx, b[k]);
    save(run, st);
    log(run, {
      event: ev,
      from,
      to: b.target,
      ...(ticket && { ticket }),
      ...(t.human && { human: true }),
      ...(opt.note && { note: opt.note }),
    });
    console.log(`${from} --${ev}--> ${b.target}\n`);
    commands.next(run);
  },

  drift(run) {
    const st = loadCurrent(run);
    if (!st.verified) return console.log("Nothing verified yet.");
    const d = drift(st);
    console.log(
      d
        ? `Changed since ${st.verified.label} was verified:\n${d}`
        : `No changes since ${st.verified.label} was verified.`,
    );
  },

  handoff(run) {
    const st = load(run);
    fs.mkdirSync(at(run, "handoffs"), { recursive: true }); // a run made by hand may lack it
    const n = String(Math.max(0, ...handoffNums(run)) + 1).padStart(3, "0");
    const file = `handoffs/${n}.md`;
    fs.writeFileSync(
      at(run, file),
      `# Handoff ${n}

State: **${st.state}** · Ticket: ${fmtTicket(st)} · Target repo: \`${st.target ?? NO_TARGET}\` · Branch: ${fmtBranch(st)} · Written: ${now()}

Resume with: \`/${NAME} ${st.run}\`

## Queue
${fmtQueue(st)}

## Recent transitions
${events(run).slice(-5).map(fmtEvent).join("\n")}

## Artifacts
${fmtArtifacts(run, st)}

## In flight
<!-- What was running when the session ended: which agent, on what, and what it had reported. Agents don't survive the session.
Decisions and rules live in DECISIONS.md (its Standing rules): point to them, don't copy them here. -->

## Next step
<!-- The first thing the next orchestrator should do. -->
`,
    );
    log(run, { event: "HANDOFF", file });
    console.log(at(st.run, file));
  },
};

const FLAGS = [
  "repo",
  "spec",
  "tickets",
  "gate",
  "commit",
  "at",
  "ticket",
  "note",
  "message",
  "target",
  "branch",
  "source",
  "scope",
];
const pos = [];
const opt = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith("--")) pos.push(a);
  else if (!FLAGS.includes(a.slice(2)))
    fail(
      `unknown option ${a}; known: ${FLAGS.map((f) => `--${f}`).join(", ")}`,
    );
  else if (i + 1 < process.argv.length) opt[a.slice(2)] = process.argv[++i];
  else fail(`missing value for ${a}`);
}
const [cmd, ...args] = pos;
const usage = () =>
  fail(
    `usage: ${NAME} <init|status|next|send|drift|handoff> [<run-folder>] [EVENT]\n` +
      "  without <run-folder>, the run last named on the command line is used (init always needs one)\n" +
      "  init: --repo <repo> --spec <SPEC.md> --tickets <dir> --gate ticket|end [--commit ticket|none]\n" +
      "  send: [--at <STATE> [--ticket <NN>]] [--note '...'] [--message '<commit subject>'] [--target <repo-or-worktree> --branch <name> [--scope <ticket-id>] [--source <ref>]]",
  );
if (!commands[cmd]) usage();
let run = args[0];
const named = run && (cmd === "init" || fs.existsSync(at(run, "flow.json")));
if (named) args.shift();
else {
  if (cmd === "init") usage();
  // A path is never an event name: a missing run folder is an error, not a cue to fall back.
  if (run?.includes("/")) load(run);
  run = fs.existsSync(LAST_RUN) ? fs.readFileSync(LAST_RUN, "utf8").trim() : "";
  if (!run || !fs.existsSync(at(run, "flow.json")))
    fail(
      `no run folder given and no last run to fall back on; pass it: ${NAME} ${cmd} <run-folder> ...`,
    );
  console.error(`${NAME}: run ${run}`);
}
// Only send takes a positional after the run folder; anything else is a mistake, not noise.
const stray = args.slice(cmd === "send" ? 1 : 0);
if (stray.length) fail(`unexpected argument(s): ${stray.join(" ")}`);
fs.mkdirSync(path.dirname(LAST_RUN), { recursive: true });
fs.writeFileSync(LAST_RUN, `${path.resolve(run)}\n`);
commands[cmd](run, args, opt);
// After the command, so one that fails (it exits) leaves the session's record as it was.
recordSession(NAME, process.env.CLAUDE_CODE_SESSION_ID, run, cmd === "handoff");
