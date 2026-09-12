#!/usr/bin/env python3
"""Normalize the automation pack and the user guide, which pass 1 and 2 did not cover."""
import re, pathlib, json
from collections import Counter
CORE = pathlib.Path(__file__).resolve().parent.parent / "core"
stats = Counter()

# Port-owned files are normalized by hand and restored verbatim by the recipe.
# Running the substitution passes over them again undoes deliberate wording, which
# is the same failure that corrupted runtime/ (see docs/PORTING.md 11.3).
# The one list lives in build/upstream.json.
PORT_OWNED = list(json.loads((CORE.parent / "build" / "upstream.json").read_text())["port_owned"])


# ORDER GUARD. These passes are not commutative: running out of order produces
# text like "the your agent host environment". Refuse rather than corrupt.
_probe = (CORE / "runtime" / "host-profile.md")
if _probe.is_file() and "Cursor" not in _probe.read_text(encoding="utf-8"):
    raise SystemExit(f"{__file__}: runtime layer looks rewritten; run the passes in order "
                     "(normalize-core, pass2, pass3, pass4) per docs/PORTING.md")

RULES = [
  # automation runner
  (r"\btwo cursor automations\b", "two automations", "auto"),
  (r"\bcursor automations?\b", "automations", "auto"),
  (r"\bCursor automations?\b", "Automations", "auto"),
  (r"\.cursor/automations/benny/", ".pstack/automations/benny/", "paths"),
  (r"\.cursor/automations/", ".pstack/automations/", "paths"),
  (r"\.cursor/benny/", ".pstack/benny/", "paths"),
  (r"(?<!~/)\.cursor/skills/", "{{SKILL_DIR}}/", "paths"),
  (r"`\.cursor/settings\.json`", "your host's project settings file", "paths"),
  (r"point cursor at", "point your agent at", "auto"),
  (r"\blet cursor\b", "let your agent", "auto"),
  # Never inside a dotted path (`.cursor/...`): `\b` matches after the dot and
  # rewrites a real directory name into one containing a space.
  (r"(?<![.\w/])cursor\b(?!-)", "your agent", "auto"),
  (r"(?<![-./\w])Cursor\b", "your agent host", "auto"),
  # the settings.json enablement block is Cursor-only; the port installs by copy
  (r'```json\n\{\n\t"plugins": \{\n\t\t"pstack": \{ "enabled": true \}\n\t\}\n\}\n```',
   "Install pstack into the target repository with `install.sh`, so benny's skills can reach the\n"
   "shared pstack skills they depend on.", "auto"),
  # slash-skill phrasing
  (r"they do not appear as slash skills", "they are not invoked directly as slash skills", "auto"),
]

targets = list((CORE / "automations").rglob("*.md")) + list((CORE / "docs").rglob("*.md")) \
        + list((CORE / "automations").rglob("*.yaml"))
for p in targets:
    if p.relative_to(CORE).as_posix() in PORT_OWNED:
        continue
    t0 = t = p.read_text(encoding="utf-8")
    for pat, repl, key in RULES:
        t, n = re.subn(pat, repl, t)
        if n: stats[key] += n
    # drop the Cursor-only frontmatter key
    t = re.sub(r"^disable-model-invocation: true\n", "", t, flags=re.M)
    if t != t0:
        p.write_text(t, encoding="utf-8"); stats["files"] += 1
print("pass3:", dict(stats))
