#!/usr/bin/env node
// Compile the vendor-neutral pstack core into each host's native layout.
// No dependencies. Deterministic. `node build/build.mjs [host...]`
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { ensureBuildLock } from "./build-lock.mjs";
ensureBuildLock();

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CORE = join(ROOT, "core");
const DIST = join(ROOT, "dist");
const manifest = JSON.parse(readFileSync(join(CORE, "manifest.json"), "utf8"));
// Core text that is wrong on one host, and what that host gets instead. It applies to every built
// text file and to routes.json, which carries the playbooks' step text. The generic rule catches any
// new "host's `/loop` command" so none can slip past.
const HOST_TEXT = {
  // Codex has no `/loop`. A heartbeat becomes a scheduled `codex exec` run from cron or CI, a watch a
  // foreground polling loop. Every replacement says "Codex has no `/loop` command", the phrase
  // verify.mjs allows. The router's user-phrased triggers ("/loop until X") stay: a user may type them.
  codex: [
    [/Pick the wake mechanism using the host's `\/loop` command \(a built-in, not a pstack skill\)\./g,
      "Pick the wake mechanism. Codex has no `/loop` command, so the heartbeat is a scheduled `codex exec` run from cron or CI."],
    [/the host's `\/loop` command/g, "a scheduled `codex exec` run from cron or CI (Codex has no `/loop` command)"],
    // routes.json also keeps a short label per step, backticks stripped.
    [/the host's \/loop command/g, "a scheduled codex exec run"],
    [/A local root arms each tick as a real terminal `\/loop`\./g,
      "A local root arms each tick as a scheduled `codex exec` run from cron or CI, since Codex has no `/loop` command."],
    [/The loop uses a monitored-shell 30-minute sleep and emits an output-notification sentinel\./g,
      "Without cron or CI, a foreground shell loop that sleeps 30 minutes and prints a sentinel stands in."],
    [/Run `drive` and `background` under `\/loop` in dynamic mode\./g,
      "Run `drive` and `background` in a foreground polling loop, paced as each mode says, since Codex has no `/loop` command."],
    [/Hold the watch under `\/loop` in dynamic mode\./g,
      "Hold the watch in a foreground polling loop, since Codex has no `/loop` command."],
    [/`\/loop` per component until the diff is zero\./g,
      "Repeat per component in a foreground loop until the diff is zero, since Codex has no `/loop` command."],
    // The guide: an example prompt, and prose about a command Codex does not have.
    [/^\/loop until done\./gm, "keep going until done."],
    [/`\/loop` is your agent host's built-in wake mechanism, not a pstack skill\./g,
      "Codex has no `/loop` command, the built-in wake mechanism other hosts have. On Codex the wake mechanism is a scheduled `codex exec` run from cron or CI, and it is not a pstack skill either."],
    [/Give `\/loop` a predicate/g, "Give the loop a predicate"],
    [/gives `\/loop` nothing to check/g, "gives the loop nothing to check"],
  ],
};
// How a user invokes a skill by name. Codex takes `$name`; every other host takes `/name`.
const INVOKE = { codex: "$" };
const SKILL_NAMES = [...new Set(manifest.skills.flatMap((s) => [s.name, s.dir]))];
// Any `/name` not glued to a path, a URL or a word: `**/how**`, `[/why](#x)`, `a|/swarm|b` all count.
const SKILL_CALL = new RegExp(`(?<![\\w.~/:-])/(${SKILL_NAMES.join("|")})(?![\\w/-]|\\.\\w)`, "g");
const REF = {
  skills: JSON.parse(readFileSync(join(CORE, "reference", "skills.json"), "utf8")),
  playbooks: JSON.parse(readFileSync(join(CORE, "reference", "playbooks.json"), "utf8")),
  principles: JSON.parse(readFileSync(join(CORE, "reference", "principles.json"), "utf8")),
};

/* ---------------------------------------------------------------- helpers */
const write = (p, s) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s); };
const read = (p) => readFileSync(p, "utf8");
// Importing run-record.py during the build leaves bytecode beside it, and the manifest lists it.
const shipped = (p) => !/(^|\/)__pycache__(\/|$)|\.pyc$/.test(p);
const walk = (d) => readdirSync(d).filter(shipped).flatMap((f) => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

function splitFm(text) {
  if (!text.startsWith("---\n")) return { fm: {}, body: text };
  const end = text.indexOf("\n---\n", 4);
  if (end === -1) return { fm: {}, body: text };
  const fm = {};
  const lines = text.slice(4, end).split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const c = line.indexOf(":");
    if (c <= 0 || /^\s/.test(line)) continue;
    const key = line.slice(0, c).trim();
    let val = line.slice(c + 1).trim();
    // YAML block scalar: the value is the indented block that follows, not the indicator.
    if (val === ">" || val === ">-" || val === "|" || val === "|-") {
      const fold = val.startsWith(">");
      const parts = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) parts.push(lines[++i].trim());
      val = parts.join(fold ? " " : "\n");
    }
    fm[key] = val;
  }
  return { fm, body: text.slice(end + 5) };
}
const yamlStr = (s) => {
  const v = String(s).replace(/^"|"$/g, "").replace(/\\"/g, '"');
  // Quote unless the value is unambiguously plain YAML. Globs (`*`), anchors (`&`),
  // tags (`!`) and block markers (`|`, `>`) all parse as syntax when left bare.
  return /^[A-Za-z0-9][A-Za-z0-9 _.\/()-]*$/.test(v) ? v : JSON.stringify(v);
};
// `paths` arrives from the manifest as the raw source string (`["**/*.ts", "**/*.tsx"]`).
// Both Claude Code and Cursor accept a comma-separated glob string.
const globList = (raw) => raw ? raw.replace(/^\[|\]$/g, "").replace(/"/g, "").replace(/,\s*/g, ",") : undefined;

const emitFm = (obj) =>
  "---\n" + Object.entries(obj).filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? JSON.stringify(v) : yamlStr(v)}`).join("\n") + "\n---\n";

/* ------------------------------------------------------------ host config */
const HOSTS = {
  "claude-code": {
    usage: {
      invoke: "Type `/name` in the chat input. Claude also loads a skill on its own when the request matches its description, unless the skill is marked manual-invoke only.",
      manual: "`/poteto-mode`",
      delegate: "Skills spawn delegates with the `Agent` tool, naming `pstack-worker` or `pstack-reviewer` as the `subagent_type`. Several `Agent` calls in one message run in parallel. Nesting works to three levels by default.",
      readonly: "`pstack-reviewer` ships with a `tools` whitelist that leaves out `Write`, `Edit` and `NotebookEdit`. That removes the file-editing tools and nothing else: the agent keeps `Bash`, which can write, so the repository boundary is the persona's instruction. A reviewer writes probes only under its own output path.",
      models: "A delegate takes a tier alias (`opus`, `sonnet`, `haiku`, `fable`) at the call site. A predefined agent file may pin a full model ID such as `claude-opus-5`. Every one is a Claude model, which is why panels here are Tier 2 and use stances for the rest of the diversity.",
      enable: [],
      gotchas: [
        "The build ships a plugin manifest at `.claude-plugin/`. Install it into a project with `pstack init --host claude`, or add the directory as a plugin marketplace and get versioned updates.",
        "Skills that bundle scripts pre-approve them with `allowed-tools`, so running them does not prompt.",
      ],
    },
    dir: "claude", label: "Claude Code",
    skillDir: ".claude/skills", skillFile: (n) => `${n}/SKILL.md`,
    runtimeDir: ".claude/skills/pstack-runtime",
    agentDir: ".claude/agents", agentFile: (n) => `${n}.md`,
    memory: "CLAUDE.md", tier: 2,
    caps: { BACKGROUND: true, ASK: true, TODO: true, MCP: true, TRANSCRIPTS: true, TRIGGER: false, CHANNEL: false },
    models: { deep: "opus", fast: "sonnet", balanced: "sonnet" },
    skillFm: (s) => ({
      name: s.name,
      description: s.description,
      // Glob-scoped auto-activation is native here; the port used to drop it and
      // restate the scope in prose, which only works if the model infers it.
      paths: globList(s.paths),
      // Upstream marks every skill manual-invoke only, principles included: they
      // are reference material reached by name from the Principles index, not
      // something to auto-fire. A path-scoped skill is the exception, since its
      // whole purpose is to attach automatically on matching files.
      "disable-model-invocation": s.paths ? undefined : true,
      "allowed-tools": s.files.some((f) => f.startsWith("scripts/"))
        ? "Bash(${CLAUDE_SKILL_DIR}/scripts/*)"
        : undefined,
    }),
    agentFm: (a) => ({
      name: a.name, description: a.description,
      // An explicit list is a whitelist: it grants the MCP servers by pattern and leaves out
      // every file-editing tool, which is the platform's whole enforcement. A `disallowedTools`
      // beside it would be dead.
      tools: a.access === "read" ? "Read, Grep, Glob, Bash, WebFetch, WebSearch, mcp__*" : undefined,
      model: ({ deep: "opus", fast: "sonnet", balanced: "sonnet" })[a.class] ?? "sonnet",
    }),
  },
  "codex": {
    usage: {
      invoke: "Type `$name`, or run `/skills` to browse. Codex also selects a skill on its own when the request matches its description, unless the skill ships `agents/openai.yaml` with `allow_implicit_invocation: false`.",
      manual: "`$poteto-mode`",
      delegate: "Codex delegates in-process with native subagents. Ask for the work to be delegated, or use `/agent` in the interactive CLI. `agents.max_concurrent_threads_per_session` sets how many run at once.",
      readonly: "The read-only contract is enforced by `[agents.pstack-reviewer] sandbox_mode = \"read-only\"` in `config.toml`. Copy `.codex/config.toml.example` into `~/.codex/config.toml` or the guard is prompt-only.",
      models: "A spawn may name its own model and reasoning effort, overriding `agents.default_subagent_model` and `agents.default_subagent_reasoning_effort`. Every model is OpenAI's, so panels are Tier 2 and use stances for the rest.",
      enable: ["Copy `.codex/config.toml.example` into `~/.codex/config.toml`, or merge its keys. It sets the subagent defaults and the read-only sandbox pstack relies on."],
      gotchas: [
        "Codex has no named-subagent-definition primitive. The delegate personas ship under `pstack-runtime/personas/`; to delegate as one, read its file and put the contents at the top of the spawn prompt.",
        "In a headless `codex exec` run, native subagents are not confirmed by the docs, so pstack falls back to one backgrounded process per delegate.",
      ],
    },
    dir: "codex", label: "Codex CLI",
    skillDir: ".agents/skills", skillFile: (n) => `${n}/SKILL.md`,
    runtimeDir: ".agents/skills/pstack-runtime",
    agentDir: ".agents/skills/pstack-runtime/personas", agentFile: (n) => `${n}.md`,
    memory: "AGENTS.md", tier: 2,
    caps: { BACKGROUND: true, ASK: false, TODO: true, MCP: true, TRANSCRIPTS: true, TRIGGER: false, CHANNEL: false },
    models: { deep: "your strongest model at high/xhigh effort", fast: "a fast model at low effort", balanced: "the configured default" },
    skillFm: (s) => ({ name: s.name, description: s.description }),
    agentFm: (a) => ({ name: a.name, description: a.description }),
  },
  "copilot": {
    usage: {
      invoke: "Type `/name` for a skill marked manual-invoke. Skills meant to apply automatically are hidden from the `/` menu and load themselves when the request matches.",
      manual: "`/poteto-mode`",
      delegate: "Select the `pstack` agent, which carries the `agent` tool and an allow-list of the three delegates. Then ask in words: \"Run the `pstack-reviewer` agent as a subagent to ...\". For a wave, list the tasks in one message under \"Perform these in parallel\".",
      readonly: "`pstack-reviewer` ships a `tools` whitelist with no `edit` entry, so the editing tools are unavailable. It keeps `execute/runInTerminal` so it can run probes, and a terminal can write, so the repository boundary is the persona's instruction. A reviewer writes probes only under its own output path.",
      models: "A custom agent may pin its own `model:`, and the picker spans vendors, so a panel here can be genuinely cross-vendor. A subagent may not request a model above the parent's cost tier, so start from a strong parent.",
      enable: [
        "Enable the `agent/runSubagent` tool in the session, or delegation cannot happen.",
        "For a delegate to spawn its own delegate, set `chat.subagents.allowInvocationsFromSubagents` to true. It is off by default.",
      ],
      gotchas: [
        "Prompt files (`.prompt.md`) are deprecated and are not loaded by Agent Host. This build ships Agent Skills instead.",
        "A supporting file loads only when referenced with a Markdown link. A bare backticked path is inert.",
        "On the GitHub.com coding agent, per-agent `model:` is not honored, so panels there run at Tier 2.",
      ],
    },
    dir: "copilot", label: "GitHub Copilot",
    // Prompt files are deprecated and are not loaded by Agent Host at all. Agent
    // Skills are the documented replacement and use the same SKILL.md shape as
    // the other hosts, so this host no longer needs the flattening special case.
    skillDir: ".github/skills", skillFile: (n) => `${n}/SKILL.md`,
    instrDir: ".github/instructions", instrFile: (n) => `${n}.instructions.md`,
    runtimeDir: ".github/skills/pstack-runtime",
    agentDir: ".github/agents", agentFile: (n) => `${n}.agent.md`,
    memory: ".github/copilot-instructions.md", tier: 3,
    instrExt: ".instructions.md",
    mdLinks: true,
    // A capability given as text is present on some surfaces only, and its host note says which.
    caps: { BACKGROUND: true, ASK: true, TODO: true, MCP: true, TRIGGER: true, CHANNEL: false,
      TRANSCRIPTS: "VS Code keeps chat sessions under its workspaceStorage (read against real files), the Copilot CLI keeps sessions under ~/.copilot/session-state (layout documented, events not yet checked against real rows), and the GitHub.com coding agent keeps none you can read" },
    models: { deep: "a strong model from the picker", fast: "a fast model from the picker", balanced: "the session model" },
    skillFm: (s) => {
      // Upstream marks every skill manual-invoke only. That is right for a skill
      // reached by name from a menu, but wrong for one written to apply on its
      // own: `disable-model-invocation` stops the model from loading the file at
      // all, which is fatal for a principle, `unslop`, or the runtime layer, and
      // and for the runtime layer.
      //
      // The router is NOT an exception. Upstream gates it deliberately and its own
      // description ends "Not for casual questions": a 23-playbook router firing on
      // a casual turn is exactly what the flag exists to prevent.
      const autoApply = s.kind === "principle" || s.dir === "unslop" || s.dir === "pstack-runtime";
      return {
        name: s.name,
        description: s.description,
        "disable-model-invocation": autoApply ? undefined : true,
        "user-invocable": autoApply ? false : undefined,
      };
    },
    instrFm: (s) => ({ applyTo: s.paths ? s.paths.replace(/^\[|\]$/g, "").replace(/"/g, "").replace(/,\s*/g, ",") : "**", description: s.description }),
    agentFm: (a) => ({
      name: a.name, description: a.description,
      // VS Code docs and GitHub docs disagree on the filename-derived default
      // name, and subagent selection is by exact, case-sensitive name. Say it
      // explicitly rather than trust either default.
      // `read` is its own tool set: `read/readFile` lives under it, and `search`
      // only searches, it does not read file contents. An unknown or absent id
      // is silently ignored, which would have stripped exactly the capability
      // these delegates most need.
      tools: a.access === "read"
        ? ["read", "search", "web/fetch", "execute/runInTerminal", "execute/getTerminalOutput"]
        : ["read", "edit", "search", "web/fetch", "execute"],
      // Delegates are invoked by the router, not chosen from the agent dropdown.
      "user-invocable": false,
    }),
  },

  "cursor": {
    usage: {
      invoke: "Type `/name`. Cursor also picks a skill automatically when its description matches, unless it is marked manual-invoke only.",
      manual: "`/poteto-mode`",
      delegate: "Native subagents. The delegate spec maps one to one onto `subagent_type`, `model`, `readonly` and `run_in_background`.",
      readonly: "`pstack-reviewer` declares `readonly: true` in its own agent file, which is where Cursor reads it from. There is no call-time override.",
      models: "Model slugs are addressable per delegate, and the panel can span vendors. This is the only host where pstack runs exactly as upstream designed it.",
      enable: [],
      gotchas: [
        "Cursor has a confirmed open bug: `disable-model-invocation: true` on a plugin-delivered skill hides it from the `/` palette. If `/how` or `/architect` do not appear after installing as a plugin, install repo-locally instead by copying `skills/` to `.cursor/skills/`.",
      ],
    },
    dir: "cursor", label: "Cursor",
    skillDir: "skills", skillFile: (n) => `${n}/SKILL.md`,
    runtimeDir: "skills/pstack-runtime",
    agentDir: "agents", agentFile: (n) => `${n}.md`,
    memory: ".cursor/rules/pstack.mdc", tier: 3,
    caps: { BACKGROUND: true, ASK: true, TODO: true, MCP: true, TRANSCRIPTS: true, TRIGGER: true, CHANNEL: true },
    models: { deep: "your strongest judgment model", fast: "your fast code model", balanced: "your default model" },
    skillFm: (s) => ({
      name: s.name,
      description: s.description,
      // A path-scoped skill auto-attaches; forcing manual invocation on top of that
      // would make it unreachable, which is what happened to typescript-best-practices.
      "disable-model-invocation": s.paths ? undefined : true,
      paths: globList(s.paths),
      icon: s.kind === "router" ? "crown" : undefined,
      color: s.kind === "router" ? "yellow" : undefined,
    }),
    agentFm: (a) => ({
      name: a.name,
      description: a.description,
      // `readonly` is a static property of the agent file with no call-time override,
      // so a read-only delegate has to declare it here or it is not enforced at all.
      readonly: a.access === "read" ? true : undefined,
      model: "inherit",
    }),
  },
  "generic": {
    usage: {
      invoke: "However your host invokes a skill. If it has no skill mechanism, point it at `pstack/skills/poteto-mode/SKILL.md` and ask it to follow that file.",
      manual: "the poteto-mode skill",
      delegate: "Assume none until you have spawned a delegate successfully in this session. Then raise the tier and say so.",
      readonly: "Nothing is enforced by the platform here. The read-only contract is prompt-only, so treat a delegate's output as a claim and check the tree yourself.",
      models: "Assume the parent's model for everything until you have addressed another one successfully.",
      enable: [],
      gotchas: ["Run `/setup-pstack` first. Every capability starts as absent and is raised only once proven."],
    },
    dir: "generic", label: "This host",
    skillDir: "pstack/skills", skillFile: (n) => `${n}/SKILL.md`,
    runtimeDir: "pstack/runtime",
    agentDir: "pstack/agents", agentFile: (n) => `${n}.md`,
    memory: "pstack/AGENTS.md", tier: 0,
    caps: { BACKGROUND: false, ASK: false, TODO: false, MCP: false, TRANSCRIPTS: false, TRIGGER: false, CHANNEL: false },
    models: { deep: "your strongest model", fast: "your fastest model", balanced: "your default model" },
    skillFm: (s) => ({ name: s.name, description: s.description }),
    agentFm: (a) => ({ name: a.name, description: a.description, access: a.access, class: a.class }),
  },
};

// Where a project's own skills load on each host, for the skills that write one (control-<surface>, a
// personal mode). Cursor installs pstack as a plugin at `skills/`, but a project skill lives in
// `.cursor/skills/`. Core names these as {{SKILL_DIR}} and {{USER_SKILL_DIR}}.
const SKILL_HOME = {
  "claude-code": [".claude/skills", "~/.claude/skills"],
  "codex": [".agents/skills", "~/.agents/skills"],
  "copilot": [".github/skills", "~/.copilot/skills"],
  "cursor": [".cursor/skills", "~/.cursor/skills"],
  "generic": ["pstack/skills", "~/.agents/skills"],
};
for (const [k, [project, user]] of Object.entries(SKILL_HOME))
  Object.assign(HOSTS[k], { projectSkills: project, userSkills: user });
const fillSkillHome = (body, host) =>
  body.replaceAll("{{SKILL_DIR}}", host.projectSkills).replaceAll("{{USER_SKILL_DIR}}", host.userSkills);

/* -------------------------------------------------- content path rewriting */
// delegation.md documents every host's binding. Only one of them is true here,
// and the rest is a few hundred words an agent reads before every delegation.
function keepOwnBinding(body, key) {
  const HEADINGS = {
    "claude-code": "### Claude Code", "codex": "### Codex CLI",
    "copilot": "### GitHub Copilot", "cursor": "### Cursor",
    "generic": "### generic (unknown host)",
  };
  const mine = HEADINGS[key];
  if (!mine || !body.includes("## Host bindings") || !body.includes(mine)) return body;
  const start = body.indexOf("## Host bindings");
  const end = body.indexOf("## Reaching a routed skill");
  if (end === -1) return body;
  const section = body.slice(start, end);
  const blocks = section.split(/\n(?=### )/);
  const head = blocks[0].replace(/The same spec, rendered per host\./,
    `The binding for this host. Other hosts' bindings are not shipped here; see the port's \`core/runtime/delegation.md\` if you need them.`);
  const own = blocks.find((b) => b.startsWith(mine));
  return body.slice(0, start) + head + "\n" + own.trimEnd() + "\n\n" + body.slice(end);
}

// The mode block is written once, in sticky-mode.md, and lands verbatim in the instructions file
// at the project root: from the build here, and from the Enter step in a session.
const MODE_BLOCK = /<!-- pstack:mode:start -->[\s\S]*?<!-- pstack:mode:end -->/;
const modeBlock = (host) =>
  read(join(CORE, "runtime", "sticky-mode.md")).match(MODE_BLOCK)[0].replaceAll("{{RUNTIME_DIR}}", host.runtimeDir);

function rewrite(body, host, ctxDir, key) {
  body = body.replaceAll("{{MEMORY_FILE}}", host.memory ?? "a `.cursor/rules` entry");
  body = body.replaceAll("{{RUNTIME_DIR}}", host.runtimeDir);
  body = fillSkillHome(body, host);
  if (ctxDir === host.runtimeDir && body.startsWith("# pstack runtime: the delegation protocol"))
    body = keepOwnBinding(body, key);
  // "If a file isn't referenced in the instructions, it won't be loaded." A bare
  // backticked path is not a reference; only a Markdown link is.

  const rel = (target) => {
    const r = relative(ctxDir, target).replace(/\\/g, "/");
    return r.startsWith(".") ? r : "./" + r;
  };
  // runtime/<f>.md  ->  host runtime location
  body = body.replace(/(?:`|\()runtime\/([a-z-]+\.md)(?:`|\))/g,
    (m, f) => (m[0] === "`" ? "`" : "(") + rel(join(host.runtimeDir, f)) + (m[0] === "`" ? "`" : ")"));
  body = body.replace(/`runtime\/([a-z-]+\.md)`/g, (_m, f) => "`" + rel(join(host.runtimeDir, f)) + "`");
  // Must run last: it wraps bare paths in Markdown links, and the rewrites above
  // match bare paths.
  if (host.mdLinks) {
    // These skills cite siblings from the skill root (`playbooks/x.md`) even when
    // the citing file sits in a subdirectory. A Markdown link resolves against the
    // file, so climb back to the skill root first.
    const sub = ctxDir.startsWith(host.skillDir)
      ? ctxDir.slice(host.skillDir.length).split("/").filter(Boolean).length - 1
      : 0;
    const up = sub > 0 ? "../".repeat(sub) : "./";
    const ROOT_DIRS = /^(playbooks|references|scripts|assets)\//;
    // A flattened instructions file sits one level above its own support dir.
    const flat = _flatCtx ? `./${_flatCtx}/` : null;
    body = outsideFences(body, (part) => part.replace(
      /(?<!\]\()`((?:\.{1,2}\/)?[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+\.(?:md|sh|ts|mjs|tsv|json))`/g,
      (_m, ref) => {
        // Repo tooling and runtime state are named for a reader, not linked.
        if (/^https?:|^~|^\//.test(ref) || /^\.?pstack\//.test(ref) || /^(build|core)\//.test(ref))
          return `\`${ref}\``;
        // The host's always-on memory file is cited by its path from the dist
        // root (e.g. `.github/copilot-instructions.md`). That path happens to
        // start with a dot, same as an already-relative `./` or `../` ref, so it
        // was falling into the "leave as-is" branch below and resolving inside
        // whatever directory cited it. Resolve it against the dist root instead.
        if (host.memory && ref === host.memory) return `[\`${ref}\`](${rel(ref)})`;
        // A ref naming a skill-root subdirectory is relative to the skill root;
        // anything else is relative to the citing file.
        const target = ref.startsWith(".") ? ref
          : (flat && ROOT_DIRS.test(ref)) ? flat + ref
          : (ROOT_DIRS.test(ref) ? up : "./") + ref;
        return `[\`${ref}\`](${target})`;
      }));
  }  return body;
}

// Fenced text is literal. A template in a fence (the plan skeleton, the mode block) is copied out of
// the file, where a link relative to it would break, so links are rewritten only outside fences.
function outsideFences(body, fn) {
  const out = [];
  let buf = [], fence = null;
  const flush = (literal) => { if (buf.length) out.push(literal ? buf.join("\n") : fn(buf.join("\n"))); buf = []; };
  for (const line of body.split("\n")) {
    const mark = line.match(/^\s*(`{3,}|~{3,})/)?.[1];
    if (fence === null && mark) { flush(false); fence = mark; buf.push(line); continue; }
    buf.push(line);
    if (fence !== null && mark && mark[0] === fence[0] && mark.length >= fence.length && line.trim() === mark) {
      flush(true); fence = null;
    }
  }
  flush(fence !== null);
  return out.join("\n");
}

let _ctxSkill = "";
let _flatCtx = null;
const ctxSkill = () => _ctxSkill;

/* --------------------------------------------------------------- emitters */
function buildHost(key) {
  const host = HOSTS[key];
  const out = join(DIST, host.dir);
  rmSync(out, { recursive: true, force: true });
  const stats = { skills: 0, agents: 0, playbooks: 0, guide: 0, automations: 0, skipped: [] };

  // ---- runtime layer
  for (const f of readdirSync(join(CORE, "runtime"))) {
    const dest = join(out, host.runtimeDir, f);
    write(dest, rewrite(read(join(CORE, "runtime", f)), host, dirname(join(host.runtimeDir, f)), key));
  }
  write(join(out, host.runtimeDir, "SKILL.md"), emitFm({
    name: "pstack-runtime",
    description: `How pstack executes on ${host.label === "This host" ? "an unknown host" : host.label}: host capabilities, the delegation protocol, role-to-model resolution, the sticky-mode shim, and task-list and question handling. Read by every pstack skill before it fans out.`,
    // This layer is read automatically at the start of a pstack session, never
    // chosen by name from a menu. On Copilot, `disable-model-invocation` would
    // stop it loading at all; `user-invocable: false` says the same thing
    // without hiding the file.
    "user-invocable": key === "copilot" ? false : undefined,
  }) + runtimeIndex(host));
  write(join(out, host.runtimeDir, "host-binding.md"), hostBinding(host, key));

  // ---- skills
  for (const s of manifest.skills) {
    if (!(s.hosts.includes("*") || s.hosts.includes(key))) { stats.skipped.push(s.dir); continue; }
    const srcDir = join(CORE, "skills", s.dir);
    const isInstr = key === "copilot" && s.paths;
    const relPath = isInstr ? join(host.instrDir, host.instrFile(s.dir)) : join(host.skillDir, host.skillFile(s.dir));
    const ctx = dirname(relPath);
    let { body } = splitFm(read(join(srcDir, "SKILL.md")));
    _ctxSkill = s.dir;
    _flatCtx = isInstr ? s.dir : null;
    body = rewrite(body, host, ctx);
    if (s.requires.length) body = capabilityNote(s, host, ctx) + body;
    const fm = isInstr ? host.instrFm(s) : host.skillFm(s);
    write(join(out, relPath), emitFm(fm) + body);
    stats.skills++;

    // Codex expresses "explicit invocation only" in a sidecar, not in frontmatter.
    // Without it, the implicit matcher can auto-trigger a skill whose description
    // says not to. This is the equivalent of `disable-model-invocation` elsewhere.
    if (key === "codex" && !s.paths) {
      write(join(out, dirname(relPath), "agents", "openai.yaml"),
        `policy:\n  allow_implicit_invocation: false\n`);
    }

    // supporting files (references/, scripts/, assets/)
    for (const f of s.files.filter(shipped)) {
      const src = join(srcDir, f);
      // A path-scoped skill compiles to a single instructions file, so its support
      // files need a directory named for the skill. Everything else keeps its own
      // skill directory and the support files sit directly inside it.
      const dst = isInstr
        ? join(out, dirname(relPath), s.dir, f)
        : join(out, dirname(relPath), f);
      if (f.endsWith(".md")) { _ctxSkill = s.dir; _flatCtx = null; write(dst, rewrite(read(src), host, dirname(relative(out, dst)))); }
      else { mkdirSync(dirname(dst), { recursive: true }); cpSync(src, dst); }
    }
  }

  // ---- playbooks, restored under the router skill so relative links resolve
  const routerDir = join(host.skillDir, "poteto-mode");
  for (const pb of manifest.playbooks) {
    const dst = join(out, routerDir, "playbooks", pb.file);
    const ctxPb = join(routerDir, "playbooks");
    let body = rewrite(read(join(CORE, "playbooks", pb.file)), host, ctxPb);
    // A playbook that instructs fan-out needs the same host note a skill gets.
    // Without it, bug-fix.md tells a Tier 0 host to spawn parallel subagents.
    if (pb.requires && pb.requires.length) {
      body = capabilityNote({ requires: pb.requires, dir: pb.name }, host, ctxPb) + body;
    }
    write(dst, body);
    stats.playbooks++;
  }

  // ---- agents
  for (const a of manifest.agents) {
    let { body } = splitFm(read(join(CORE, "agents", a.file)));
    // Codex has no per-agent tool scoping in the persona file itself; the guard
    // lives in config.toml. Say so where the delegate is defined.
    if (key === "codex" && a.access === "read") {
      body = "> **Enforcement.** This delegate's read-only contract is enforced by\n" +
             "> `[agents.pstack-reviewer] sandbox_mode = \"read-only\"` in `config.toml`\n" +
             "> (see `.codex/config.toml.example`). Without that block it is prompt-only.\n\n" + body;
    }
    const relPath = join(host.agentDir, host.agentFile(a.name));
    write(join(out, relPath), emitFm(host.agentFm(a)) + rewrite(body, host, dirname(relPath)));
    stats.agents++;
  }

  // ---- router agent. Copilot only: it is the one host where a delegate is a
  // full custom agent rather than a call-site option, so without a router agent
  // to invoke, `pstack-worker` / `pstack-reviewer` / `comment-sicko` are reachable
  // only by hand-picking one from the agent list, which skips the routing and
  // evidence-gating that makes them safe to run unattended.
  if (key === "copilot") {
    const relPath = join(host.agentDir, host.agentFile("pstack"));
    write(join(out, relPath), routerAgent(host));
    stats.agents++;
  }

  // ---- user guide. Documentation, not agent-loaded content, so it sits at the dist
  // root. Its cross-links point into the skill tree and must follow this host's layout.
  _ctxSkill = null; _flatCtx = null;
  const guideRoot = "docs/pstack-guide";
  for (const src of walk(join(CORE, "docs", "guide"))) {
    const sub = relative(join(CORE, "docs", "guide"), src).replace(/\\/g, "/");
    const dst = join(out, guideRoot, sub);
    if (!src.endsWith(".md")) { mkdirSync(dirname(dst), { recursive: true }); cpSync(src, dst); stats.guide++; continue; }
    const upToRoot = "../".repeat(guideRoot.split("/").length + sub.split("/").length - 1);
    let body = fillSkillHome(read(src), host)
      .replace(/\.\.\/\.\.\/skills\/poteto-mode\/playbooks\/([a-z0-9-]+)\.md/g,
        (_m, n) => `${upToRoot}${host.skillDir}/poteto-mode/playbooks/${n}.md`)
      .replace(/\.\.\/\.\.\/skills\/([a-z0-9-]+)\/SKILL\.md/g, (_m, n) => {
        const ps = manifest.skills.find((x) => x.dir === n);
        if (ps && ps.paths && host.instrDir) return `${upToRoot}${host.instrDir}/${n}${host.instrExt}`;
        return `${upToRoot}${host.skillDir}/${n}/SKILL.md`;
      })
      .replace(/\.\.\/\.\.\/skills\/([a-z0-9-]+)\//g,
        (_m, n) => `${upToRoot}${host.skillDir}/${n}/`)
      .replace(/\.\.\/\.\.\/agents\/([a-z0-9-]+)\.md/g,
        (_m, n) => `${upToRoot}${host.agentDir}/${n}${key === "copilot" ? ".agent.md" : ".md"}`);
    write(dst, body); stats.guide++;
  }

  // ---- automation pack. Dormant sources driven by a trigger, not slash skills,
  // so they keep their own tree rather than joining the skill directory.
  _ctxSkill = null; _flatCtx = null;
  for (const src of walk(join(CORE, "automations"))) {
    const sub = relative(join(CORE, "automations"), src).replace(/\\/g, "/");
    const dst = join(out, "automations", sub);
    if (!src.endsWith(".md") && !src.endsWith(".yaml")) { mkdirSync(dirname(dst), { recursive: true }); cpSync(src, dst); stats.automations++; continue; }
    const ctx = dirname(join("automations", sub));
    let body = rewrite(read(src), host, ctx);
    if (src.endsWith("README.md") && sub.split("/").length === 2)
      body = automationNote(host, ctx) + body;
    write(dst, body); stats.automations++;
  }

  // ---- Codex config example. The tier the port reports depends on these keys,
  // so ship a copyable starting point instead of describing them in prose.
  if (key === "codex") {
    write(join(out, ".codex", "config.toml.example"),
`# Copy to ~/.codex/config.toml, or merge these keys into your existing one.
# pstack reads the resulting capabilities via /setup-pstack.

# Native subagents power pstack's fan-out. Both default to true; set them
# explicitly so the behaviour is visible and intentional.
[agents]
enabled = true
# How many delegates may run at once. This is pstack's parallel width.
max_concurrent_threads_per_session = 4
# Defaults for a spawn that does not name its own. A spawn may override both.
default_subagent_model = "gpt-5.6"
default_subagent_reasoning_effort = "medium"

# pstack's review, exploration and investigation delegates must not mutate the
# tree. On this host that is enforced with a per-role sandbox, not by prompt text.
[agents.pstack-reviewer]
sandbox_mode = "read-only"

# pstack maps its model classes onto these: deep -> high/xhigh, fast -> low.
model_reasoning_effort = "medium"
`);
  }

  // ---- always-on memory file
  if (host.memory) write(join(out, host.memory), memoryFile(host, key));

  // ---- upstream branding, carried through so the Cursor manifest can cite it
  if (existsSync(join(CORE, "assets"))) {
    for (const src of walk(join(CORE, "assets"))) {
      const dst = join(out, "assets", relative(join(CORE, "assets"), src));
      mkdirSync(dirname(dst), { recursive: true }); cpSync(src, dst);
    }
  }

  // ---- Claude Code plugin manifest. The skills, agents and automation pack together
  // is the case the docs assign to a plugin rather than a loose .claude/ copy:
  // versioned installs, an update path, and portable bundled scripts.
  if (key === "claude-code") {
    write(join(out, ".claude-plugin/plugin.json"), JSON.stringify({
      name: "pstack-portable",
      description: `Community port of pstack ${manifest.upstream.version} by ${manifest.upstream.author}, `
        + "adapted to run on Claude Code. Not an official release. "
        + "Rigorous agent workflows you can parallelize with confidence.",
      version: `${manifest.upstream.version}+port.${manifest.version}`,
      author: { name: `port by the pstack-portable contributors, from pstack by ${manifest.upstream.author}` },
      homepage: manifest.upstream.repo,
      license: manifest.upstream.license,
    }, null, 2) + "\n");
    write(join(out, ".claude-plugin/marketplace.json"), JSON.stringify({
      name: "pstack-portable",
      owner: { name: manifest.upstream.author, url: manifest.upstream.repo },
      plugins: [{
        name: "pstack-portable",
        source: "./",
        description: `Community port of pstack ${manifest.upstream.version} by ${manifest.upstream.author}. Not an official release.`,
        version: `${manifest.upstream.version}+port.${manifest.version}`,
        category: "developer-tools",
        keywords: ["workflow", "principles", "review", "planning", "verification"],
      }],
    }, null, 2) + "\n");
  }

  // ---- Cursor round-trip: rebuild the native plugin manifest, proving the
  // neutral core still compiles back to the host it came from.
  if (key === "cursor") {
    write(join(out, ".cursor-plugin/plugin.json"), JSON.stringify({
      name: "pstack-portable", version: `${manifest.upstream.version}+port.${manifest.version}`,
      description: `Community port of pstack ${manifest.upstream.version} by ${manifest.upstream.author}, `
        + "recompiled for Cursor from a vendor-neutral core. Not an official release.",
      author: { name: `port by the pstack-portable contributors, from pstack by ${manifest.upstream.author}` },
      homepage: manifest.upstream.repo,
      license: manifest.upstream.license, logo: "assets/logo.png",
      keywords: ["pstack", "poteto-mode", "workflow", "principles", "portable"],
      skills: "./skills/", agents: "./agents/", rules: "./rules/",
    }, null, 2) + "\n");
  }
  write(join(out, "INSTALL.md"), installDoc(host, key, stats));
  write(join(out, "USAGE.md"), usageDoc(host, key, stats));
  write(join(out, "REFERENCE.md"), referenceDoc(host, key));

  // ---- invocation prefix. Core prose and the guide say `/name`; a host that takes another prefix
  // gets every invocation of a pstack skill rewritten to its own.
  if (INVOKE[key] || HOST_TEXT[host.dir]) {
    // routes.json carries each playbook's step text, which `rr tasks --json` hands out verbatim.
    for (const f of walk(out).filter((x) => /\.(md|mdc|toml|example|yaml)$|\/routes\.json$/.test(x))) {
      const t = read(f);
      let u = t;
      for (const [from, to] of HOST_TEXT[host.dir] ?? []) u = u.replace(from, to);
      // Image alt text describes the picture, which shows what it shows.
      if (INVOKE[key]) u = u.split(/(!\[[^\]]*\])/)
        .map((part, i) => i % 2 ? part : part.replace(SKILL_CALL, (_m, n) => INVOKE[key] + n)).join("");
      if (u !== t) writeFileSync(f, u);
    }
  }
  return stats;
}

/* ------------------------------------------------------------- generators */
function automationNote(host, ctxDir) {
  const rel = (f) => { const r = relative(ctxDir, join(host.runtimeDir, f)).replace(/\\/g, "/"); return r.startsWith(".") ? r : "./" + r; };
  return `> **Host note.** This pack assumes a runner that starts an agent from an event or a schedule.\n` +
    `> On ${host.label}, see \`${rel("automations.md")}\` for how to trigger one${host.tier === 3 ? "" : ", and what it degrades to when no runner is available"}.\n` +
    `> **These skills are for unattended runs, not for an interactive session.** They assume a\n` +
    `> control adapter, captures, and a source thread to reply into, and they fail closed without\n` +
    `> them. In a session, route to a pstack playbook instead: work that already landed goes to\n` +
    `> Session pickup, a live defect to Bug fix.\n\n`;
}

const runtimeIndex = (host) => `
# pstack runtime

Reference for the \`poteto-mode\` router. Do not read these up front. The router's bootstrap reads
\`host-binding.md\` and nothing else, then opens each file below at the moment its table names.

- \`host-binding.md\` — the resolved answers for ${host.label}. The one file the bootstrap reads.
- \`delegation.md\` — the portable delegate spec, and how it binds to ${host.label}.
- \`roles.md\` — role to model-class resolution.
- \`capabilities.md\` — what this host can do, and the degradation ladder when it cannot.
- \`interaction.md\` — task lists and questions.
- \`automations.md\` — the fail-closed rules for unattended runs.
- \`sticky-mode.md\` — entering, keeping and leaving pstack mode across turns.
- \`host-profile.md\` — the same table for every supported host.
`;

function routerAgent(host) {
  const r = relative(host.agentDir, join(host.skillDir, "poteto-mode", "SKILL.md")).replace(/\\/g, "/");
  const link = r.startsWith(".") ? r : "./" + r;
  return emitFm({
    name: "pstack",
    description: "pstack router. Matches a request to a playbook, delegates by role to pstack-worker, pstack-reviewer and comment-sicko, and requires evidence before reporting done.",
    tools: ["agent", "read", "edit", "search", "execute", "web", "todos", "vscode/askQuestions"],
    agents: ["pstack-worker", "pstack-reviewer", "comment-sicko"],
  }) + `
# pstack

Start at the [\`poteto-mode\`](${link}) skill. It matches your request to a playbook, copies the
playbook's steps into the task list verbatim, and says which role to delegate each step to.

Delegation needs the \`agent/runSubagent\` tool enabled in this session. Without it, run the
playbook's steps inline instead of spawning \`pstack-worker\`, \`pstack-reviewer\`, or \`comment-sicko\`.
`;
}

function hostBinding(host, key) {
  const m = host.models;
  // Copilot's tier is not one number: it depends on the surface the session is
  // running on, and a nested delegate can never itself reach the parent's tier.
  const tierText = key === "copilot"
    ? "**Tier 3** in a VS Code Copilot session with `agent/runSubagent` enabled and a top-cost-tier " +
      "parent model: full panel, N delegates, N distinct models, in parallel. **Tier 2** on the " +
      "GitHub.com cloud agent, where a per-agent `model:` is not honored: single-family panel, real " +
      "parallel delegates, diversity from stances instead of models. Delegates themselves always run " +
      "at **Tier 0**: subagents cannot nest by default, so a fan-out step inside one runs inline, " +
      "sequential stance passes each written to its own file before the next begins."
    : `**Tier ${host.tier}.** ${{
    3: "Full panel. N delegates, N distinct models, in parallel. Nothing degrades.",
    2: "Single-family panel. Real parallel delegates, but you choose a model tier rather than a vendor. Panels keep their count and get diversity from stances instead of models.",
    1: "Serial delegation. Delegates run one at a time. Keep the count, accept the wall-clock cost.",
    0: "Inline personas. No delegation primitive. Fan-out becomes sequential stance passes, each written to its own file before the next begins.",
  }[host.tier]}`;
  return `# pstack on ${host.label === "This host" ? "an unknown host" : host.label}

Resolved at build time. \`${INVOKE[key] ?? "/"}setup-pstack\` probes the live session and writes \`.pstack/host.json\`,
which overrides the tier and capabilities below. It does not replace this file, which alone carries
the paths and the delegate binding.

This build is for host key \`${{ "claude-code": "claude" }[key] ?? key}\`. A \`.pstack/host.json\` whose
\`host\` names another key was written by that host's session. Ignore it here, and run \`pstack doctor\`.

## Delegation tier

${tierText}

See \`capabilities.md\` for the full ladder, and report the tier in any output that fanned out.

## Model classes

| class | on ${host.label} |
|---|---|
| \`deep\` | ${m.deep} |
| \`fast\` | ${m.fast} |
| \`balanced\` | ${m.balanced} |
| \`panel\` | ${host.tier >= 3 ? "a list of genuinely different models" : "one model plus the stance set in `delegation.md`"} |
| \`inherit\` | the parent's model. Always valid. |

## Where things live

- skills: \`${host.skillDir}/\`
- runtime: \`${host.runtimeDir}/\`
- delegate personas: \`${host.agentDir}/\`
${host.memory ? `- always-on instructions: \`${host.memory}\`` : "- always-on instructions: a `.cursor/rules` entry"}

## Delegate binding

${{
  "claude-code": "Use the `Agent` tool. `access: read` maps to `subagent_type: \"pstack-reviewer\"`, `access: write` to `\"pstack-worker\"`. `model` takes tier aliases only. Issue every delegate of a wave in one message so they run in parallel. `run_in_background: true` gives you `detached`, and `isolation: \"worktree\"` gives you `isolation: worktree`: use it for every write delegate in a fan-out inside a git repository. A read delegate cannot edit files but can still write through Bash, so give it an output path.",
  "codex": "Native subagents, enabled by default (`agents.enabled`). Delegate in-process (`/agent` in the interactive CLI); `agents.max_concurrent_threads_per_session` sets the parallel width, and a spawn may name its own model and reasoning effort. Single vendor, so treat MODEL_CHOICE as partial. In a headless `codex exec` context, where native subagents are unconfirmed, fall back to one backgrounded `codex exec -C <dir>` per delegate.",
  "copilot": "Custom agents at `.github/agents/<name>.agent.md`, invoked as subagents. Their `tools:` list is a whitelist drawn from the canonical sets (`agent`, `browser`, `edit`, `execute`, `read`, `search`, `web`); a scoped id (`read/readFile`, `execute/runInTerminal`, `web/fetch`) or an MCP `<server>/*` id is also valid, and an unknown id is silently ignored. An agent may pin its own `model:`, and the picker spans vendors, so a panel here is genuinely cross-vendor. Confirm subagent support is available in the session before promising one; fall back to the stance ladder if it is not.",
  "cursor": "Native. `subagent_type`, `model`, `readonly`, `run_in_background` map one-to-one onto the delegate spec.",
  "generic": "Unknown host. Assume no delegation until you have spawned one successfully in this session, then raise the tier and say so.",
}[key]}
`;
}

const capabilityNote = (s, host, ctxDir) => {
  // Every capability a skill can declare must be answerable here. A capability with
  // no case would silently never warn, which is worse than not declaring it.
  const absent = {
    MODEL_CHOICE: host.tier < 3,
    PARALLEL: host.tier < 2,
    DELEGATE: host.tier < 1,
    BACKGROUND: host.caps?.BACKGROUND === false,
    ASK: host.caps?.ASK === false,
    TODO: host.caps?.TODO === false,
    MCP: host.caps?.MCP === false,
    TRANSCRIPTS: host.caps?.TRANSCRIPTS === false,
    TRIGGER: host.caps?.TRIGGER === false,
    CHANNEL: host.caps?.CHANNEL === false,
  };
  const unknown = s.requires.filter((c) => !(c in absent));
  if (unknown.length) throw new Error(`${s.dir}: undeclared capability ${unknown.join(",")}`);
  const missing = s.requires.filter((c) => absent[c]);
  const partly = s.requires.filter((c) => typeof host.caps?.[c] === "string");
  if (!missing.length && !partly.length) return "";
  const bindRel = (() => { const r = relative(ctxDir, join(host.runtimeDir, "host-binding.md")).replace(/\\/g, "/"); return r.startsWith(".") ? r : "./" + r; })();
  const REMEDY = {
    MODEL_CHOICE: "keep the delegate count and give each a distinct stance from the panel set instead of a distinct model",
    PARALLEL: "keep the delegate count and run them one at a time, each blind to the others",
    DELEGATE: "keep the step count and run each pass inline, writing every pass to its own file before starting the next",
    MCP: "gather the same evidence from the repository and from commands you can run, and name what you could not reach",
    TRANSCRIPTS: "say so plainly and rebuild the context from the repository and the shared record instead",
    TRIGGER: "build the artifact anyway, and have the operator start the run by hand instead of an event",
    CHANNEL: "read the input from a pasted payload and hand your reply back to the operator to post",
    BACKGROUND: "run it in the foreground and wait",
    ASK: "ask in prose, with numbered options",
    TODO: "keep the checklist in your reply and repost it as it changes",
  };
  const how = missing.map((c) => REMEDY[c]).filter(Boolean).join("; ");
  const qualified = partly.map((c) => `> **Host note.** ${c} on ${host.label} depends on the surface. ${host.caps[c]}. Where there is none, ${REMEDY[c]}.\n`).join("");
  if (!missing.length) return qualified + "\n";
  return qualified + `> **Host note.** This skill is written for ${s.requires.join(" + ")}. ${host.label} does not provide ${missing.join(", ")}.\n> Run it at Tier ${host.tier} per \`${bindRel}\`: ${how}. Say which tier you ran at in the output.\n\n`;
};

function memoryFile(host, key) {
  const p = INVOKE[key] ?? "/";
  const invoke = `${p}poteto-mode`;
  // Cursor reads always-on guidance from a .mdc rule with YAML frontmatter, not
  // from a bare markdown file. The port referenced this file and never wrote it.
  const head = key === "cursor"
    ? `---\ndescription: pstack engineering workflow, always applied\nalwaysApply: true\n---\n\n`
    : "";
  return head + `# pstack

This project uses pstack, a rigor-first engineering workflow ported to ${host.label}.

${modeBlock(host)}

## Entry points

- \`${invoke}\` — the router. Use it for any non-trivial task. It matches a playbook, copies its
  steps into the task list verbatim, delegates by role, and requires evidence before reporting done.
- \`${p}setup-pstack\` — detect this host's real capabilities and write \`.pstack/host.json\`. Run once.
- \`${p}how\`, \`${p}why\`, \`${p}architect\`, \`${p}arena\`, \`${p}swarm\`, \`${p}interrogate\` — situational. The router
  calls them for you when a step needs them.

## Non-negotiables

- Verify against the real artifact. A passing build is not evidence that the change works.
- Copy the matched playbook's steps into the task list verbatim, before any task-specific items.
  A skipped step stays in the list with a one-line reason.
- Name the principles that shaped a decision, and cite only ones you actually read.
- Report the delegation tier whenever a step fanned out. Do not present a degraded panel as
  agreement between independent models.
`;
}


// The per-host user guide. Generated rather than hand-written so the catalogue,
// the paths and the capability claims cannot drift from what actually shipped.

// The full reference: every skill, playbook, principle and delegate, with the
// guidance authored in core/reference merged onto what actually shipped.
function referenceDoc(host, key) {
  const inv = (n) => key === "codex" ? `\`$${n}\`` : `\`/${n}\``;
  const label = host.label === "This host" ? "an unknown host" : host.label;
  const skills = manifest.skills.filter((s) => s.hosts.includes("*") || s.hosts.includes(key));
  const wf = skills.filter((s) => s.kind !== "principle");
  const order = ["poteto-mode", "setup-pstack", "how", "why", "teach", "recall", "architect", "arena",
    "swarm", "interrogate", "blast-radius", "no-comments", "unslop", "technical-writing", "tdd",
    "figure-it-out", "create-verification-skill", "maintain-verification-skill", "show-me-your-work",
    "reflect", "automate-me", "make-bot-ui", "bro", "typescript-best-practices"];
  const sorted = order.map((d) => wf.find((s) => s.dir === d)).filter(Boolean)
    .concat(wf.filter((s) => !order.includes(s.dir)));

  const skillEntry = (s) => {
    const g = REF.skills[s.dir] || {};
    const gate = s.requires.length
      ? `\n\n**Needs** ${s.requires.join(", ")}. ${s.requires.some((c) => (c === "MODEL_CHOICE" && host.tier < 3) || (c === "PARALLEL" && host.tier < 2) || (c === "DELEGATE" && host.tier < 1)) ? `${label} does not provide all of that, so this skill carries a note in its own file saying how it adapts here.` : `${label} provides it.`}`
      : "";
    return `### ${inv(s.name)}

${g.one || firstSentence(s.description)}

**Reach for it when** ${g.when || "the description matches."}

**How to use it well.** ${g.use || "See the skill file."}

**Common mistake.** ${g.pitfall || "None recorded."}${gate}

<sub>\`${host.skillDir}/${s.dir}/${s.paths && host.instrDir ? "" : "SKILL.md"}\`</sub>
`;
  };

  const pbEntry = (pb) => {
    const g = REF.playbooks[pb.name] || {};
    return `### \`${pb.name}\`

${pb.summary}

**Routed to by** ${g.trigger || "the router, from your phrasing."}

**You get** ${g.gives || "the playbook's stated output."}

**Worth knowing.** ${g.note || ""}
`;
  };

  return `# pstack reference for ${label}

Every skill, playbook, principle and delegate. Written for this host: invocations, paths and
capability notes are the ones that actually shipped here.

If you only read one thing, read the top of \`USAGE.md\`. This file is the depth behind it.

**Contents.** [Skills](#skills) (${sorted.length}) · [Playbooks](#playbooks) (${manifest.playbooks.length}) · [Principles](#principles) (${skills.length - wf.length}) · [Delegates](#delegates) (${manifest.agents.length})

---

## Skills

You call these directly. The router calls most of them for you when a step needs one.

${sorted.map(skillEntry).join("\n")}
---

## Playbooks

You rarely name a playbook. ${inv("poteto-mode")} matches your request to one and copies its steps
into your task list verbatim, so you can see the plan before it runs. A step it decides to skip stays
in the list with a one-line reason.

${manifest.playbooks.map(pbEntry).join("\n")}
---

## Principles

Not commands. These are the reasoning the router cites when it makes a call, and each one is a file
you can open when you want to know why it decided something. Read one in full before leaning on it.

${Object.entries(REF.principles).map(([n, t]) => `**\`${n}\`** — ${t}`).join("\n\n")}

---

## Delegates

Sub-agents the skills spawn. You do not usually invoke one yourself.

${manifest.agents.map((a) => `### \`${a.name}\`

${firstSentence(a.description)}

**Access** ${a.access === "read" ? "read-only" : "may write"}. **Model class** \`${a.class}\`.
${a.access === "read" ? `\n**Enforced by** ${host.usage.readonly}\n` : ""}`).join("\n")}
---

## How they fit together

A normal task is one line to ${inv("poteto-mode")}. It reads the runtime layer, matches a playbook,
copies the steps in, and from there the playbook decides which skills run. ${inv("how")} grounds it,
${inv("architect")} shapes it, a delegate writes it, ${inv("interrogate")} attacks it, and the
verification step proves it against the real artifact rather than a passing build.

The principles are what it cites when it chooses between two reasonable options. The delegates are
who does the work when a step should not run in your main context window.

On ${label} this runs at **Tier ${host.tier}**. ${host.tier === 3 ? "Nothing degrades." : "Anything that fans out says so in its output, and names what it lost."}
`;
}

function usageDoc(host, key, stats) {
  const u = host.usage;
  const inv = (n) => key === "codex" ? `\`$${n}\`` : `\`/${n}\``;
  const byKind = (k) => manifest.skills.filter((s) => s.kind === k && (s.hosts.includes("*") || s.hosts.includes(key)));
  const row = (s) => {
    const where = s.paths && host.instrDir
      ? `${host.instrDir}/${s.dir}${host.instrExt}`
      : `${host.skillDir}/${s.dir}/SKILL.md`;
    const how = s.paths ? "auto, on matching files" : inv(s.name);
    const gate = s.requires.length ? s.requires.join(" + ") : "any host";
    return `| ${how} | ${firstSentence(s.description)} | ${gate} |`;
  };
  const firstSentenceFn = firstSentence;
  return `# Using pstack on ${host.label === "This host" ? "an unknown host" : host.label}

Everything below is specific to this host. The engineering method is the same everywhere; how you
reach it is not.

## 1. Install

Install the \`pstack\` command once (\`uv tool install pstack-cli\` or \`pipx install pstack-cli\`), then, in
your project:

\`\`\`bash
pstack init --host ${host.dir}
\`\`\`

It writes only what belongs to ${host.label === "This host" ? "this host" : host.label}, backs up any file of yours it would replace, and appends to
your existing instructions file rather than overwriting it. Re-running it is safe and keeps your mode
state. Without pip or uv, run \`./install.sh --host ${host.dir}\` from a checkout of pstack instead.

| command | what it does |
|---|---|
| \`pstack status\` | what is installed, which files you edited, whether the mode is on |
| \`pstack update\` | refresh to the build this CLI carries, keeping files you edited |
| \`pstack on\`, \`pstack off\` | turn the sticky mode on or off for this project |
| \`pstack doctor\` | diagnose a broken or partial install and say how to fix it |
| \`pstack uninstall\` | remove what pstack installed and put back what it replaced |
| \`pstack uninstall --purge\` | also remove \`.pstack/\`, keeping run records unless you add \`--delete-runs\` |
| \`pstack init --user\` | install the skills user-wide instead of into one project |
| \`pstack serve\` | a live local page of your agent sessions and pstack runs |
| \`pstack list\`, \`pstack show <name>\`, \`pstack hosts\` | the catalogue, one skill or playbook in full, the supported hosts |

Then open a new session and run ${inv("setup-pstack")}. It probes what this host can really do and
writes \`.pstack/host.json\`, which overrides the build-time defaults.
${u.enable.length ? `\n### Enable first\n\n${u.enable.map((e) => `- ${e}`).join("\n")}\n` : ""}
## 2. Your first task

Do not invoke a skill. Describe the work:

\`\`\`
${u.manual.replace(/`/g, "")} the webhook sends two welcome emails for one purchase. Reproduce both
deliveries first, then trace the cause, fix it, and verify one email is sent.
\`\`\`

The parent agent matches a playbook, exports its steps into your task list **verbatim**, and
delegates by role when the session supports it. The run record supplies checklist state and
completion requirements. Its checker rejects missing required artifacts, failed verdicts, and
stale verification. The agent must run it before claiming completion. A permitted skip stays in
the checklist with its reason; mandatory verification cannot be skipped. A final chat reply alone
does not establish that the run passed its completion check.

## 3. Invoking things here

**Skills.** ${u.invoke}

**Delegates.** ${u.delegate}

**Read-only enforcement.** ${u.readonly}

**Models.** ${u.models}

## 4. What is installed, and where

| what | where |
|---|---|
| skills | \`${host.skillDir}/\` |
| playbooks | \`${host.skillDir}/poteto-mode/playbooks/\` |
| delegate personas | \`${host.agentDir}/\` |
| runtime layer | \`${host.runtimeDir}/\` |
${host.instrDir ? `| path-scoped rules | \`${host.instrDir}/\` |\n` : ""}| always-on instructions | \`${host.memory ?? "a .cursor/rules entry"}\` |
| user guide | \`docs/pstack-guide/\` |
| automation pack | \`automations/benny/\` |
| your config | \`.pstack/\` |

## 5. Tier ${host.tier}, and what that costs you

${{
  3: "Full panel. A fan-out step runs N delegates on N distinct models, in parallel. Nothing degrades.",
  2: "Real parallel delegates, but every model comes from one vendor. A panel keeps its count and gets its diversity from **stances** instead of models: `adversary`, `operator`, `maintainer`, `minimalist`, `architect`, `builder`. Weaker than four vendors. Far stronger than one opinion.",
  1: "Delegates run one at a time. The count and the isolation survive; the wall-clock cost does not.",
  0: "No delegation. A fan-out becomes sequential stance passes, each written to its own file before the next begins, so the passes cannot contaminate each other.",
}[host.tier]}

Any skill that ran below Tier 3 says so in its output. That line is not boilerplate: convergence
between four models is real evidence, and convergence between two passes of one model in one context
window is not. Read it before you trust an agreement.

## 6. The delegates

| role | access | what it is for |
|---|---|---|
${manifest.agents.map((a) => `| \`${a.name}\` | ${a.access} | ${firstSentenceFn(a.description)} |`).join("\n")}

You own their work. Read the diff, write your own summary, and treat a "done" as a claim rather than
evidence.

## 7. Configuring which model does what

${inv("setup-pstack")} writes \`.pstack/models.md\`, one line per role. Delete a line to fall back to
the default; set a role to \`inherit\` to run it on the parent's model, which is the right answer on
an auto-routing plan.

Panel roles take a **list**, and the list length sets the fan-out. Write real entries: a single bare
token reads as a single delegate and silently collapses a four-way review to one opinion.

## 8. Sticky mode

${inv("poteto-mode")} stays on across turns once entered. The state lives in \`.pstack/mode.md\` and the
marked block in \`${host.memory ?? "your rules file"}\`. Say "pstack off" to leave. It stands down on its own for
casual questions without announcing it.

## 9. Automations

The \`benny\` pack triages incoming issue reports and reproduces confirmed bugs, unattended. It needs
a trigger: ${{
  cursor: "a native Cursor automation with a webhook trigger.",
  "claude-code": "a cron job or CI workflow invoking `claude -p` with the event payload.",
  codex: "a cron job or CI workflow invoking `codex exec` with the event payload.",
  copilot: "the coding agent, started by issue assignment, a PR mention, or the REST API.",
  generic: "whatever starts an unattended run here. Ask the operator rather than guessing.",
}[key]}

Without a trigger the skills still work; you start them by hand. Read
\`${host.runtimeDir}/automations.md\` before enabling anything unattended: it carries the fail-closed
rules that apply when no human is watching the turn.

## 10. Worth knowing on this host

${u.gotchas.map((g) => `- ${g}`).join("\n")}

## 11. The skills

Situational. The router calls them for you when a step needs one; this table is for reaching one
directly. A **needs** entry names the capability a skill was written for, and where this host lacks
it the skill carries a note saying how it adapts.

### Workflow

| invoke | for | needs |
|---|---|---|
${byKind("router").concat(byKind("setup"), byKind("workflow")).map(row).join("\n")}

### Principles

Reference material. The router cites them; open one directly when you want the reasoning.

${byKind("principle").map((s) => `\`${s.name.replace(/^principle-/, "")}\``).join(", ")}

## 12. The playbooks

The router picks one and copies its steps into your task list. You rarely name one yourself.

| playbook | for |
|---|---|
${manifest.playbooks.map((pb) => `| \`${pb.name}\` | ${firstSentenceFn(pb.summary)} |`).join("\n")}

## 13. If something looks wrong

- **A skill did not appear.** Check it is where section 4 says, and re-run ${inv("setup-pstack")}.
- **A panel returned one opinion.** Check \`.pstack/models.md\`: a panel role needs a list, not one token.
- **Output claims a tier you do not have.** \`.pstack/host.json\` wins over the build-time defaults. Re-run ${inv("setup-pstack")} to re-probe.
- **A delegate wrote something it should not have.** Section 3 says what enforces read-only here. If it is prompt-only, that is the reason.
- **You want it to stop.** Say "pstack off".
`;
}

function firstSentence(t) {
  const s = String(t || "").replace(/^"|"$/g, "").replace(/\\"/g, '"').trim();
  const m = s.match(/^(.*?[.!?])(\s|$)/);
  return (m ? m[1] : s).replace(/\|/g, "\\|");
}

function installDoc(host, key, stats) {
  const dest = { "claude-code": "your project root (or `~/` for user-wide)", codex: "your project root (or `~/` for user-wide)", copilot: "your repository root", cursor: "a Cursor plugin directory", generic: "anywhere your agent can read" }[key];
  return `# Installing pstack for ${host.label}

Copy the contents of this directory into ${dest}, preserving paths.

\`\`\`bash
cp -r dist/${host.dir}/. /path/to/your/project/
\`\`\`

**Read \`USAGE.md\` next.** It is the guide for this host: how to invoke skills and delegates here,
what enforces the read-only contract, how to configure models, and the full skill and playbook
catalogue.

Then, in a new session, run \`${key === "codex" ? "$setup-pstack" : "/setup-pstack"}\`. It probes what this
host can actually do and writes \`.pstack/host.json\`, which overrides the build-time defaults in
\`${host.runtimeDir}/host-binding.md\`.

## What landed

- ${stats.skills} skills in \`${host.skillDir}/\`
- ${stats.playbooks} playbooks under the \`poteto-mode\` skill
- ${stats.agents} delegate personas in \`${host.agentDir}/\`
- the runtime layer in \`${host.runtimeDir}/\`
- the user guide in \`docs/pstack-guide/\` (${stats.guide} files)
- the benny automation pack in \`automations/\` (${stats.automations} files)
${host.memory ? `- always-on instructions in \`${host.memory}\`` : ""}
${stats.skipped.length ? `\nNot included, host-specific to another platform: ${stats.skipped.join(", ")}.\n` : ""}
${key === "cursor" ? `## Known Cursor issue

Cursor has a confirmed, open bug where \`disable-model-invocation: true\` on a **plugin-delivered**
skill hides it from the \`/\` palette entirely. Repo-level skills with the same flag work correctly.
This build sets that flag on the skills meant for manual invocation, so if \`/how\` or \`/architect\`
do not appear in the palette after installing as a plugin, install the skills repo-locally instead:
copy \`skills/\` to \`.cursor/skills/\` in your project. Path-scoped skills and the principle skills
are unaffected, since they do not carry the flag.

` : ""}## Tier ${key === "copilot" ? "3 or 2, depending on the surface" : host.tier}

${key === "copilot"
    ? "**Tier 3** in a VS Code Copilot session with `agent/runSubagent` enabled and a top-cost-tier " +
      "parent model. **Tier 2** on the GitHub.com cloud agent, where a per-agent `model:` is not " +
      "honored. Either way, a delegate you spawn runs at **Tier 0** itself: subagents cannot nest by " +
      `default. See \`${host.runtimeDir}/capabilities.md\`. The skills still run; they say so in their output when they ran degraded.`
    : (host.tier === 3 ? "Everything runs as designed." : `Multi-model panels degrade to Tier ${host.tier}. See \`${host.runtimeDir}/capabilities.md\`. The skills still run; they say so in their output when they ran degraded.`)}
`;
}

/* -------------------------------------------------------------------- run */
const targets = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(HOSTS);
let total = 0;
for (const k of targets) {
  if (!HOSTS[k]) { console.error(`unknown host: ${k}`); process.exit(1); }
  const s = buildHost(k);
  // The repository's own REFERENCE.md and USAGE.md are the Claude Code build's, so they cannot drift.
  if (k === "claude-code")
    for (const doc of ["REFERENCE.md", "USAGE.md"]) writeFileSync(join(ROOT, doc), read(join(DIST, "claude", doc)));
  total += s.skills;
  console.log(`${k.padEnd(12)} skills=${String(s.skills).padStart(2)} playbooks=${s.playbooks} agents=${s.agents} guide=${s.guide} auto=${s.automations}` +
    (s.skipped.length ? `  skipped=${s.skipped.join(",")}` : ""));
}
console.log(`\ndist/ built: ${targets.length} hosts, ${total} skill files`);
