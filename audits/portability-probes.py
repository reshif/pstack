"""Reproduce portability gaps in temporary installs; never touch a user's install."""

import contextlib
import io
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packaging" / "src"))

from pstack_cli.cli import main


def invoke(*args):
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        code = main(list(args))
    return {"exit_code": code, "output": output.getvalue().strip()}


def install(target, host):
    result = invoke("init", "--host", host, "--target", str(target))
    assert result["exit_code"] == 0, result


def main_probe():
    results = {}
    profile = {
        "host": "claude-code",
        "tier": 2,
        "capabilities": {"DELEGATE": True, "MODEL_CHOICE": "partial"},
        "models": {"deep": "opus", "fast": "sonnet"},
    }
    with tempfile.TemporaryDirectory(prefix="pstack-portability-") as directory:
        root = Path(directory)

        malformed = root / "malformed"
        install(malformed, "claude")
        (malformed / ".pstack/host.json").write_text("not json\n")
        results["doctor_with_invalid_json"] = invoke("doctor", "--target", str(malformed))

        mismatch = root / "mismatch"
        install(mismatch, "codex")
        (mismatch / ".pstack/host.json").write_text(json.dumps(profile))
        results["doctor_with_claude_profile_in_codex_install"] = invoke(
            "doctor", "--target", str(mismatch)
        )

        switching = root / "switching"
        install(switching, "claude")
        (switching / ".pstack/host.json").write_text(json.dumps(profile))
        (switching / ".pstack/models.md").write_text("bug-fix: opus\n")
        install(switching, "codex")
        receipt = json.loads((switching / ".pstack/receipt.json").read_text())
        results["switch_claude_to_codex"] = {
            "receipt_host": receipt["host"],
            "profile_host": json.loads((switching / ".pstack/host.json").read_text())["host"],
            "models": (switching / ".pstack/models.md").read_text().strip(),
            "both_skill_trees_present": all(
                (switching / path).is_dir() for path in (".claude/skills", ".agents/skills")
            ),
        }
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main_probe()
