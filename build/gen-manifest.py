#!/usr/bin/env python3
"""Build core/manifest.json: every skill, its kind, and its capability requirements."""
import json, pathlib, re

from build_lock import ensure_build_lock

ensure_build_lock()

ROOT = pathlib.Path(__file__).resolve().parent.parent
CORE = ROOT / "core"
UPSTREAM = json.loads((ROOT / "build" / "port" / "upstream.json").read_text())

# capability requirements that cannot be inferred from text
REQUIRES = {
    "arena":       ["DELEGATE", "PARALLEL", "MODEL_CHOICE"],
    "architect":   ["DELEGATE", "PARALLEL", "MODEL_CHOICE"],
    "interrogate": ["DELEGATE", "PARALLEL", "MODEL_CHOICE"],
    "swarm":       ["DELEGATE", "PARALLEL"],
    "reflect":     ["DELEGATE", "PARALLEL", "MODEL_CHOICE"],
    "how":         ["DELEGATE"],
    "why":         ["DELEGATE", "MCP"],
    "no-comments": ["DELEGATE"],
    "make-bot-ui": ["TRIGGER"],
    "recall":      ["TRANSCRIPTS", "DELEGATE", "PARALLEL"],
    "automate-me": ["TRANSCRIPTS", "DELEGATE", "PARALLEL"],
    "maintain-verification-skill": ["DELEGATE", "PARALLEL"],
    "show-me-your-work": ["DELEGATE", "MODEL_CHOICE"],
    "teach":       ["DELEGATE", "PARALLEL"],
}
# skills that only make sense on one host
# make-bot-ui was Cursor-only until its webhook step was expressed through the
# TRIGGER capability. It now ships everywhere, and degrades where TRIGGER is absent.
HOST_ONLY = {}
# skills whose value survives without their capability, in degraded form
DEGRADES = set(REQUIRES) - {"recall", "automate-me"}

def fm(p):
    t = p.read_text(encoding="utf-8", errors="ignore")
    if not t.startswith("---\n"):
        return {}, t
    end = t.find("\n---\n", 4)
    if end == -1:
        return {}, t
    out = {}
    lines = t[4:end].split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        if ":" in line and not line[:1].isspace():
            k, v = line.split(":", 1)
            v = v.strip()
            # YAML block scalar: the value is the indented block, not the indicator.
            if v in (">", ">-", "|", "|-"):
                parts = []
                while i + 1 < len(lines) and lines[i + 1][:1].isspace() and lines[i + 1].strip():
                    i += 1; parts.append(lines[i].strip())
                v = (" " if v.startswith(">") else "\n").join(parts)
            out[k.strip()] = v.strip('"')
        i += 1
    return out, t[end+5:]

def kind(name):
    if name.startswith("principle-"): return "principle"
    if name == "poteto-mode": return "router"
    if name in ("setup-pstack",): return "setup"
    return "workflow"

def shipped(p):
    # Bytecode is a local artifact of running a script, never part of a build.
    return p.is_file() and "__pycache__" not in p.parts and p.suffix != ".pyc"

skills = []
for d in sorted((CORE / "skills").iterdir()):
    sm = d / "SKILL.md"
    if not sm.is_file():
        continue
    meta, body = fm(sm)
    name = meta.get("name", d.name)
    refs = sorted(str(x.relative_to(d)) for x in d.rglob("*") if shipped(x) and x.name != "SKILL.md")
    skills.append({
        "name": name,
        "dir": d.name,
        "kind": kind(d.name),
        "description": meta.get("description", ""),
        "paths": meta.get("paths"),
        "requires": REQUIRES.get(d.name, []),
        "degrades": d.name in DEGRADES,
        "hosts": HOST_ONLY.get(d.name, ["*"]),
        "files": refs,
    })

agents = []
for a in sorted((CORE / "agents").glob("*.md")):
    meta, _ = fm(a)
    agents.append({"name": meta.get("name", a.stem), "file": a.name,
                   "access": meta.get("access", "write"), "class": meta.get("class", "balanced"),
                   "description": meta.get("description", "")})

# Playbooks instruct fan-out too, and were shipping unannotated on every host.
PLAYBOOK_REQUIRES = {
    "investigation": ["DELEGATE", "PARALLEL"],
    "bug-fix": ["DELEGATE"],
    "feature": ["DELEGATE"],
    "refactoring": ["DELEGATE"],
    "perf-issue": ["DELEGATE"],
    "hillclimb": ["DELEGATE"],
    "multi-phase-plan": ["DELEGATE", "PARALLEL"],
    "orchestrate": ["DELEGATE", "PARALLEL", "BACKGROUND"],
    "autopilot-full": ["DELEGATE", "PARALLEL", "BACKGROUND"],
    "autopilot-stack": ["DELEGATE", "PARALLEL", "BACKGROUND"],
    "autonomous-run": ["DELEGATE", "BACKGROUND"],
    "shipping": ["DELEGATE", "PARALLEL"],
    "babysit": ["DELEGATE"],
    "eval": ["DELEGATE", "PARALLEL"],
    "visual-parity": ["DELEGATE"],
    "session-pickup": ["DELEGATE", "TRANSCRIPTS"],
    "worktree-cleanup": ["TRANSCRIPTS"],
}

PLAYBOOK_SUMMARY = {
    "investigation": "A read-only question: how does X work, why was Y built this way, are we sure.",
    "bug-fix": "Reproduce a defect, root-cause it, and fix it with runtime evidence.",
    "perf-issue": "Trace a measured slowness and improve it against a baseline.",
    "hillclimb": "Sustained improvement of one metric against a target, one commit per accepted win.",
    "runtime-forensics": "Diagnose a live symptom (leak, idle-CPU spin, glitch) from instrumentation.",
    "trace-forensics": "Diagnose a captured profiling artifact handed to you after the fact.",
    "feature": "New or changed behavior, built from a named data shape.",
    "refactoring": "A behavior-preserving change to structure or shape.",
    "prototype": "A throwaway sketch that settles a design or behavioral question by observation.",
    "visual-parity": "Pixel-exact UI equivalence between two implementations.",
    "authoring-a-skill": "Writing or editing a SKILL.md.",
    "eval": "Test how a skill or prompt change affects agent behavior, blinded.",
    "babysit": "Drive a PR or a stack to merge-ready: conflicts, review threads, CI.",
    "shipping": "Independently verify a green stack, then land the contiguous verified run.",
    "autonomous-run": "Drive a long task to completion without stopping.",
    "orchestrate": "A standing multi-day project under one coordinator: many stacked PRs, fleets of delegates.",
    "autopilot-full": "Run independent PRs to merged, one owner per PR, each head verified at the root.",
    "autopilot-stack": "Build and verify one linear base-branch stack for the operator to land.",
    "session-pickup": "Resume or take over a prior agent's in-flight work.",
    "pause-safely": "Suspend in-flight work cleanly so it can be resumed later.",
    "multi-phase-plan": "Work that spans phases or stacked PRs.",
    "worktree-cleanup": "Reclaim disk by pruning merged or abandoned worktrees, safety-gated.",
    "opening-a-pr": "Open a ready PR from small ordered commits. Invoked at the end of every playbook that ships a code change.",
}

playbooks = []
for pb in sorted((CORE / "playbooks").glob("*.md")):
    first = ""
    for line in pb.read_text(encoding="utf-8", errors="ignore").split("\n"):
        if line.strip() and not line.startswith("#"):
            first = line.strip(); break
    playbooks.append({"name": pb.stem, "file": pb.name, "summary": PLAYBOOK_SUMMARY.get(pb.stem, first[:160]),
                      "requires": PLAYBOOK_REQUIRES.get(pb.stem, [])})

runtime = sorted(p.name for p in (CORE / "runtime").glob("*.md"))

automations = []
for d in sorted((CORE / "automations").iterdir()) if (CORE / "automations").is_dir() else []:
    if not d.is_dir(): continue
    automations.append({
        "name": d.name,
        "requires": ["TRIGGER", "CHANNEL"],
        "degrades": True,
        "skills": sorted(s.parent.name for s in d.rglob("SKILL.md")),
        "files": len([f for f in d.rglob("*") if shipped(f)]),
    })
guide = sorted(str(p.relative_to(CORE / "docs" / "guide")) for p in (CORE / "docs" / "guide").rglob("*") if p.is_file()) if (CORE / "docs" / "guide").is_dir() else []

manifest = {
    "name": "pstack-portable",
    "version": "1.0.0",
    # Record which upstream revision this port was derived from, so drift is a
    # fact you can check rather than something you discover by reading a diff.
    "upstream": {"project": "pstack", "author": "Lauren Tan (poteto)",
                 "repo": "https://github.com/cursor/plugins/tree/main/pstack",
                 "license": "MIT", "version": UPSTREAM["version"],
                 "commit": UPSTREAM["commit"]},
    # Files the port rewrote. The hash is the upstream content they were derived
    # FROM, so a re-derivation can tell "upstream did not change this" apart from
    # "upstream changed this and we silently threw it away".
    "port_owned": UPSTREAM["port_owned"],
    "runtime": runtime,
    "counts": {"skills": len(skills), "agents": len(agents), "playbooks": len(playbooks),
               "principles": sum(1 for s in skills if s["kind"] == "principle"),
               "automations": len(automations), "guide": len(guide)},
    "automations": automations,
    "guide": guide,
    "agents": agents,
    "playbooks": playbooks,
    "skills": skills,
}
(CORE / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
c = manifest["counts"]
print(f"skills={c['skills']} (principles={c['principles']}) agents={c['agents']} playbooks={c['playbooks']} "
      f"runtime={len(runtime)} automations={c['automations']} guide={c['guide']}")
print("capability-gated:", ", ".join(sorted(REQUIRES)))
