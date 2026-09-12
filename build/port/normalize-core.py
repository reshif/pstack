#!/usr/bin/env python3
"""Strip Cursor-specific coupling out of the vendored pstack tree.

Run once against core/. Idempotent. Every rule here is a portability fix; anything
that changes what pstack *decides* belongs in a hand edit, not this file.
"""
import re, sys, pathlib, json
from collections import Counter

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
CORE = ROOT / "core"

SLUG_CLASS = {
    "claude-fable-5-1-thinking-max": "deep",
    "claude-opus-5-thinking-xhigh": "deep",
    "gpt-5.6-sol-max": "balanced",
    "grok-4.6-fast-xhigh": "fast",
}
SLUG_RE = "|".join(re.escape(s) for s in SLUG_CLASS)
# a run of 2+ slugs separated by commas/and = a diversity panel, not four choices
PANEL_RE = re.compile(rf"`?(?:{SLUG_RE})`?(?:\s*(?:,|and)\s*`?(?:{SLUG_RE})`?){{1,}}")
ONE_RE = re.compile(rf"`?({SLUG_RE})`?")

stats = Counter()

# Port-owned files are normalized by hand and restored verbatim by the recipe.
# Running the substitution passes over them again undoes deliberate wording, which
# is the same failure that corrupted runtime/ (see docs/PORTING.md 11.3).
# The one list lives in build/port/upstream.json, next to the upstream hash each rewrite
# was derived from, so the recipe, check-upstream.py and all four passes agree.
PORT_OWNED = list(json.loads((ROOT / "build" / "port" / "upstream.json").read_text())["port_owned"])


def sub(pat, repl, text, key, flags=0):
    new, n = re.subn(pat, repl, text, flags=flags)
    if n:
        stats[key] += n
    return new

def normalize(text: str, rel: str) -> str:
    # 1. model slugs -> portable classes
    text = sub(PANEL_RE, "the `panel` pool (see `runtime/roles.md`)", text, "slug-panel")
    text = sub(ONE_RE, lambda m: f"the `{SLUG_CLASS[m.group(1)]}` class", text, "slug-single")

    # 2. config location
    text = sub(r"~/\.cursor/rules/pstack-models\.mdc", "`.pstack/models.md`", text, "config-path")
    text = sub(r"an always-applied rule", "the pstack config", text, "config-path")

    # 3. delegation spec fields
    text = sub(r"- `subagent_type`: `generalPurpose`\n", "- `role`: see below\n", text, "delegate-field")
    text = sub(r'`subagent_type: "poteto-agent"`', "the pstack worker role", text, "delegate-field")
    text = sub(r"`subagent_type: generalPurpose`", "the default delegate role", text, "delegate-field")
    text = sub(r"- `readonly`: `true`\n", "- `access`: `read`\n", text, "delegate-field")
    text = sub(r"- `readonly`: `false` \(agent mode\)\.[^\n]*\n",
               "- `access`: `read`. The delegate may call tools, including MCP tools. It must not write.\n",
               text, "delegate-field")
    text = sub(r"`readonly: false`", "`access: read`", text, "delegate-field")
    text = sub(r"`readonly: true`", "`access: read`", text, "delegate-field")
    text = sub(r"`run_in_background: true`", "`detached: yes`", text, "delegate-field")
    text = sub(r'`environment: "cloud"`', "`isolation: dir`", text, "delegate-field")
    text = sub(r'`environment: "local"`', "`isolation: none`", text, "delegate-field")
    text = sub(r"\bthe Task tool\b", "the delegation protocol (`runtime/delegation.md`)", text, "task-tool")
    text = sub(r"`Task` (calls?|prompts?|subagent|response)", r"delegate \1", text, "task-tool")
    text = sub(r"\bTask subagent\b", "delegate", text, "task-tool")
    text = sub(r"\bTask `model`\b", "the delegate's model field", text, "task-tool")

    # 4. question primitive
    text = sub(r"`AskQuestion`|\bAskQuestion\b",
               "a structured question (`runtime/interaction.md`)", text, "ask")

    # 5. host-specific plugin deps -> bundled equivalents
    text = sub(r"the `deslop` skill from the `cursor-team-kit` plugin \(`/deslop`\)",
               "the **unslop** skill", text, "team-kit")
    text = sub(r"`cursor-team-kit` publishes `control-cli` \(CLIs and TUIs\) and `control-ui` \(browser / Electron / web UIs\)\.",
               "Generate one with **create-verification-skill** if the project has none.", text, "team-kit")
    text = sub(r"the `cursor-team-kit` plugin", "the project's verification skills", text, "team-kit")
    text = sub(r"`cursor-team-kit`", "the project's verification skills", text, "team-kit")
    text = sub(r"Cursor's built-in skill for authoring SKILL\.md files",
               "your host's skill-authoring guidance", text, "builtin")
    text = sub(r"\(Cursor's built-in for authoring SKILL\.md files\)",
               "(your host's skill-authoring guidance)", text, "builtin")
    text = sub(r"and not Cursor's built-in babysit skill, whose description matches the same words",
               "and not any similarly-named host built-in", text, "builtin")

    # 6. automated reviewers
    text = sub(r"\bBugbot\b", "the automated reviewer", text, "reviewer")
    text = sub(r"\bbugbot\b", "automated-reviewer", text, "reviewer")

    # 7. host naming
    text = sub(r"\bCursor's\b", "the host's", text, "host")
    text = sub(r"a Cursor restart", "a host restart", text, "host")
    text = sub(r"\bCursor also exposes\b", "the host also exposes", text, "host")
    text = sub(r"\bIn Cursor\b", "On the host", text, "host")
    text = sub(r"\bcursor's\b", "the host's", text, "host")

    # 8. paths
    text = sub(r"(?<!~/)\.cursor/skills/", "{{SKILL_DIR}}/", text, "paths")
    text = sub(r"~/\.cursor/skills/", "{{USER_SKILL_DIR}}/", text, "paths")

    return text

def strip_frontmatter_keys(text: str):
    if not text.startswith("---\n"):
        return text
    end = text.find("\n---\n", 4)
    if end == -1:
        return text
    fm, body = text[4:end], text[end+5:]
    drop = ("disable-model-invocation:", "icon:", "color:", "mode:", "reminder:", "is_background:")
    kept, meta = [], {}
    for line in fm.split("\n"):
        k = line.split(":")[0].strip() if ":" in line else ""
        if line.startswith(drop):
            stats["fm-dropped"] += 1
            meta[k] = line.split(":", 1)[1].strip()
            continue
        kept.append(line)
    return "---\n" + "\n".join(kept).strip("\n") + "\n---\n" + body

changed = 0
for p in sorted(CORE.rglob("*")):
    if not p.is_file() or p.suffix not in (".md", ".tsv"):
        continue
    # runtime/ is the portability layer. It names hosts and their native tool
    # names on purpose, so the substitution rules must never touch it.
    if "runtime" in p.relative_to(CORE).parts:
        continue
    if p.relative_to(CORE).as_posix() in PORT_OWNED:
        continue
    orig = p.read_text(encoding="utf-8", errors="ignore")
    new = normalize(orig)  if False else normalize(orig, str(p.relative_to(CORE)))
    if p.suffix == ".md":
        new = strip_frontmatter_keys(new)
    if new != orig:
        p.write_text(new, encoding="utf-8")
        changed += 1

print(f"files rewritten: {changed}")
for k, v in stats.most_common():
    print(f"  {k:16} {v}")
