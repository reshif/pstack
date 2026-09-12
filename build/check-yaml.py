#!/usr/bin/env python3
"""Strict YAML parse of every emitted frontmatter block."""
import pathlib, sys, yaml
from build_lock import ensure_build_lock

ensure_build_lock()
bad = n = 0
for f in pathlib.Path("dist").rglob("*.md"):
    t = f.read_text(encoding="utf-8")
    if not t.startswith("---\n"): continue
    e = t.find("\n---\n", 4)
    if e == -1: continue
    n += 1
    try:
        d = yaml.safe_load(t[4:e])
        if not isinstance(d, dict): raise ValueError("frontmatter is not a mapping")
        if not (d.get("name") or d.get("description") or d.get("applyTo")):
            raise ValueError("no identity key (name/description/applyTo)")
    except Exception as ex:
        bad += 1; print(f"BAD {f}: {ex}")
print(f"yaml: parsed {n} blocks, {bad} invalid")
sys.exit(1 if bad else 0)
