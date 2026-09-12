#!/usr/bin/env node
// Prove the built distributions are internally consistent. Exits non-zero on any failure.
import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { ensureBuildLock } from "./build-lock.mjs";
ensureBuildLock();

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const manifest = JSON.parse(readFileSync(join(ROOT, "core", "manifest.json"), "utf8"));
const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

const hostTier = (h) => ({ claude: 2, codex: 2, copilot: 3, cursor: 3, generic: 0 })[h] ?? 0;
const hostKey = (h) => ({ claude: "claude-code", codex: "codex", copilot: "copilot", cursor: "cursor", generic: "generic" })[h] ?? h;
const host_skillDir = (h) => ({
  claude: ".claude/skills", codex: ".agents/skills", copilot: ".github/skills",
  cursor: "skills", generic: "pstack/skills",
})[h] ?? "skills";

// A pstack skill invoked with a slash. Codex takes `$name` and its build must say so.
const SKILL_NAMES = [...new Set(manifest.skills.flatMap((s) => [s.name, s.dir]))];
// The build's rewrite, applied again to compare the skeleton.
const SKILL_CALL = new RegExp(`(?<![\\w.~/:-])/(${SKILL_NAMES.join("|")})(?![\\w/-]|\\.\\w)`, "g");
// Looser than the rewrite on purpose, so a slash invocation it misses still shows up here.
const LOOSE_CALL = new RegExp(`(?<![\\w/~.])/(${SKILL_NAMES.join("|")})\\b(?!/)`, "m");

const fails = [];
const warns = [];
const fail = (h, m) => fails.push(`${h}: ${m}`);

const VENDOR_LEAK = /claude-fable-5-1|grok-4\.6|gpt-5\.6-sol|opus-5-thinking|subagent_type:|readonly:\s*(?:true|false)|\.cursor\/rules|pstack-models\.mdc|AskQuestion/;

for (const host of readdirSync(DIST)) {
  const base = join(DIST, host);
  // dist/ holds one directory per host. A stray file here used to crash the walk.
  if (!statSync(base).isDirectory()) { warns.push(`ignoring non-host entry dist/${host}`); continue; }
  const files = walk(base);
  const md = files.filter((f) => f.endsWith(".md"));
  const cache = files.find((f) => /\/__pycache__\/|\.pyc$/.test(f));
  if (cache) fail(host, `bytecode cache shipped: ${cache.slice(base.length + 1)}`);
  let links = 0, checked = 0;

  for (const f of md) {
    const rel = f.slice(base.length + 1);
    const text = readFileSync(f, "utf8");

    // 1. frontmatter well-formed on every skill/agent surface
    if (/SKILL\.md$|\.prompt\.md$|\.instructions\.md$|\.chatmode\.md$|\.agent\.md$/.test(rel)
        || /(^|\/)(agents|personas)\//.test(rel)) {
      if (!text.startsWith("---\n")) fail(host, `no frontmatter: ${rel}`);
      else {
        const end = text.indexOf("\n---\n", 4);
        if (end === -1) fail(host, `unterminated frontmatter: ${rel}`);
        else {
          const fm = text.slice(4, end);
          if (!/(^|\n)(name|description|mode|applyTo):/.test(fm)) fail(host, `frontmatter missing identity: ${rel}`);
          for (const line of fm.split("\n")) {
            if (!line.trim()) continue;
            if (!/^[a-zA-Z-]+:/.test(line) && !/^\s+/.test(line))
              fail(host, `bad frontmatter line in ${rel}: ${line.slice(0, 60)}`);
            // A bare value starting with a YAML indicator parses as syntax, not text.
            const val = line.slice(line.indexOf(":") + 1).trim();
            if (val && /^[*&!|>%@`]/.test(val))
              fail(host, `unquoted YAML indicator in ${rel}: ${line.slice(0, 60)}`);
          }
        }
      }
    }

    // 2. no vendor leakage outside the runtime layer (which names hosts on purpose)
    const isRuntime = /pstack-runtime|host-profile|delegation\.md|capabilities\.md|roles\.md|interaction\.md|sticky-mode\.md|host-binding\.md/.test(rel);
    if (!isRuntime && host !== "cursor") {
      const m = text.match(VENDOR_LEAK);
      if (m) fail(host, `vendor leak "${m[0]}" in ${rel}`);
    }

    // 2b. a core placeholder that reached the build names a path no host has. `.pstack/skills/`
    // was one: an invented path no host loads, so a generated verify skill never registered.
    {
      // Only the build's own tokens. `{{BENNY_CONFIG_PATH}}` and its kind are the operator's to fill.
      const m = text.match(/\{\{(?:SKILL_DIR|USER_SKILL_DIR|MEMORY_FILE|RUNTIME_DIR)\}\}|(?<![\w~])\.pstack\/skills\//);
      if (m) fail(host, `unfilled or invented path "${m[0]}" in ${rel}`);
      // The generic build's layout. Check 4 skips `pstack/` refs as runtime state, so a command
      // naming one shipped to every host unnoticed and ran only on the generic build.
      const g = host !== "generic" && text.match(/(?<![\w.~\/-])pstack\/(?:skills|runtime|agents)\//);
      if (g) fail(host, `generic-only path "${g[0]}" in ${rel}`);
    }
    // 2c. a delegate's final message is all the parent receives, so its format is required.
    // The Copilot router agent is the entry point, not a delegate, so only manifest delegates count.
    {
      const d = rel.match(/(?:^|\/)(?:agents|personas)\/([^/]+?)(?:\.agent)?\.md$/);
      if (d && manifest.agents.some((a) => a.name === d[1]) && !/^## Output\s*$/m.test(text))
        fail(host, `delegate has no "## Output" section: ${rel}`);
    }

    // 3. relative markdown links resolve. A link target that starts with a single
    // dot-directory (`.github/foo.md`) is NOT the same thing as an already-relative
    // `./` or `../` target: it must still be resolved against the file that cites
    // it, same as a bare path. Missing that distinction let a link like
    // `(.github/copilot-instructions.md)` from inside `.github/skills/<x>/` pass
    // unchecked, resolving one directory into itself instead of up to the root.
    for (const m of text.matchAll(/\[[^\]]*\]\((\.{1,2}\/[^)#\s]+|\.[A-Za-z0-9_-]+\/[^)#\s]+\.md|[a-zA-Z0-9_-]+\/[^)#\s]+\.md)\)/g)) {
      if (/^\.?\/?build\//.test(m[1])) continue;
      links++;
      const target = resolve(dirname(f), m[1]);
      if (!existsSync(target)) { checked++; fail(host, `dead link ${m[1]} in ${rel}`); }
    }
    // 4. backticked path references. The commonest style in these skills is a bare
    // relative path with no leading "./" (`playbooks/prototype.md`), so anchoring on
    // a dot prefix made the majority of in-repo references invisible to this check.
    // A backticked path used as a Markdown link label is already checked as a
    // link; resolving the label text separately double-counts it and misreports.
    for (const m of text.matchAll(/`((?:\.{1,2}\/)?[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+\.(?:md|sh|ts|mjs|tsv|json|py))`(?!\]\()/g)) {
      const ref = m[1];
      if (/^https?:|^~|^\//.test(ref)) continue;
      // `.pstack/...` is runtime state written by /setup-pstack at install time,
      // not a file this repo ships. Referencing it is correct, not a dead link.
      if (/^\.?pstack\//.test(ref)) continue;
      // Repo tooling, named for a contributor's benefit. Not shipped into dist.
      if (/^\.?\/?(build|core)\//.test(ref)) continue;
      // The runtime layer documents every host's instruction-file path by name.
      // Those are other hosts' conventions, not files this build ships.
      if (/^(?:\.github\/copilot-instructions\.md|CLAUDE\.md|AGENTS\.md|\.cursor\/|\.claude\/|\.codex\/|\.agents\/)/.test(ref)) continue;
      links++;
      // A bare path resolves relative to the file, the dist root, or the skill root
      // (playbooks cite siblings as `playbooks/x.md` from the mode skill's perspective).
      const skillRoot = dirname(f).replace(/(\/(?:playbooks|references|scripts|assets)(\/.*)?)$/, "");
      const candidates = [resolve(dirname(f), ref), resolve(base, ref), resolve(skillRoot, ref)];
      if (!candidates.some(existsSync)) { checked++; fail(host, `dead ref ${ref} in ${rel}`); }
    }
      // 4b. artifacts of the bulk substitution rules: doubled articles and
    // phrase-replacements dropped into slots that needed a noun.
    for (const [re, why] of [
      [/\bthe the\b/g, "doubled article"],
      [/\b(?:a|an|the) (?:the|a|an) [a-z]/g, "doubled article"],
      [/'s the automated reviewer/g, "possessive + article collision"],
      [/skeptical the automated/g, "adjective + article collision"],
      [/About to a structured question/g, "verb slot filled with a noun phrase"],
      [/Use the a structured/g, "doubled article"],
      [/\)'s error message/g, "possessive attached to a parenthetical path"],
      [/calls the host's a /g, "article after possessive"],
    ]) {
      const m = text.match(re);
      if (m) fail(host, `mangled prose (${why}) in ${rel}: "${m[0]}"`);
    }
  }

  // 4c. structural defects in a skill surface itself
  for (const f of md) {
    const rel = f.slice(base.length + 1);
    const text = readFileSync(f, "utf8");
    if (!/SKILL\.md$|\.prompt\.md$|\.instructions\.md$|\.chatmode\.md$|\.agent\.md$/.test(rel)
        && !/(^|\/)(agents|personas)\//.test(rel)) continue;
    const end = text.indexOf("\n---\n", 4);
    if (end === -1) continue;
    if (!text.slice(end + 5).replace(/\s/g, "")) fail(host, `empty body: ${rel}`);
    const keys = text.slice(4, end).split("\n").filter((l) => /^[a-zA-Z-]+:/.test(l)).map((l) => l.split(":")[0]);
    const dupe = keys.find((k, i) => keys.indexOf(k) !== i);
    if (dupe) fail(host, `duplicate frontmatter key "${dupe}" in ${rel}`);
  }

  // 4d. markdown table shape. A row whose column count drifts from its header
  // renders as merged cells and silently loses a column of meaning.
  for (const f of md) {
    const rel = f.slice(base.length + 1);
    const lines = readFileSync(f, "utf8").split("\n");
    let header = 0, ln = 0;
    for (const line of lines) {
      ln++;
      const isRow = /^\s*\|.*\|\s*$/.test(line);
      if (!isRow) { header = 0; continue; }
      const cols = line.trim().split("|").length - 2;
      if (!header) { header = cols; continue; }
      if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) continue;
      if (cols !== header) fail(host, `table row has ${cols} columns, header has ${header}, ${rel}:${ln}`);
    }
  }

  // 4e. repeated paragraphs. An additive rewrite rule that matches its own output
  // duplicates a block silently, and every other check still passes.
  for (const f of md) {
    const rel = f.slice(base.length + 1);
    const paras = readFileSync(f, "utf8").split(/\n\s*\n/)
      .map((x) => x.trim())
      // Prose only. A repeated bullet block (three identical delegate specs, say)
      // is legitimate structure, not duplicated text.
      .filter((x) => x.length > 200 && !x.split("\n").every((l) => /^\s*[-*|>]|^\s*\d+\./.test(l)));
    const seen = new Set();
    for (const par of paras) {
      if (seen.has(par)) { fail(host, `duplicated paragraph in ${rel}: "${par.slice(0, 60)}..."`); break; }
      seen.add(par);
    }
  }

  // 4f. completeness. Every skill in core must reach every host, unless the
  // manifest says otherwise on purpose. A silently short build is a partial port.
  {
    const expected = manifest.skills.filter((s) => s.hosts.includes("*") || s.hosts.includes(hostKey(host)));
    const dir = join(base, host_skillDir(host));
    if (existsSync(dir)) {
      const present = new Set(readdirSync(dir));
      const missing = expected.map((s) => s.dir).filter((d) => !present.has(d) && !present.has(`${d}.instructions.md`));
      const instrDir = join(base, ".github/instructions");
      const inInstr = existsSync(instrDir) ? new Set(readdirSync(instrDir).map((f) => f.replace(/\.instructions\.md$/, ""))) : new Set();
      const reallyMissing = missing.filter((d) => !inInstr.has(d));
      if (reallyMissing.length) fail(host, `incomplete port: ${reallyMissing.length} skill(s) absent: ${reallyMissing.join(", ")}`);
      if (expected.length !== manifest.skills.length)
        warns.push(`${host}: ${manifest.skills.length - expected.length} skill(s) deliberately excluded by the manifest`);
    }
  }

  // 4g. playbooks carry the steps the router copies verbatim into the task list.
  // They were checked for existence on one host and never for content.
  {
    const pbDir = join(base, host_skillDir(host), "poteto-mode", "playbooks");
    if (existsSync(pbDir)) {
      const present = readdirSync(pbDir);
      for (const pb of manifest.playbooks) {
        if (!present.includes(pb.file)) { fail(host, `missing playbook: ${pb.file}`); continue; }
        const body = readFileSync(join(pbDir, pb.file), "utf8").replace(/^>.*$/gm, "").trim();
        if (body.length < 200) fail(host, `playbook is empty or truncated: ${pb.file} (${body.length} bytes)`);
        if (!/^\s*(\d+\.|[-*])/m.test(body)) fail(host, `playbook has no steps: ${pb.file}`);
      }
      if (present.length !== manifest.playbooks.length)
        fail(host, `playbook count ${present.length}, expected ${manifest.playbooks.length}`);
      // Every playbook run keeps a run record, and `pstack serve` draws it from this graph.
      const rj = join(base, host_skillDir(host), "poteto-mode", "scripts", "routes.json");
      if (!existsSync(rj)) fail(host, "missing poteto-mode/scripts/routes.json: run build/gen-routes.py");
      else {
        const routes = JSON.parse(readFileSync(rj, "utf8"));
        for (const pb of manifest.playbooks) {
          const r = routes[pb.file.replace(/\.md$/, "")];
          if (!r || !r.phases?.length) fail(host, `routes.json has no phase graph for ${pb.file}`);
          else if (r.edges.some((e) => !r.phases.some((p) => p.id === e.from) || !r.phases.some((p) => p.id === e.to)))
            fail(host, `routes.json ${pb.file}: an edge names a phase the route does not have`);
        }
      }
    }
  }

  // 4h. the per-host user guide is generated, so it must exist and must agree
  // with the tier and paths this build actually emitted.
  {
    const f = join(base, "USAGE.md");
    if (!existsSync(f)) fail(host, "missing USAGE.md");
    else {
      const t = readFileSync(f, "utf8");
      if (!new RegExp(`Tier ${hostTier(host)}`).test(t))
        fail(host, `USAGE.md does not state Tier ${hostTier(host)}`);
      for (const s of ["## 1. Install", "## 3. Invoking things here", "## 11. The skills", "## 12. The playbooks"])
        if (!t.includes(s)) fail(host, `USAGE.md missing section: ${s}`);
      const listed = (t.match(/^\| `[/$][a-z-]+` \|/gm) || []).length;
      const expected = manifest.skills.filter((x) => x.kind !== "principle" && !x.paths).length;
      if (listed < expected) fail(host, `USAGE.md lists ${listed} invocable skills, expected ${expected}`);
    }
  }

  // 4i. the full reference is generated, so it must cover everything that shipped.
  {
    const f = join(base, "REFERENCE.md");
    if (!existsSync(f)) fail(host, "missing REFERENCE.md");
    else {
      const t = readFileSync(f, "utf8");
      const want = manifest.skills.filter((s) => (s.hosts.includes("*") || s.hosts.includes(hostKey(host))) && s.kind !== "principle");
      for (const s of want)
        if (!t.includes(`### ${hostTier(host) >= 0 ? "" : ""}`) || !new RegExp(`### \`[/$]${s.dir}\``).test(t))
          fail(host, `REFERENCE.md does not document skill: ${s.dir}`);
      for (const pb of manifest.playbooks)
        if (!new RegExp(`### \`${pb.name}\``).test(t)) fail(host, `REFERENCE.md does not document playbook: ${pb.name}`);
      for (const a of manifest.agents)
        if (!new RegExp(`### \`${a.name}\``).test(t)) fail(host, `REFERENCE.md does not document delegate: ${a.name}`);
    }
  }

  // 5. structural expectations
  const need = {
    "claude": [".claude/skills/poteto-mode/SKILL.md", ".claude/agents/pstack-worker.md", ".claude/skills/pstack-runtime/host-binding.md", "CLAUDE.md", ".claude/skills/poteto-mode/playbooks/bug-fix.md", ".claude-plugin/plugin.json", ".claude-plugin/marketplace.json"],
    "codex": [".agents/skills/poteto-mode/SKILL.md", "AGENTS.md", ".agents/skills/pstack-runtime/host-binding.md", ".agents/skills/poteto-mode/agents/openai.yaml", ".codex/config.toml.example"],
    "copilot": [".github/skills/poteto-mode/SKILL.md", ".github/copilot-instructions.md", ".github/agents/pstack-worker.agent.md", ".github/instructions/typescript-best-practices.instructions.md"],
    "cursor": ["skills/poteto-mode/SKILL.md", "agents/pstack-worker.md", ".cursor/rules/pstack.mdc", ".cursor-plugin/plugin.json"],
    "generic": ["pstack/skills/poteto-mode/SKILL.md", "pstack/AGENTS.md"],
  }[host] ?? [];
  for (const n of need) if (!existsSync(join(base, n))) fail(host, `missing required file: ${n}`);

  // 5b. one mode block. The Enter step copies sticky-mode.md's block, `pstack init` installs the
  // instructions file's, and two texts shipped once.
  {
    const mem = { claude: "CLAUDE.md", codex: "AGENTS.md", copilot: ".github/copilot-instructions.md",
                  cursor: ".cursor/rules/pstack.mdc", generic: "pstack/AGENTS.md" }[host];
    const sticky = join(base, host === "generic" ? "pstack/runtime" : `${host_skillDir(host)}/pstack-runtime`, "sticky-mode.md");
    const block = (p) => existsSync(p) && readFileSync(p, "utf8").match(/<!-- pstack:mode:start -->[\s\S]*?<!-- pstack:mode:end -->/)?.[0];
    const a = block(join(base, mem)), b = block(sticky);
    if (!a || !b) fail(host, `mode block missing from ${!a ? mem : "sticky-mode.md"}`);
    else if (a !== b) fail(host, `mode block in ${mem} differs from the one sticky-mode.md tells a session to write`);
  }

  // 5c. the plan skeleton is copied out of the playbook, and check-plan.mjs reads its placeholders
  // from the playbook beside it. The build must ship the skeleton byte for byte, and the script must
  // find it and reject it unfilled.
  {
    const skel = (t) => t.replace(/\r\n/g, "\n").split("````markdown\n")[1]?.split("\n````")[0];
    const dir = join(base, host_skillDir(host), "poteto-mode");
    const pb = join(dir, "playbooks", "multi-phase-plan.md");
    const core = skel(readFileSync(join(ROOT, "core", "playbooks", "multi-phase-plan.md"), "utf8"));
    // Codex's build rewrites skill invocations to `$name`, inside the skeleton too.
    const want = host === "codex"
      ? core.replace(SKILL_CALL, (_m, n) => `$${n}`) : core;
    if (existsSync(pb) && skel(readFileSync(pb, "utf8")) !== want)
      fail(host, "multi-phase-plan.md skeleton differs from core, so a copied plan and check-plan.mjs disagree");
    const script = join(dir, "scripts", "check-plan.mjs");
    if (existsSync(script)) {
      const plan = join(mkdtempSync(join(tmpdir(), "pstack-verify-")), "plan.md");
      writeFileSync(plan, want + "\n");
      const r = spawnSync(process.execPath, [script, plan], { encoding: "utf8" });
      if (r.status !== 1 || !/unfilled placeholder/.test(r.stderr))
        fail(host, `check-plan.mjs did not reject the unfilled skeleton (exit ${r.status}): ${r.stderr.slice(0, 120)}`);
      const filled = join(ROOT, "packaging", "tests", "fixtures", "check_plan", "filled-plan.md");
      const ok = existsSync(filled) && spawnSync(process.execPath, [script, filled], { encoding: "utf8" });
      if (ok && ok.status !== 0)
        fail(host, `check-plan.mjs rejected the filled plan fixture (exit ${ok.status}): ${ok.stderr.slice(0, 120)}`);
    }
  }

  // 5d. Codex invokes a skill as `$name`, so its build never tells anyone to type `/name`.
  if (host === "codex") {
    for (const f of files.filter((x) => /\.(md|mdc|toml|example|yaml|json)$/.test(x))) {
      // Codex has no `/loop`. Only a user's trigger phrase, the skeleton's host-neutral line, and the
      // notes saying so may name it; image alt text describes a picture.
      const loops = readFileSync(f, "utf8").replace(/!\[[^\]]*\]/g, "")
        .replace(/Codex has no `\/loop` command|"\/loop until X"|`\/loop` where the host has one/g, "");
      const at = loops.indexOf("/loop");
      if (at !== -1)
        fail(host, `tells the agent to use /loop, which Codex lacks, in ${f.slice(base.length + 1)}: `
          + `"${loops.slice(Math.max(0, at - 50), at + 30).replace(/\s+/g, " ")}"`);
      // Image alt text keeps its words, and a URL is not an invocation.
      const t = readFileSync(f, "utf8").replace(/!\[[^\]]*\]/g, "").replace(/\bhttps?:\/\/\S+/g, "");
      const m = t.match(LOOSE_CALL);
      if (m) { fail(host, `slash invocation "${m[0].trim()}" in ${f.slice(base.length + 1)}; Codex takes $name`); break; }
    }
  }

  console.log(`${host.padEnd(9)} files=${String(files.length).padStart(3)} md=${String(md.length).padStart(3)} links=${String(links).padStart(3)} dead=${checked}`);
}

// A skill that declares `paths` in core must carry it through to every host that
// supports glob scoping. It was silently dropped once by a ternary whose branches
// were identical, and nothing noticed because the skill still loaded.
{
  const pathScoped = manifest.skills.filter((s) => s.paths).map((s) => s.dir);
  for (const [host, loc] of [["claude", ".claude/skills/%/SKILL.md"], ["cursor", "skills/%/SKILL.md"],
                             ["copilot", ".github/instructions/%.instructions.md"]]) {
    if (!existsSync(join(DIST, host))) continue;
    for (const d of pathScoped) {
      const f = join(DIST, host, loc.replace("%", d));
      if (!existsSync(f)) { fail(host, `path-scoped skill missing: ${loc.replace("%", d)}`); continue; }
      const t = readFileSync(f, "utf8");
      if (!/^(paths|applyTo):\s*\S/m.test(t)) fail(host, `path-scoped skill lost its glob: ${d}`);
    }
  }
}

// The read-only delegate's contract has to be enforced by the platform, not its prompt.
// On Claude Code the `tools` whitelist is the enforcement. A `disallowedTools` beside it is dead,
// so the check is that the whitelist exists and grants no file-editing tool.
{
  const p = join(DIST, "claude", ".claude/agents/pstack-reviewer.md");
  if (existsSync(p)) {
    const t = readFileSync(p, "utf8");
    const tools = t.match(/^tools:\s*"?([^"\n]*)"?/m);
    if (!tools) fail("claude", "read-only delegate not enforced: pstack-reviewer has no tools whitelist");
    else if (/\b(Write|Edit|NotebookEdit)\b/.test(tools[1])) fail("claude", `pstack-reviewer's tools whitelist grants editing: ${tools[1]}`);
    if (/^disallowedTools:/m.test(t)) fail("claude", "pstack-reviewer sets disallowedTools beside a tools whitelist, where it is dead");
  }
}
for (const [host, f, keys] of [
                               ["cursor", "agents/pstack-reviewer.md", ["readonly"]],
                               ["copilot", ".github/agents/pstack-reviewer.agent.md", ["tools"]]]) {
  const p = join(DIST, host, f);
  if (!existsSync(p)) continue;
  const t = readFileSync(p, "utf8");
  for (const k of keys) if (!new RegExp(`^${k}:`, "m").test(t))
    fail(host, `read-only delegate not enforced: ${f} lacks ${k}`);
}

// Codex enforces the read-only delegate in config.toml, not in the persona file.
if (existsSync(join(DIST, "codex"))) {
  const cfg = join(DIST, "codex", ".codex", "config.toml.example");
  if (!existsSync(cfg) || !/\[agents\.pstack-reviewer\][\s\S]*sandbox_mode\s*=\s*"read-only"/.test(readFileSync(cfg, "utf8")))
    fail("codex", "read-only delegate not enforced: config.toml.example lacks [agents.pstack-reviewer] sandbox_mode");
}

// A Copilot subagent is selected by exact, case-sensitive name. The two doc
// sources disagree on the filename-derived default, so the name must be explicit
// and must match the file. And the router agent is what makes delegation
// reachable at all: without it nothing carries the `agent` tool or an allow-list.
if (existsSync(join(DIST, "copilot", ".github", "agents"))) {
  const ad = join(DIST, "copilot", ".github", "agents");
  const files = readdirSync(ad).filter((f) => f.endsWith(".agent.md"));
  for (const f of files) {
    const want = f.replace(/\.agent\.md$/, "");
    const t = readFileSync(join(ad, f), "utf8");
    const m = t.match(/^name:\s*"?([^"\n]+)"?\s*$/m);
    if (!m) fail("copilot", `agent has no explicit name: .github/agents/${f}`);
    else if (m[1].trim() !== want)
      fail("copilot", `agent name "${m[1].trim()}" does not match file ${f}`);
  }
  const router = join(ad, "pstack.agent.md");
  if (!existsSync(router)) fail("copilot", "missing router agent .github/agents/pstack.agent.md");
  else {
    const t = readFileSync(router, "utf8");
    if (!/^tools:.*"agent"/m.test(t))
      fail("copilot", "router agent lacks the `agent` tool, so it cannot invoke a subagent");
    if (!/^agents:\s*\[/m.test(t))
      fail("copilot", "router agent lacks an `agents` allow-list");
  }
}

// Copilot must not emit the retired chatmode surface or the deprecated `mode:` key.
if (existsSync(join(DIST, "copilot"))) {
  for (const f of walk(join(DIST, "copilot"))) {
    if (f.endsWith(".chatmode.md")) fail("copilot", `retired chatmode surface: ${f}`);
    // Prompt files are deprecated and are not loaded by Agent Host at all.
    if (f.endsWith(".prompt.md")) fail("copilot", `deprecated prompt-file surface: ${f}`);
  }
}

// Copilot applyTo must be present and non-empty
for (const f of (existsSync(join(DIST, "copilot", ".github/instructions")) ? walk(join(DIST, "copilot", ".github/instructions")) : [])) {
  if (!f.endsWith(".instructions.md")) continue;
  const t = readFileSync(f, "utf8");
  if (!/^applyTo:\s*\S/m.test(t)) fail("copilot", `instructions file without applyTo: ${f}`);
}

// Copilot delegates must actually be able to read a file. `search` only searches,
// it does not read file contents, and `read/readFile` lives under the `read`
// set. A `tools:` whitelist missing the bare `read` set (whatever else it lists)
// silently strips every delegate's ability to open a file, since an unrecognized
// or absent id is dropped without error rather than rejected.
if (existsSync(join(DIST, "copilot", ".github/agents"))) {
  for (const f of walk(join(DIST, "copilot", ".github/agents"))) {
    if (!f.endsWith(".agent.md")) continue;
    const t = readFileSync(f, "utf8");
    const m = t.match(/^tools:\s*(\[[^\]]*\])/m);
    if (!m) continue;
    let ids = [];
    try { ids = JSON.parse(m[1]); } catch { fail("copilot", `unparseable tools array: ${f}`); continue; }
    if (!ids.includes("read")) fail("copilot", `agent tools lack the "read" set, cannot read file contents: ${f}`);
  }
}

// The repository's REFERENCE.md and USAGE.md are written by the build from the Claude Code ones.
for (const doc of ["REFERENCE.md", "USAGE.md"]) {
  const built = join(DIST, "claude", doc), root = join(ROOT, doc);
  if (existsSync(built) && (!existsSync(root) || readFileSync(root, "utf8") !== readFileSync(built, "utf8")))
    fail("claude", `${doc} at the repository root differs from dist/claude/${doc}: run the build`);
}

console.log("");
if (warns.length) { console.log(`warnings (${warns.length}):`); warns.slice(0, 15).forEach((w) => console.log("  " + w)); }
if (fails.length) { console.log(`\nFAILURES (${fails.length}):`); fails.slice(0, 25).forEach((f) => console.log("  " + f)); process.exit(1); }
console.log(warns.length ? "\nstructure OK, link warnings above" : "\nall checks passed");
