#!/usr/bin/env python3
"""Residual host-coupling fixes the bulk pass could not do context-free."""
import re, pathlib, json
from collections import Counter
CORE = pathlib.Path(__file__).resolve().parent.parent.parent / "core"
stats = Counter()

# Port-owned files are normalized by hand and restored verbatim by the recipe.
# Running the substitution passes over them again undoes deliberate wording, which
# is the same failure that corrupted runtime/ (see docs/PORTING.md 11.3).
# The one list lives in build/port/upstream.json.
PORT_OWNED = list(json.loads((CORE.parent / "build" / "port" / "upstream.json").read_text())["port_owned"])


RULES = [
    # transcript store: every host has one, at a different path
    (r"Transcripts live at `~/\.cursor/projects/<slug>/agent-transcripts/<uuid>/<uuid>\.jsonl`, where `<slug>` is the workspace path with the leading slash dropped and each \"/\" turned into \"-\" \(so `/Users/you/proj` becomes `Users-you-proj`\)\. Every line is one chat message\.",
     "Transcripts live in the host's session store (`runtime/host-profile.md` names it per host). "
     "Resolve the path for the active workspace only, and treat each line or entry as one chat message. "
     "If the host exposes no readable transcript, say so and rebuild context from the repo and the shared record instead.",
     "transcripts"),
    (r"Don't glob across `~/\.cursor/projects/\*/`\.", "Never glob across the host's other workspaces.", "transcripts"),
    (r"Do not glob across `~/\.cursor/projects/\*/`\.", "Never glob across the host's other workspaces.", "transcripts"),
    (r"\(the system prompt names the path\. Do not glob across `~/\.cursor/projects/\*/`, that crosses workspace boundaries and reads private chats from unrelated projects\)",
     "(resolve it for the active workspace only, never across the host's other workspaces)", "transcripts"),
    # plugin install paths
    (r"or plugin-installed paths under `~/\.cursor/plugins/`", "or wherever the host installs plugins", "paths"),
    # cloud agents -> delegates
    (r"each a Cursor cloud agent, ", "each an isolated delegate, ", "cloud"),
    (r"One Cursor cloud agent per PR", "One delegate per PR", "cloud"),
    (r"the cloud agent's status in the Cursor dashboard", "the delegate's status as the host reports it", "cloud"),
    # worktree + cache locations
    (r"`\.cursor/worktrees/myrepo/x`", "a host-managed worktree root", "paths"),
    (r"`~/Library/Application Support/Cursor` \(`state\.vscdb\.backup`, and `snapshots/roots/<root>` where a `<root>` named for a folder you opened as a workspace balloons\), ",
     "the host's own application-support directory (session snapshots and state backups balloon there), ", "paths"),
    # MCP discovery
    (r"list the available MCPs from the Cursor environment\. Use the available-tools map when present\. Otherwise inspect the `mcps/` directory Cursor exposes for enabled MCP servers\.",
     "list the MCP servers reachable in this session. Use the host's available-tools map when it exposes one. "
     "Otherwise read the host's MCP configuration (`.mcp.json`, `~/.claude.json`, `~/.codex/config.toml`, or the host's settings) for enabled servers.",
     "mcp"),
    # last subagent_type residuals
    (r'Spawn `Task` with `subagent_type: "Comment Sicko"`',
     'Delegate to the `comment-sicko` agent (`role: comment-sicko`, `access: write`)', "delegate"),
    (r"set their own `subagent_type` for diverse-model review",
     "set their own delegate roles for diverse review", "delegate"),
    (r"`/poteto-mode` and `poteto-agent` route through the same wrapper\.",
     "`/poteto-mode` and the pstack worker agent route through the same wrapper.", "delegate"),
    (r"don't override to `poteto-agent`", "don't override to the worker role", "delegate"),
]

for p in sorted(CORE.rglob("*.md")):
    if "runtime" in p.relative_to(CORE).parts:
        continue
    if p.relative_to(CORE).as_posix() in PORT_OWNED:
        continue  # runtime/ intentionally names hosts
    t0 = t = p.read_text(encoding="utf-8")
    for pat, repl, key in RULES:
        t, n = re.subn(pat, repl, t)
        if n: stats[key] += n
    if t != t0:
        p.write_text(t, encoding="utf-8")

print("pass2:", dict(stats))
