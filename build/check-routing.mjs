#!/usr/bin/env node
// Check the bug-fix routing contract in every built host. verify.mjs proves a build is
// well-formed. This proves its instructions still compose: one entry rule, caller inputs that
// win, gates inside the step they guard, a return path for review findings, stale proof after a
// later edit, and leaf briefs that stay leaves. The contract and its diagram nodes come from the
// routing-trace audit, in git history: `git show 30b9dfb:audits/2026-09-10-poteto-routing-trace.md`.
// A static check proves the instruction is present and placed; only a replayed run proves a
// model follows it.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

import { ensureBuildLock } from "./build-lock.mjs";
ensureBuildLock();

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = resolve(process.argv[2] ?? join(ROOT, "dist"));
const ORCHESTRATORS = ["how", "why", "architect", "arena", "interrogate", "swarm"];

const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

const FILES = {
  router: /\/poteto-mode\/SKILL\.md$/,
  runtimeIndex: /\/(?:pstack-runtime|pstack\/runtime)\/SKILL\.md$/,
  sticky: /\/sticky-mode\.md$/,
  delegation: /\/delegation\.md$/,
  worker: /\/pstack-worker(?:\.agent)?\.md$/,
  bugfix: /\/poteto-mode\/playbooks\/bug-fix\.md$/,
  feature: /\/poteto-mode\/playbooks\/feature\.md$/,
  pr: /\/poteto-mode\/playbooks\/opening-a-pr\.md$/,
  how: /\/how\/SKILL\.md$/,
  why: /\/why\/SKILL\.md$/,
  architect: /\/architect\/SKILL\.md$/,
  runner: /\/architect\/references\/runner-prompt\.md$/,
  arena: /\/arena\/SKILL\.md$/,
  noComments: /\/no-comments\/SKILL\.md$/,
  interrogate: /\/interrogate\/SKILL\.md$/,
  guide: /\/02-poteto-mode\.md$/,
  runRecord: /\/poteto-mode\/scripts\/run-record\.py$/,
  setup: /\/setup-pstack\/SKILL\.md$/,
  capabilities: /\/capabilities\.md$/,
  hostBinding: /\/host-binding\.md$/,
  pause: /\/poteto-mode\/playbooks\/pause-safely\.md$/,
};

// Text from a heading line to the next heading of the same or higher level.
const section = (text, heading) => {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.startsWith(heading));
  if (start === -1) return "";
  const level = heading.match(/^#+/)[0].length;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => { const m = l.match(/^(#+) /); return m && m[1].length <= level; });
  return [lines[start], ...(end === -1 ? rest : rest.slice(0, end))].join("\n");
};

// Top-level numbered steps. A step runs until the next number or an unindented line.
const steps = (text) => {
  const out = {};
  let cur = null;
  for (const line of text.split("\n")) {
    const m = line.match(/^(\d+)\. /);
    if (m) { cur = Number(m[1]); out[cur] = line; continue; }
    if (cur === null) continue;
    if (line.trim() && !/^\s/.test(line)) { if (Object.keys(out).length >= 2) break; cur = null; continue; }
    out[cur] += "\n" + line;
  }
  return out;
};

const need = (re, why) => (t) => (re.test(t) ? [] : [`missing: ${why}`]);
const forbid = (re, why) => (t) => { const m = t.match(re); return m ? [`forbidden: ${why} ("${m[0]}")`] : []; };
const inSection = (heading, ...checks) => (t) => {
  const s = section(t, heading);
  return s ? checks.flatMap((c) => c(s)) : [`missing section ${heading}`];
};
const inStep = (n, ...checks) => (t) => {
  const s = steps(t)[n];
  return s ? checks.flatMap((c) => c(s)) : [`missing step ${n}`];
};
const ordered = (anchors, why) => (t) => {
  let at = -1;
  for (const a of anchors) {
    const i = t.slice(at + 1).search(a);
    if (i === -1) return [`order: ${why}: ${a} missing or out of order`];
    at += 1 + i;
  }
  return [];
};

const gatesInsideSteps = (t) => {
  const s = steps(t);
  const inside = Object.values(s).join("\n");
  const problems = [];
  for (const line of t.split("\n").filter((l) => /\*\*Gate\b/.test(l))) {
    const label = line.match(/\*\*Gate[^*]*\*\*/)?.[0] ?? line.trim().slice(0, 50);
    if (!/^\*\*Gate, (?:before|when) /.test(label)) problems.push(`gate does not name when it runs: ${label}`);
    if (!inside.includes(line) && !/reply/i.test(label)) problems.push(`gate sits outside the step it guards: ${label}`);
  }
  if (!problems.length && !/\*\*Gate\b/.test(inside)) problems.push("no gate sits inside a step");
  return problems;
};

const runtimeIndexCoversDir = (t, file) => {
  const dir = dirname(file);
  return readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "SKILL.md")
    .filter((f) => !t.includes(f)).map((f) => `runtime index omits ${f}`);
};

const leafPromptsStayLeaves = (_t, _file, tree) => {
  const leafish = tree.filter((f) => /\/references\/[^/]*\.md$/.test(f) || FILES.worker.test(f));
  const re = new RegExp(`read the \\*\\*(?:${ORCHESTRATORS.join("|")})\\*\\* skill in full`, "i");
  return leafish.flatMap((f) => {
    const t = readFileSync(f, "utf8");
    const m = t.match(re) || t.match(/\b(?:each|every one) on a different model\b/i);
    return m ? [`leaf prompt ${basename(dirname(dirname(f)))}/${basename(f)}: "${m[0]}"`] : [];
  });
};

// node: the routing-trace diagram node the contract guards. kind: fix (repairs a trace defect)
// or guard (pins a clause the trace confirmed, so a later edit cannot drop it silently).
const CONTRACTS = [
  { node: "A invoke, sticky entry", kind: "fix", file: "router", checks: [
    inSection("## Runtime bootstrap",
      ordered([/sticky-mode\.md/, /That is the whole bootstrap/], "mode entry happens inside the bootstrap"),
      need(/active: true/, "the bootstrap persists active: true")),
    need(/^\|[^|\n]*sticky-mode\.md[^|\n]*\|/m, "sticky-mode.md in the open-when table")] },
  { node: "A invoke, sticky entry", kind: "fix", file: "sticky", checks: [
    need(/`poteto-mode`\s+bootstrap sends you here/, "sticky-mode names the bootstrap as its caller")] },
  { node: "B resolve host, lazy runtime", kind: "fix", file: "runtimeIndex", checks: [
    forbid(/Read these before/i, "an eager read-everything rule"),
    need(/Do not read these up front/, "the lazy rule"),
    runtimeIndexCoversDir] },
  { node: "C select by intent and state", kind: "guard", file: "router", checks: [
    need(/Session pickup/, "the already-landed redirect"), need(/figure-it-out/, "the unmatched route")] },
  { node: "C select by intent and state", kind: "fix", file: "guide", checks: [
    forbid(/Read the Principles section/, "a principles-first node the router does not have"),
    need(/Session pickup/, "the already-landed route in the guide diagram")] },
  { node: "D six steps plus gates", kind: "fix", file: "bugfix", checks: [
    forbid(/after step 6/, "gates appended after the last step"), gatesInsideSteps,
    (t) => (Object.keys(steps(t)).length === 6 ? [] : [`expected 6 steps, found ${Object.keys(steps(t)).length}`])] },
  { node: "D six steps plus gates", kind: "fix", file: "bugfix", checks: [
    ordered([/worktree/, /fail for the bug's reason/, /how/, /throughput checkpoint/, /`architect`/,
      /one subagent/, /no-comments/, /interrogate/, /Verify on the same surface/, /stale/,
      /technical-writing/, /Opening a PR/], "the expanded route's order")] },
  { node: "R prepare worktree and driver", kind: "fix", file: "bugfix", checks: [
    inStep(1, need(/worktree/, "worktree before the first edit"), need(/verification driver/, "a named driver"))] },
  { node: "S1 reproduce, failing evidence first", kind: "fix", file: "bugfix", checks: [
    inStep(1, need(/fail for the bug's reason/, "a check that fails for the bug's reason"),
      need(/before step 3/, "captured before the fix"), need(/Commit the check/, "the failing-test commit"),
      need(/stop and report/, "a stop path when it will not fail"))] },
  { node: "H how, simple or complex", kind: "guard", file: "how", checks: [
    need(/When in doubt, take the simple path/, "the simple path"), need(/Step 3\. Synthesize/, "explore then synthesize")] },
  { node: "H how, simple or complex", kind: "fix", file: "how", checks: [
    inSection("## Without delegation", need(/simple question/i, "the simple path without delegation"))] },
  { node: "W why, sources then synthesis", kind: "guard", file: "why", checks: [
    need(/Step 4\. Synthesize/, "a separate synthesizer"), need(/Preserve \/ Change \/ Avoid \/ Risk/, "constraints for the fix")] },
  { node: "M parent confirms mechanism", kind: "fix", file: "bugfix", checks: [
    inStep(2, need(/do not confirm one/, "reports seed, they do not confirm"),
      need(/Confirm the surviving \*mechanism\* with runtime evidence/, "runtime confirmation"))] },
  { node: "P/K premise census, conditional", kind: "fix", file: "bugfix", checks: [
    inStep(2, need(/Gate, when two or more fixes/, "the premise gate is conditional"),
      need(/without new evidence/, "no repeated census"))] },
  { node: "T throughput before fan-out", kind: "fix", file: "bugfix", checks: [
    inStep(3, ordered([/throughput checkpoint/, /`architect` first/], "checkpoint before the design fan-out"))] },
  { node: "AR architect A, grounding reuse", kind: "fix", file: "architect", checks: [
    inSection("## Phase A", need(/Reuse grounding/, "reuse of the caller's grounding"), need(/changed/, "an invalidation condition"))] },
  { node: "AR architect B, roster precedence", kind: "fix", file: "architect", checks: [
    inSection("## Phase B", need(/overrides `arena-runners`/, "architect's roster wins"))] },
  { node: "AR architect B, roster precedence", kind: "fix", file: "arena", checks: [
    inSection("## Phase A", need(/roster the caller supplies wins/, "arena honors a caller roster"), need(/architect-runners/, "names architect's roster"))] },
  { node: "AC architect C, opt-in approval", kind: "guard", file: "architect", checks: [
    need(/Phase C: Agree \(opt-in\)/, "approval is opt-in")] },
  { node: "I one implementation, caller boundary", kind: "fix", file: "architect", checks: [
    inSection("## When a playbook step calls this skill", need(/stop after Phase C/, "architect stops for an implementing caller"),
      need(/Do not implement the design as well/, "no second implementation"))] },
  { node: "I one implementation, caller boundary", kind: "fix", file: "bugfix", checks: [
    inStep(3, need(/Architect stops after Phase C/, "the caller side of the boundary"), need(/its Phase D/, "the delegate is Phase D"),
      need(/one subagent/, "exactly one implementation delegate"), need(/back to Architect Phase B/, "the design-violation return"))] },
  { node: "I one implementation, caller boundary", kind: "fix", file: "architect", checks: [
    inSection("## When a playbook step calls this skill", need(/Feature step 2/, "Feature is an implementing caller"))] },
  { node: "I one implementation, caller boundary", kind: "fix", file: "feature", checks: [
    inStep(2, need(/Architect stops after Phase C/, "Feature stops Architect before implementing"),
      need(/its Phase D/, "the step 4 delegate is Phase D"))] },
  { node: "Arena rubric, blind fan-out, judge, read, graft", kind: "guard", file: "arena", checks: [
    need(/do not send the spawn until it exists/, "rubric before spawn"), need(/forbids reading any sibling/, "blind siblings"),
    need(/Don't spawn the judge while candidates are still writing/, "judge after candidates"),
    need(/Read every candidate end to end/, "parent reads every candidate"), need(/synthesis\.md/, "the synthesis artifact")] },
  { node: "Arena F, sketch versus runtime proof", kind: "fix", file: "arena", checks: [
    inSection("## Phase F", need(/verified as a sketch/, "design verification is distinct from runtime proof"))] },
  { node: "Arena runner is a leaf", kind: "fix", file: "runner", checks: [
    need(/You are a leaf job/, "the runner's boundary"), forbid(/each on a different model/, "a Tier 3 claim on every host")] },
  { node: "N cleanup and no-comments before review", kind: "fix", file: "bugfix", checks: [
    inStep(3, ordered([/one subagent/, /Gate, before review/, /no-comments/, /review the diff yourself/], "cleanup before review"))] },
  { node: "N cleanup and no-comments before review", kind: "fix", file: "noComments", checks: [
    need(/invalidates the caller's earlier verification/, "no-comments reports stale proof")] },
  { node: "Q/J interrogate and its return path", kind: "fix", file: "interrogate", checks: [
    inSection("## Returning to the caller", need(/Act-on finding/, "findings go back to the caller"))] },
  { node: "Q/J interrogate and its return path", kind: "fix", file: "bugfix", checks: [
    inStep(3, need(/operator/, "an operator reviewer"), need(/fresh implementation delegate/, "accepted findings re-implemented"),
      need(/open blocker/, "unresolved blockers reported"), need(/does not claim success/, "no success over a blocker"))] },
  { node: "S4 verify, frozen harness, stale proof", kind: "fix", file: "bugfix", checks: [
    inStep(4, need(/frozen at the failing-test commit/, "the frozen harness"), need(/stale/, "stale after a later edit"),
      need(/back to step 2/, "failure returns to the hypotheses"))] },
  { node: "S5 order commits", kind: "fix", file: "bugfix", checks: [
    inStep(5, need(/failing-check commit from step 1/, "history ordering, not first capture"), need(/technical-writing/, "commit messages"))] },
  { node: "S6 Opening a PR", kind: "fix", file: "bugfix", checks: [
    inStep(6, need(/back to step 4/, "a PR-time edit re-verifies"))] },
  { node: "S6 Opening a PR", kind: "fix", file: "pr", checks: [
    need(/Stale proof/, "PR-time edits invalidate verification"),
    forbid(/subagent that opens a PR runs `?interrogate/, "a leaf running an orchestrating skill"),
    need(/does not start a babysit/, "no automatic babysit")] },
  { node: "F final evidence and audit block", kind: "guard", file: "bugfix", checks: [
    need(/who wrote the implementation/, "implementation owner"), need(/every step and gate marked done/, "gate statuses")] },
  { node: "F final evidence and audit block", kind: "fix", file: "bugfix", checks: [
    need(/Gate, before sending the reply/, "unslop on the reply, as a timed gate")] },
  { node: "Leaf jobs stay leaves", kind: "fix", file: "worker", checks: [
    need(/Do not re-run its routing/, "the worker does not re-route"), need(/one leaf job/, "the leaf contract")] },
  { node: "Leaf jobs stay leaves", kind: "fix", file: "delegation", checks: [
    need(/Every leaf brief states its boundary/, "the brief carries the boundary"), leafPromptsStayLeaves] },
  { node: "F run record and completion check", kind: "fix", file: "runRecord", checks: [
    need(/def problems/, "the completion checker ships")] },
  { node: "F run record and completion check", kind: "fix", file: "bugfix", checks: [
    inStep(1, need(/rr baseline/, "the frozen baseline is recorded"), need(/rr evidence --kind repro --result fail/, "the failing repro is recorded")),
    inStep(4, need(/rr evidence --kind verify/, "each verification is recorded"), need(/--harness original/, "the original harness is recorded")),
    inStep(6, need(/rr check --through commits/, "the check gates PR creation")),
    need(/final `rr check` output/, "the audit block carries the check")] },
  { node: "Every playbook keeps a run record", kind: "fix", file: "router", checks: [
    need(/Every playbook run keeps a run record/, "the router starts a record for every playbook"),
    need(/tasks --json/, "the checklist and phase ids come from the run record"),
    need(/phase <id> --done/, "exported phases are marked as they end"),
    need(/phase <id> --start/, "exported phases are started before work"),
    need(/Mandatory verification cannot be skipped/, "verification is mandatory"),
    need(/--run <id>/, "concurrent sessions use an explicit run id")] },
  { node: "B host profile belongs to this host", kind: "fix", file: "router", checks: [
    need(/only when its `host` names the host/, "a foreign profile is ignored"), need(/"source": "default"/, "assumed capabilities are named")] },
  { node: "B host profile belongs to this host", kind: "fix", file: "hostBinding", checks: [
    need(/This build is for host key `[a-z]+`/, "the binding names its host key")] },
  { node: "B host profile belongs to this host", kind: "fix", file: "capabilities", checks: [
    need(/Trust it only when its `host` is this host/, "declared profiles are host-checked")] },
  { node: "B host profile belongs to this host", kind: "fix", file: "setup", checks: [
    need(/"source": "observed"/, "observed and default are recorded"), need(/pstack doctor/, "setup validates what it wrote")] },
  { node: "Delegates are bounded and recoverable", kind: "fix", file: "delegation", checks: [
    inSection("## Bounds and recovery", need(/One retry/, "a retry limit"), need(/Time budget/, "a time budget"),
      need(/cancel it where the host\s+can/, "cancellation where supported"), need(/rr pause/, "a resume point"))] },
  { node: "Delegates are bounded and recoverable", kind: "fix", file: "runRecord", checks: [
    need(/MAX_ATTEMPTS = 2/, "the record enforces one retry"), need(/def cmd_pause/, "pause records a resume point")] },
  { node: "Delegates are bounded and recoverable", kind: "fix", file: "pause", checks: [
    need(/--status cancelled/, "a paused run records cancelled delegates")] },
];

const hosts = readdirSync(DIST).filter((h) => statSync(join(DIST, h)).isDirectory());
if (!hosts.length) { console.error(`no host trees under ${DIST}`); process.exit(2); }

const failures = [];
const byNode = new Map();
const byContract = CONTRACTS.map(() => 0);
for (const host of hosts) {
  const tree = walk(join(DIST, host));
  CONTRACTS.forEach((c, i) => {
    const matches = tree.filter((f) => FILES[c.file].test(f));
    const problems = !matches.length ? [`no ${c.file} file in this build`]
      : matches.flatMap((f) => c.checks.flatMap((check) => check(readFileSync(f, "utf8"), f, tree)));
    const row = byNode.get(c.node) ?? { kind: new Set(), pass: 0, total: 0 };
    row.kind.add(c.kind); row.total++; if (!problems.length) { row.pass++; byContract[i]++; }
    byNode.set(c.node, row);
    for (const p of problems) failures.push(`${host.padEnd(8)} ${c.node} [${c.file}]: ${p}`);
  });
}

// --contracts lists each contract with the hosts it passed in. Run it against a build of the
// text before a fix to show each `fix` contract fails there and each `guard` still passes.
if (process.argv.includes("--contracts")) {
  CONTRACTS.forEach((c, i) => console.log(`${String(i + 1).padStart(2)} ${c.kind.padEnd(5)} ${byContract[i]}/${hosts.length} ${c.node} [${c.file}]`));
  process.exit(0);
}

for (const [node, r] of byNode)
  console.log(`${r.pass === r.total ? "ok  " : "FAIL"} ${node.padEnd(48)} ${[...r.kind].join("+").padEnd(9)} ${r.pass}/${r.total}`);
console.log(`\n${CONTRACTS.length} contracts x ${hosts.length} hosts, ${failures.length} problem(s)`);
if (failures.length) { console.log(""); failures.forEach((f) => console.log("  " + f)); process.exit(1); }
console.log("routing contract holds in every host");
