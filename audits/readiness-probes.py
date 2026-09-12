"""Exercise completion-check edge cases; optionally pass a built run-record.py path."""

import json
import hashlib
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHECKER = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / "core/skills/poteto-mode/scripts/run-record.py"
ENV = {
    **os.environ,
    "GIT_AUTHOR_NAME": "pstack-readiness",
    "GIT_AUTHOR_EMAIL": "readiness@localhost",
    "GIT_COMMITTER_NAME": "pstack-readiness",
    "GIT_COMMITTER_EMAIL": "readiness@localhost",
    "GIT_CONFIG_GLOBAL": os.devnull,
    "GIT_CONFIG_NOSYSTEM": "1",
}


def probe(case):
    with tempfile.TemporaryDirectory(prefix="pstack-readiness-") as directory:
        base = Path(directory)
        repo = base / "repo"
        repo.mkdir()

        def command(*args, expected=0):
            result = subprocess.run(args, cwd=repo, env=ENV, capture_output=True, text=True)
            assert result.returncode == expected, result.stdout + result.stderr
            return result

        def git(*args):
            return command("git", *args)

        def rr(*args):
            return command(sys.executable, str(CHECKER), *args)

        def output(name, text):
            path = base / name
            path.write_text(text)
            return str(path)

        def actual_check(name, expected):
            result = command(sys.executable, "-B", "check.py", expected=expected)
            return output(name, result.stdout + result.stderr)

        git("init", "-q")
        (repo / "app.py").write_text("def value():\n    return 0\n")
        git("add", "app.py")
        git("commit", "-qm", "base")
        rr("init", "--route", "bug-fix", "--task", case)
        (repo / "check.py").write_text(
            "from app import value\nassert value() == 1, 'wrong value'\nprint('PASS')\n"
        )
        git("add", "check.py")
        git("commit", "-qm", "test: expose wrong value")
        failing = actual_check("repro.txt", 1)
        rr("baseline", "--harness", "check.py", "--command", "python3 -B check.py", "--output", failing)
        rr("evidence", "--kind", "repro", "--result", "fail", "--output", failing)
        rr("phase", "reproduce", "--done")
        rr("phase", "root-cause", "--done")
        rr("phase", "plan", "--skip", "one-function diagnostic fixture")
        (repo / "app.py").write_text("def value():\n    return 1\n")
        rr("phase", "implement", "--done", "--note", "parent owns this diagnostic fixture")
        rr("phase", "cleanup", "--done")

        if case in ("stale_review", "failed_review"):
            review_result = "fail" if case == "failed_review" else "pass"
            review = output("review.txt", f"Review result: {review_result}\n")
            rr("evidence", "--kind", "review", "--result", review_result, "--output", review)
            rr("phase", "review", "--done")
        else:
            rr("phase", "review", "--skip", "no final-panel trigger in this diagnostic")

        if case == "stale_review":
            (repo / "app.py").write_text("def value():\n    return 1\n\ndef extra():\n    return 7\n")
        if case in ("verification_skipped", "old_skip_then_failed_verification"):
            rr("phase", "verify", "--skip", "diagnostic checks whether mandatory proof can be skipped")
        if case == "old_skip_then_failed_verification":
            (repo / "app.py").write_text("def value():\n    return 2\n")
            failed = actual_check("verify-failed.txt", 1)
            rr("evidence", "--kind", "verify", "--result", "fail", "--output", failed)
            rr("phase", "verify", "--done")
        elif case != "verification_skipped":
            passed = actual_check("verify-passed.txt", 0)
            rr("evidence", "--kind", "verify", "--result", "pass", "--output", passed)
            rr("phase", "verify", "--done")

        git("add", "app.py")
        git("commit", "-qm", "fix fixture")
        rr("phase", "commits", "--done")
        rr("phase", "open-pr", "--skip", "local diagnostic; no remote")
        result = subprocess.run(
            [sys.executable, str(CHECKER), "check"], cwd=repo, env=ENV, capture_output=True, text=True
        )
        return {"case": case, "expected_exit_code": 1, "actual_exit_code": result.returncode,
                "output": result.stdout.strip(), "stderr": result.stderr.strip()}


if __name__ == "__main__":
    before = hashlib.sha256(CHECKER.read_bytes()).hexdigest()
    results = [probe(case) for case in (
        "stale_review", "failed_review", "verification_skipped", "old_skip_then_failed_verification"
    )]
    after = hashlib.sha256(CHECKER.read_bytes()).hexdigest()
    print(json.dumps({"checked_at": datetime.now(timezone.utc).isoformat(),
                      "checker": str(CHECKER.relative_to(ROOT)),
                      "sha256_before": before, "sha256_after": after,
                      "stable_during_check": before == after, "results": results}, indent=2))
