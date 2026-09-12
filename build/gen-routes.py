#!/usr/bin/env python3
"""Generate the phase graph of every playbook, for run records and `pstack serve`.

Each numbered step of a playbook becomes a phase `step-N`, joined in order. A loop-back the
playbook states ("back to step N", "returns to step N") becomes a back edge. Bug fix keeps the named
phases run-record.py checks, and Opening a PR, which is written as sections rather than steps, gets
its sequence here. Writes core/skills/poteto-mode/scripts/routes.json.
"""
import importlib.util
import json
import re
import sys
from pathlib import Path

# Importing run-record.py below must not leave __pycache__ in core, which the manifest would list.
sys.dont_write_bytecode = True

from build_lock import ensure_build_lock

ensure_build_lock()

ROOT = Path(__file__).resolve().parent.parent
CORE = ROOT / "core"
SCRIPTS = CORE / "skills" / "poteto-mode" / "scripts"
OUT = SCRIPTS / "routes.json"

spec = importlib.util.spec_from_file_location("run_record", SCRIPTS / "run-record.py")
run_record = importlib.util.module_from_spec(spec)
spec.loader.exec_module(run_record)

STEP = re.compile(r"^(\d+)\.\s+(.*)$")
LOOP = re.compile(r"(?:go(?:es)? back to|sends? you back to|returns? to|back to)\s+step\s+(\d+)", re.I)

# The named phases run-record.py checks, with the playbook step each belongs to and the
# loop-backs bug-fix.md states in prose.
NAMED = {
    "bug-fix": {
        "labels": {"reproduce": (1, "Reproduce, freeze the baseline"), "root-cause": (2, "Root-cause"),
                   "plan": (3, "Plan the fix"), "implement": (3, "Implement"),
                   "cleanup": (3, "Clean up: slop, no-comments"), "review": (3, "Review: interrogate"),
                   "verify": (4, "Verify on the same surface"), "commits": (5, "Order the commits"),
                   "open-pr": (6, "Opening a PR")},
        "back": [("verify", "root-cause", "fail or inconclusive"),
                 ("review", "implement", "accepted finding"),
                 ("implement", "plan", "diff violates the design"),
                 ("open-pr", "verify", "PR pass changed code")],
        "steps": [
            {"id": "root-cause/how", "parent": "root-cause", "label": "How: explain the mechanism", "row": 0, "lane": 0},
            {"id": "root-cause/why", "parent": "root-cause", "label": "Why: investigate history", "row": 0, "lane": 1},
            {"id": "root-cause/confirm", "parent": "root-cause", "label": "Parent confirms with runtime evidence", "row": 1, "lane": 0},
            {"id": "plan/architect-a", "parent": "plan", "label": "Architect A: ground", "row": 0, "lane": 0},
            {"id": "plan/architect-b", "parent": "plan", "label": "Architect B: compare and synthesize", "row": 1, "lane": 0},
            {"id": "plan/architect-c", "parent": "plan", "label": "Architect C: approval if requested", "row": 2, "lane": 0},
        ],
        "step_edges": [
            {"from": "root-cause", "to": "root-cause/how", "kind": "branch"},
            {"from": "root-cause", "to": "root-cause/why", "kind": "branch"},
            {"from": "root-cause/how", "to": "root-cause/confirm", "kind": "join"},
            {"from": "root-cause/why", "to": "root-cause/confirm", "kind": "join"},
            {"from": "plan", "to": "plan/architect-a", "kind": "branch"},
            {"from": "plan/architect-a", "to": "plan/architect-b", "kind": "next"},
            {"from": "plan/architect-b", "to": "plan/architect-c", "kind": "next"},
        ],
    },
    # The slop pass runs before commit (opening-a-pr.md, PRs), so cleanup precedes commits. The
    # playbook states no loop-back: a pass that changed code is caught by reverify, which follows.
    "opening-a-pr": {
        "labels": {"worktree": (1, "Worktree"), "cleanup": (2, "Slop pass and no-comments"),
                   "commits": (3, "Small ordered commits"), "reverify": (4, "Reverify if code changed"),
                   "write": (5, "Title and description"), "create": (6, "Create on the forge"),
                   "readiness": (7, "Ready, not draft")},
        "back": [],
    },
}


def clean(text):
    text = re.sub(r"\*\*|`|\[([^\]]*)\]\([^)]*\)", lambda m: m.group(1) or "", text).strip()
    first = re.split(r"(?<=[a-z0-9)])[.:](?:\s|$)", text, maxsplit=1)[0]
    return first if len(first) <= 56 else first[:55].rstrip() + "…"


def title_of(body, name):
    m = re.search(r"^#{1,4}\s+(.+)$", body, re.M)
    return m.group(1).strip() if m else name.replace("-", " ").capitalize()


def chain(ids):
    return [{"from": a, "to": b, "kind": "next"} for a, b in zip(ids, ids[1:])]


def numbered_steps(body):
    steps, current = [], None
    for line in body.splitlines():
        m = STEP.match(line)
        if m:
            current = {"n": int(m.group(1)), "text": m.group(2)}
            steps.append(current)
        elif current and (line.startswith(" ") or not line.strip()):
            current["text"] += "\n" + line
        else:
            current = None
    for step in steps:
        step["text"] = step["text"].rstrip()
    return steps


def route(path):
    name = path.stem
    body = path.read_text(encoding="utf-8")
    title = title_of(body, name)
    if name in NAMED:
        spec = NAMED[name]
        order = run_record.ROUTES.get(name, {}).get("phases") or list(spec["labels"])
        missing = [p for p in order if p not in spec["labels"]]
        if missing:
            raise SystemExit(f"gen-routes: {name} phases without a label: {missing}")
        phases = [{"id": p, "label": f"{spec['labels'][p][0]}. {spec['labels'][p][1]}",
                   "step": spec["labels"][p][0]} for p in order]
        back = [{"from": a, "to": b, "kind": "back", "label": why} for a, b, why in spec["back"]]
        return {"version": 1, "title": title, "phases": phases, "edges": chain(order) + back, "named": True,
                "steps": spec.get("steps", []), "step_edges": spec.get("step_edges", [])}

    steps = numbered_steps(body)
    if not steps:
        raise SystemExit(f"gen-routes: {name} has no numbered steps and no named phases")
    ids = [f"step-{s['n']}" for s in steps]
    phases = [{"id": f"step-{s['n']}", "label": f"{s['n']}. {clean(s['text'])}", "step": s["n"], "description": s["text"]} for s in steps]
    back = []
    for s in steps:
        for target in {int(t) for t in LOOP.findall(s["text"])}:
            if target < s["n"] and f"step-{target}" in ids:
                back.append({"from": f"step-{s['n']}", "to": f"step-{target}", "kind": "back",
                             "label": "the playbook loops back"})
    return {"version": 1, "title": title, "phases": phases, "edges": chain(ids) + back, "named": False}


# "run": false marks a playbook that records on the task's run and starts none of its own (Pause
# safely). It keeps its phase graph and checklist for `pstack serve`, but no gates, and init refuses it.
CONTRACT_KEYS = {"ordered", "gates", "reroute_to", "run"}
GATE_KEYS = {"evidence", "fresh", "skip", "skip_with", "skip_reasons", "delegate", "parent_note", "steps"}
EVIDENCE = {"artifact", "verify", "review"}


def contract_problems(name, contract, graph, playbooks, runless=frozenset()):
    """What run-record.py would misread in one playbook's contract. Each key has one meaning."""
    ids = [p["id"] for p in graph["phases"]]
    parents = {s["id"]: s.get("parent") for s in graph.get("steps", [])}
    out = [f"unknown contract key {k}" for k in sorted(set(contract) - CONTRACT_KEYS)]
    out += [f"reroute_to names no other playbook that starts a run: {r}" for r in contract.get("reroute_to", [])
            if r not in playbooks or r == name or r in runless]
    if not isinstance(contract.get("run", True), bool):
        out.append("run must be true or false")
    if contract.get("run") is False and (contract.get("gates") or contract.get("reroute_to")):
        out.append("a playbook that starts no run has no gates and no reroute")
    for phase, gate in contract.get("gates", {}).items():
        if phase not in ids:
            out.append(f"gate on a missing phase: {phase}")
        out += [f"{phase}: unknown gate key {k}" for k in sorted(set(gate) - GATE_KEYS)]
        if gate.get("evidence", "artifact") not in EVIDENCE:
            out.append(f"{phase}: unknown evidence kind {gate['evidence']}")
        out += [f"{phase}: {s} is not a step under {phase}" for s in gate.get("steps", []) if parents.get(s) != phase]
        dep = gate.get("skip_with")
        if dep is not None and (gate.get("skip") is not True or dep == phase or dep not in ids):
            out.append(f"{phase}: skip_with needs skip: true and another phase of {name}")
        reasons = gate.get("skip_reasons")
        if reasons is not None and (gate.get("skip") is not True or not isinstance(reasons, list) or not reasons
                                    or any(not isinstance(r, str) or len(r.split()) != 1 for r in reasons)):
            out.append(f"{phase}: skip_reasons needs skip: true and a list of one-word reasons")
    return out


def main():
    routes = {p.stem: route(p) for p in sorted((CORE / "playbooks").glob("*.md"))}
    contracts = json.loads((ROOT / "build/route-contracts.json").read_text())
    if contracts.keys() != routes.keys():
        raise SystemExit("gen-routes: every playbook must have an explicit completion contract")
    for name, graph in routes.items():
        contract = contracts[name]
        ids = [p["id"] for p in graph["phases"]]
        runless = {n for n, c in contracts.items() if c.get("run") is False}
        bad = contract_problems(name, contract, graph, routes.keys(), runless)
        if bad:
            raise SystemExit(f"gen-routes: {name} contract: {'; '.join(bad)}")
        contract["version"] = 1
        contract["order"] = ([[a, b] for a, b in zip(ids, ids[1:])]
                             if contract.get("ordered", True) else run_record.ROUTES.get(name, {}).get("order", []))
        for gate in contract["gates"].values():
            gate.setdefault("skip", False)
        graph["contract"] = contract
        steps = numbered_steps((CORE / "playbooks" / f"{name}.md").read_text())
        graph["checklist"] = [{"id": f"step-{s['n']}", "text": f"{s['n']}. {s['text']}",
                               "phases": [p["id"] for p in graph["phases"] if p["step"] == s["n"]]}
                              for s in steps] or [{"id": p["id"], "text": p["label"], "phases": [p["id"]]}
                                                  for p in graph["phases"]]
    blueprints = json.loads((ROOT / "build/workflow-blueprints.json").read_text())
    for name, flow in blueprints.items():
        routes[name]["flow"] = flow
    OUT.write_text(json.dumps(routes, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"routes: {len(routes)} playbooks, {sum(len(r['phases']) for r in routes.values())} phases -> "
          f"{OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
