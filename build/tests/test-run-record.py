#!/usr/bin/env python3
"""Behavior of the bug-fix completion checker, run against real git repositories.

Each case drives a run to a state an agent can reach and asserts what `check`
says about it. Case `edited_harness` is the failure from the bug-fix run audit, in
git history: `git show 30b9dfb:audits/2026-09-10-bugfix-run-736701de.md`. The fix
commit edited the harness, and only the original harness exposed the lost email.
"""
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent.parent / "core/skills/poteto-mode/scripts/run-record.py"
# Cases that import run-record.py must not leave __pycache__ in core, which the manifest would list.
sys.dont_write_bytecode = True
ENV = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t",
       "GIT_COMMITTER_EMAIL": "t@t", "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}


class Run:
    def __init__(self, tmp):
        self.root = Path(tmp) / "repo"
        self.out = Path(tmp) / "out"
        self.root.mkdir()
        self.out.mkdir()
        self.git("init", "-q")
        self.write("app.py", "def send():\n    return 0\n")
        self.git("add", "app.py")
        self.git("commit", "-qm", "base")

    def git(self, *args):
        subprocess.run(["git", *args], cwd=self.root, check=True, capture_output=True, env=ENV)

    def write(self, name, text):
        (self.root / name).write_text(text)

    def output(self, name, text):
        p = self.out / name
        p.write_text(text)
        return str(p)

    def rr(self, *args, code=0, cwd=None):
        r = subprocess.run([sys.executable, str(SCRIPT), *args], cwd=cwd or self.root,
                           capture_output=True, text=True, env=ENV)
        text = r.stdout + r.stderr
        assert r.returncode == code, f"rr {' '.join(args)} exited {r.returncode}, wanted {code}:\n{text}"
        return text

    def check(self, code, *fragments, through=None):
        text = self.rr("check", *(["--through", through] if through else []), code=code)
        for f in fragments:
            assert f in text, f"check output lacks {f!r}:\n{text}"

    def reproduce(self):
        self.rr("init", "--route", "bug-fix", "--task", "duplicate send after restart")
        self.write("test_app.py", "assert False, 'sent twice'\n")
        self.git("add", "test_app.py")
        self.git("commit", "-qm", "test: failing repro")
        o = self.output("repro.txt", "AssertionError: sent twice\n")
        self.rr("baseline", "--harness", "test_app.py", "--command", "python test_app.py", "--output", o)
        self.rr("evidence", "--kind", "repro", "--result", "fail", "--output", o)
        self.rr("phase", "reproduce", "--done")
        self.root_cause()
        self.rr("phase", "plan", "--skip", "fix stays inside one function")

    def root_cause(self):
        self.rr("phase", "root-cause", "--start")
        self.rr("phase", "root-cause/confirm", "--done")
        self.rr("phase", "root-cause", "--done")

    def implement(self):
        self.write("app.py", "def send():\n    return 1\n")
        self.rr("delegate", "--role", "pstack-worker", "--model", "deep", "--job", "implement")
        self.rr("phase", "implement", "--done")
        self.rr("phase", "cleanup", "--done")
        self.rr("phase", "review", "--skip", "no durable state or synthesis")

    def verify(self, result="pass", harness="current", name="verify.txt"):
        o = self.output(name, f"{result}\n")
        self.rr("evidence", "--kind", "verify", "--result", result, "--harness", harness, "--output", o)
        return o

    def finish(self):
        self.rr("phase", "verify", "--done")
        self.git("add", "-A")
        self.git("commit", "-qm", "fix: send once")
        self.rr("phase", "commits", "--done")
        self.rr("phase", "open-pr", "--done")


def run_started(text):
    """The run id from init's "run <id> started" line, whatever notes print before it."""
    m = re.search(r"^run (\S+) started", text, re.M)
    assert m, text
    return m.group(1)


def complete(r):
    r.reproduce(); r.implement(); r.verify(); r.finish()
    r.check(0, "complete")


def commit_after_verify_stays_current(r):
    r.reproduce(); r.implement(); r.verify(); r.finish()
    r.git("commit", "--amend", "-qm", "fix: send exactly once")
    r.check(0, "complete")


def edit_after_verify_is_stale(r):
    r.reproduce(); r.implement(); r.verify(); r.finish()
    r.write("app.py", "def send():\n    return 1  # cleanup\n")
    r.check(1, "verify: stale")
    r.verify(name="verify2.txt")
    r.check(0, "complete")


def same_size_edit_is_stale(r):
    r.reproduce(); r.implement(); r.verify()
    r.write("app.py", "def send():\n    return 2\n")
    r.rr("phase", "verify", "--done")
    r.check(1, "verify: stale", through="verify")


def edited_harness(r):
    r.reproduce(); r.implement()
    r.write("test_app.py", "LEASE_SECONDS = 1.0\n")
    r.verify()
    r.finish()
    r.check(1, "harness changed since the baseline", "original-harness verification")
    r.verify("fail", "original", "original.txt")
    r.check(1, "original harness gives fail")
    r.verify("pass", "original", "original2.txt")
    r.check(0, "complete")


def open_finding_blocks(r):
    r.reproduce(); r.implement(); r.verify(); r.finish()
    r.rr("finding", "add", "--id", "O1", "--source", "interrogate/operator", "--severity", "blocker",
         "--summary", "crash between claim and send loses the email")
    r.check(1, "finding O1", "open")
    r.rr("finding", "resolve", "--id", "O1", "--status", "fixed", "--reason", "claim released on crash")
    r.check(0, "complete")


def no_baseline(r):
    r.rr("init", "--route", "bug-fix", "--task", "t")
    for p in ("reproduce", "root-cause", "plan", "implement", "cleanup", "review", "verify", "commits", "open-pr"):
        r.rr("phase", p, "--done", "--note", "parent: test")
    r.check(1, "baseline: none recorded")


def repro_on_other_code(r):
    r.rr("init", "--route", "bug-fix", "--task", "t")
    r.write("test_app.py", "assert False\n")
    r.git("add", "test_app.py")
    r.git("commit", "-qm", "test")
    r.rr("baseline", "--harness", "test_app.py", "--command", "c", "--output", r.output("b.txt", "x"))
    r.write("app.py", "def send():\n    return 1\n")
    r.rr("evidence", "--kind", "repro", "--result", "fail", "--output", r.output("r.txt", "x"))
    r.check(1, "failing repro was recorded on code other than the baseline commit")


def implement_before_reproduce(r):
    r.rr("init", "--route", "bug-fix", "--task", "t")
    r.rr("phase", "implement", "--done", "--note", "parent: test")
    r.rr("phase", "reproduce", "--done")
    r.check(1, "phase implement: marked done before reproduce")


def evidence_file_rewritten(r):
    r.reproduce(); r.implement(); o = r.verify(); r.finish()
    Path(o).write_text("pass, honestly\n")
    r.check(1, "evidence file changed after it was recorded")


def implement_needs_an_owner(r):
    r.reproduce()
    r.write("app.py", "def send():\n    return 1\n")
    r.rr("phase", "implement", "--done")
    r.check(1, "no returned implementation delegate recorded", through="implement")


def check_through_commits(r):
    r.reproduce(); r.implement(); r.verify()
    r.rr("phase", "verify", "--done")
    r.rr("phase", "commits", "--done")
    r.check(0, "complete through commits", through="commits")
    r.check(1, "phase open-pr: not recorded")


def grounding_reuse(r):
    r.rr("init", "--route", "bug-fix", "--task", "t")
    o = r.output("how.md", "traced model\n")
    r.rr("ground", "add", "--skill", "how", "--scope", "app.py", "--output", o)
    assert "reusable" in r.rr("ground", "check", "--scope", "app.py")
    assert "uncovered" in r.rr("ground", "check", "--scope", "other.py", code=1)
    r.write("app.py", "def send():\n    return 2\n")
    assert "changed since how" in r.rr("ground", "check", "--scope", "app.py", code=1)


def harness_must_be_committed(r):
    r.rr("init", "--route", "bug-fix", "--task", "t")
    r.write("test_app.py", "assert False\n")
    text = r.rr("baseline", "--harness", "test_app.py", "--command", "c",
                "--output", r.output("b.txt", "x"), code=2)
    assert "not committed" in text, text


def record_is_outside_the_fingerprint(r):
    r.reproduce(); r.implement(); r.verify(); r.finish()
    r.rr("status")
    r.check(0, "complete")
    assert "runs" not in subprocess.run(["git", "status", "--porcelain"], cwd=r.root,
                                        capture_output=True, text=True).stdout


def failed_delegate_gets_one_retry(r):
    r.reproduce()
    r.rr("delegate", "--job", "runner-1", "--status", "launched", "--role", "pstack-worker", "--model", "sonnet", "--budget", "15")
    r.rr("delegate", "--job", "runner-1", "--status", "timeout", "--reason", "no result in 15 min")
    r.check(1, "delegate runner-1: ended timeout. Retry it once", through="plan")
    r.rr("delegate", "--job", "runner-1", "--status", "launched", "--budget", "10")
    r.rr("delegate", "--job", "runner-1", "--status", "failed", "--reason", "report had no sketch")
    text = r.rr("delegate", "--job", "runner-1", "--status", "launched", code=2)
    assert "used its 2 attempts" in text, text
    r.check(1, "Its retry is spent", through="plan")
    r.rr("delegate", "--job", "runner-1", "--status", "dropped", "--reason", "arena continues with N-1")
    r.check(0, "complete through plan", through="plan")


def open_delegate_blocks_completion(r):
    r.reproduce(); r.implement(); r.verify(); r.finish()
    r.rr("delegate", "--job", "judge", "--status", "launched", "--role", "pstack-reviewer", "--model", "fable")
    r.check(1, "delegate judge: attempt 1 is still open")
    r.rr("delegate", "--job", "judge", "--status", "returned")
    r.check(0, "complete")


def over_budget_delegate_says_cancel(r):
    r.reproduce()
    r.rr("delegate", "--job", "explorer", "--status", "launched", "--role", "pstack-reviewer",
         "--model", "sonnet", "--budget", "1")
    rec_path = next((r.root / ".pstack" / "runs").glob("*.json"))
    import json
    rec = json.loads(rec_path.read_text())
    rec["delegates"][-1]["t"] -= 180
    rec_path.write_text(json.dumps(rec))
    r.check(1, "min over its budget. Cancel it and record a timeout", through="plan")


def failure_needs_a_reason(r):
    r.reproduce()
    r.rr("delegate", "--job", "x", "--status", "launched", "--role", "w", "--model", "m")
    assert "needs --reason" in r.rr("delegate", "--job", "x", "--status", "failed", code=2)


def pause_leaves_a_resume_point(r):
    r.reproduce()
    r.rr("delegate", "--job", "implement", "--status", "launched", "--role", "pstack-worker", "--model", "deep")
    text = r.rr("pause", "--next", "step 3: record the implement delegate's outcome, then review its diff",
                "--reason", "operator stepped away")
    assert "still open: implement" in text, text
    r.check(1, "paused at seq", "still open", through="plan")
    text = r.rr("resume")
    assert "step 3: record the implement delegate" in text and "delegates open then: implement" in text, text
    r.rr("delegate", "--job", "implement", "--status", "cancelled", "--reason", "session ended")
    r.write("app.py", "def send():\n    return 1\n")
    r.rr("delegate", "--job", "implement", "--status", "returned", "--role", "pstack-worker", "--model", "deep")
    r.rr("phase", "implement", "--done")
    r.rr("phase", "cleanup", "--done")
    r.rr("phase", "review", "--skip", "no trigger")
    r.verify(); r.finish()
    r.check(0, "complete")


def every_playbook_route_takes_its_steps(r):
    r.rr("init", "--route", "feature", "--task", "add export")
    assert "step-8" in r.rr("phase", "step-8", "--skip", "no PR asked for")
    text = r.rr("phase", "step-9", "--done", code=2)
    assert "not a phase of feature" in text, text


def unknown_route_needs_phases(r):
    assert "no phases known for route" in r.rr("init", "--route", "nope", "--task", "t", code=2)
    r.rr("init", "--route", "figure-it-out", "--task", "t", "--phases", "survey,migrate,verify")
    r.rr("phase", "survey", "--done")


def session_id_is_recorded(r):
    import json
    subprocess.run([sys.executable, str(SCRIPT), "init", "--route", "investigation", "--task", "t"], cwd=r.root,
                   check=True, capture_output=True, env={**ENV, "CLAUDE_CODE_SESSION_ID": "sess-123"})
    rec = json.loads(next((r.root / ".pstack" / "runs").glob("*.json")).read_text())
    assert rec["session"] == {"host": "claude", "id": "sess-123"}, rec["session"]


def outputs_under_pstack(r):
    run = run_started(r.rr("init", "--route", "bug-fix", "--task", "t"))
    r.write("test_app.py", "assert False\n")
    r.git("add", "test_app.py")
    r.git("commit", "-qm", "test: failing repro")
    r.write("repro.txt", "AssertionError\n")
    text = r.rr("baseline", "--harness", "test_app.py", "--command", "c", "--output", str(r.root / "repro.txt"), code=2)
    assert f"inside the working tree" in text and f".pstack/runs/{run}/" in text, text
    (r.root / "repro.txt").unlink()
    keep = r.root / ".pstack" / "runs" / run
    keep.mkdir()
    (keep / "repro.txt").write_text("AssertionError\n")
    r.rr("baseline", "--harness", "test_app.py", "--command", "c", "--output", str(keep / "repro.txt"))
    r.rr("evidence", "--kind", "repro", "--result", "fail", "--output", str(keep / "repro.txt"))
    r.rr("phase", "reproduce", "--done")
    r.root_cause()
    r.rr("phase", "plan", "--skip", "fix stays inside one function")
    r.implement()
    (keep / "verify.txt").write_text("pass\n")
    r.rr("evidence", "--kind", "verify", "--result", "pass", "--output", str(keep / "verify.txt"))
    r.finish()
    r.check(0, "complete")
    r.write("app.py", "def send():\n    return 2\n")
    r.check(1, "verify: stale")


def root_cause_needs_confirmation(r):
    r.rr("init", "--route", "bug-fix", "--task", "t")
    r.rr("phase", "root-cause", "--done")
    r.check(1, "root-cause/confirm is not done in this attempt", through="root-cause")
    r.root_cause()
    text = r.rr("check", "--through", "root-cause", code=1)
    assert "root-cause/confirm" not in text and "phase reproduce: not recorded" in text, text


def parent_note_names_the_limitation(r):
    r.reproduce()
    r.write("app.py", "def send():\n    return 1\n")
    r.rr("phase", "implement", "--done", "--note", "parent: test")
    r.check(1, "no returned implementation delegate", 'note "parent: <the limitation>"', through="implement")
    r.rr("phase", "implement", "--start")
    r.rr("phase", "implement", "--done", "--note", "parent: host has no delegation tool")
    r.check(0, "complete through implement", through="implement")


def review_verdicts_follow_the_check_scope(r):
    r.rr("init", "--route", "feature", "--task", "t")
    r.rr("phase", "step-1", "--done")
    r.rr("phase", "step-2", "--skip", "no design boundary")
    r.rr("phase", "step-6", "--start")
    r.rr("evidence", "--kind", "review", "--result", "fail", "--phase", "step-6", "--output", r.output("rv.txt", "no"))
    r.check(0, "complete through step-2", through="step-2")
    r.check(1, "step-6: unresolved fail review verdict", through="step-6")


def failed_review_blocks_until_passed_or_skipped(r):
    r.reproduce(); r.implement()
    r.rr("phase", "review", "--start")
    r.rr("evidence", "--kind", "review", "--result", "fail", "--phase", "review", "--output", r.output("rv.txt", "no"))
    r.rr("phase", "review", "--done")
    r.check(1, "review: unresolved fail review verdict", through="review")
    r.rr("phase", "review", "--start")
    r.rr("evidence", "--kind", "review", "--result", "pass", "--phase", "review", "--output", r.output("rv2.txt", "ok"))
    r.rr("phase", "review", "--done")
    r.check(0, "complete through review", through="review")
    r.rr("phase", "review", "--start")
    r.rr("evidence", "--kind", "review", "--result", "fail", "--phase", "review", "--output", r.output("rv3.txt", "no"))
    r.rr("phase", "review", "--skip", "no durable state; the trigger does not apply")
    r.check(0, "complete through review", through="review")


def skip_only_with_its_phase(r):
    r.rr("init", "--route", "multi-phase-plan", "--task", "t")
    text = r.rr("phase", "step-6", "--skip", "no time", code=2)
    assert "skippable only after step-4 was skipped" in text, text
    for step in ("step-1", "step-2", "step-3", "step-4", "step-5", "step-6", "step-7"):
        if step == "step-1":
            r.rr("phase", step, "--start")
            r.rr("evidence", "--kind", "artifact", "--result", "pass", "--phase", step, "--output", r.output("s1.txt", "x"))
            r.rr("phase", step, "--done")
        else:
            r.rr("phase", step, "--skip", "small-change: one file with an obvious approach; no plan")
    r.check(0, "complete")


def reroute_closes_into_the_new_run(r):
    old = run_started(r.rr("init", "--route", "orchestrate", "--task", "fix the flaky test"))
    r.rr("phase", "step-1", "--done")
    text = r.rr("reroute", "--route", "autonomous-run", "--reason", "one agent can finish inside the budget")
    new = text.split("--run ")[-1].strip()
    assert "rerouted to autonomous-run" in text and new, text
    text = r.rr("--run", old, "check", code=1)
    assert "rerouted to autonomous-run run" in text and "phase step-1: not recorded" in text, text
    assert "rerouted" in r.rr("--run", old, "phase", "step-2", "--done", code=2)
    o = r.output("pred.txt", "predicate stated\n")
    for step in ("step-1", "step-2", "step-3", "step-4", "step-5", "step-6"):
        r.rr("--run", new, "phase", step, "--start")
        if step == "step-1":
            r.rr("--run", new, "evidence", "--kind", "artifact", "--result", "pass", "--phase", step, "--output", o)
        if step == "step-6":
            r.rr("--run", new, "evidence", "--kind", "verify", "--result", "pass", "--phase", step,
                 "--output", r.output("v.txt", "pass\n"))
        r.rr("--run", new, "phase", step, "--done")
    text = r.rr("--run", old, "check")
    assert "rerouted to autonomous-run" in text and "complete" in text, text


def pr_cleanup_precedes_commits(r):
    r.rr("init", "--route", "opening-a-pr", "--task", "t")
    r.rr("phase", "worktree", "--done")
    r.rr("phase", "commits", "--done")
    r.rr("phase", "cleanup", "--done")
    r.check(1, "phase commits: marked done before cleanup was recorded", through="commits")
    r.rr("phase", "commits", "--start")
    r.rr("phase", "commits", "--done")
    r.rr("phase", "reverify", "--start")
    r.rr("evidence", "--kind", "verify", "--result", "pass", "--phase", "reverify", "--output", r.output("v.txt", "pass\n"))
    r.rr("phase", "reverify", "--done")
    r.check(0, "complete through reverify", through="reverify")


def tracked_output_is_refused(r):
    r.rr("init", "--route", "bug-fix", "--task", "t")
    r.write("test_app.py", "assert False\n")
    r.git("add", "test_app.py")
    r.git("commit", "-qm", "test")
    text = r.rr("baseline", "--harness", "test_app.py", "--command", "c", "--output", str(r.root / "app.py"), code=2)
    assert "inside the working tree" in text, text
    r.rr("baseline", "--harness", "test_app.py", "--command", "c", "--output", r.output("b.txt", "x"))
    for name in ("app.py", "test_app.py"):
        text = r.rr("evidence", "--kind", "artifact", "--result", "pass", "--output", str(r.root / name), code=2)
        assert "inside the working tree" in text, text


def rebaseline_keeps_the_old_output_hash(r):
    r.rr("init", "--route", "bug-fix", "--task", "t")
    r.write("test_app.py", "assert False\n")
    r.git("add", "test_app.py")
    r.git("commit", "-qm", "test")
    o = r.output("b.txt", "first run\n")
    r.rr("baseline", "--harness", "test_app.py", "--command", "c", "--output", o)
    Path(o).write_text("rewritten\n")
    r.rr("baseline", "--harness", "test_app.py", "--command", "c", "--output", o)
    r.check(1, "evidence file changed after it was recorded", "b.txt", through="reproduce")


def old_format_record_is_checked(r):
    import json
    r.rr("init", "--route", "bug-fix", "--task", "t")
    r.root_cause()
    p = next((r.root / ".pstack" / "runs").glob("*.json"))
    rec = json.loads(p.read_text())
    for m in rec["phases"]:
        for k in ("instance", "parent_instance", "attempt", "agent", "excluded"):
            m.pop(k, None)
    rec["schema_version"] = 1
    p.write_text(json.dumps(rec))
    text = r.rr("check", "--through", "root-cause", code=1)
    assert "Traceback" not in text and "phase reproduce: not recorded" in text, text


def skipping_an_ungated_phase_keeps_its_failed_review(r):
    r.reproduce()
    r.rr("phase", "plan", "--start")
    r.rr("evidence", "--kind", "review", "--result", "fail", "--phase", "plan", "--output", r.output("rv.txt", "rejected"))
    r.rr("phase", "plan", "--skip", "fix stays inside one function")
    r.check(1, "plan: unresolved fail review verdict", through="plan")


def new_source_cannot_pass_as_output(r):
    r.reproduce(); r.implement(); r.verify()
    r.rr("phase", "verify", "--done")
    r.write("helper.py", "RETRIES = 0\n")
    text = r.rr("evidence", "--kind", "artifact", "--result", "pass", "--output", str(r.root / "helper.py"), code=2)
    assert "inside the working tree" in text, text
    r.check(1, "verify: stale", through="verify")


def nested_repo_without_a_commit(r):
    r.reproduce()
    (r.root / "vendor").mkdir()
    subprocess.run(["git", "init", "-q"], cwd=r.root / "vendor", check=True, capture_output=True, env=ENV)
    r.write("vendor/lib.py", "x = 1\n")
    r.implement(); r.verify()
    r.rr("phase", "verify", "--done")
    r.check(0, "complete through verify", through="verify")
    r.rr("status")
    r.write("vendor/lib.py", "x = 2\n")
    r.check(1, "verify: stale", through="verify")


def gc_changes_no_result(r):
    import json
    r.reproduce(); r.implement()
    r.write("scratch.txt", "untracked, so the fingerprint tree is no commit's tree\n")
    r.verify()
    r.rr("ground", "add", "--skill", "how", "--scope", "app.py", "--output", r.output("how.md", "model\n"))
    r.rr("phase", "verify", "--done")
    before = r.rr("check", "--through", "verify")
    rec = json.loads(next((r.root / ".pstack" / "runs").glob("*.json")).read_text())
    r.git("gc", "-q", "--prune=now")
    gone = subprocess.run(["git", "cat-file", "-e", rec["evidence"][-1]["tree"]], cwd=r.root, env=ENV)
    assert gone.returncode != 0, "gc kept the stamped tree, so this case proves nothing"
    assert r.rr("check", "--through", "verify") == before
    assert "reusable" in r.rr("ground", "check", "--scope", "app.py")


def skip_reason_must_name_the_mode(r):
    import json
    r.rr("init", "--route", "babysit", "--task", "t")
    text = r.rr("phase", "step-6", "--skip", "drive mode needs no watcher", code=2)
    assert "reason starting with: threads-only" in text, text
    r.rr("phase", "step-6", "--skip", "threads-only: answered the review threads")
    p = next((r.root / ".pstack" / "runs").glob("*.json"))
    rec = json.loads(p.read_text())
    rec["phases"][-1]["note"] = "drive"
    p.write_text(json.dumps(rec))
    r.check(1, "phase step-6: skipped for a reason its gate does not accept", through="step-6")


def changed_phase_list_says_why(r):
    import json
    r.rr("init", "--route", "opening-a-pr", "--task", "t")
    p = next((r.root / ".pstack" / "runs").glob("*.json"))
    rec = json.loads(p.read_text())
    rec["phases_required"] = ["worktree", "commits", "cleanup", "reverify", "write", "create", "readiness"]
    p.write_text(json.dumps(rec))
    r.check(1, "required phases differ", "its phases changed after this record started", "Start a new run")


def without_git_outputs_stay_out_of_the_tree(r):
    import shutil
    shutil.rmtree(r.root / ".git")
    r.rr("init", "--route", "investigation", "--task", "t")
    r.rr("ground", "add", "--skill", "how", "--scope", ".", "--output", r.output("how.md", "model\n"))
    r.write("verify.txt", "pass\n")
    text = r.rr("evidence", "--kind", "artifact", "--result", "pass", "--output", str(r.root / "verify.txt"), code=2)
    assert "inside the working tree" in text, text
    (r.root / "verify.txt").unlink()
    kept = r.root / ".pstack" / "runs" / "keep"
    kept.mkdir(parents=True)
    (kept / "verify.txt").write_text("pass\n")
    r.rr("evidence", "--kind", "artifact", "--result", "pass", "--output", str(kept / "verify.txt"))
    assert "reusable" in r.rr("ground", "check", "--scope", ".")


def reroute_keeps_its_obligations(r):
    r.rr("init", "--route", "bug-fix", "--task", "t")
    assert "reroutes only to: no other playbook" in r.rr("reroute", "--route", "prototype", "--reason", "smaller", code=2)
    r.rr("init", "--route", "orchestrate", "--task", "t")
    assert "needs a reason" in r.rr("reroute", "--route", "autonomous-run", "--reason", "   ", code=2)
    assert "reroutes only to: autonomous-run" in r.rr("reroute", "--route", "prototype", "--reason", "smaller", code=2)
    r.rr("finding", "add", "--id", "B1", "--source", "self", "--severity", "blocker", "--summary", "data loss")
    assert "resolve open findings first: B1" in r.rr("reroute", "--route", "autonomous-run", "--reason", "smaller", code=2)
    r.rr("finding", "resolve", "--id", "B1", "--status", "fixed", "--reason", "restored")
    r.rr("phase", "step-1", "--start")
    r.rr("phase", "step-1", "--fail", "no countable predicate")
    assert "phase step-1 is failed" in r.rr("reroute", "--route", "autonomous-run", "--reason", "smaller", code=2)


def reroute_moves_only_its_own_pointer(r):
    a = run_started(r.rr("init", "--route", "orchestrate", "--task", "a"))
    b = run_started(r.rr("init", "--route", "feature", "--task", "b"))
    r.rr("--run", a, "reroute", "--route", "autonomous-run", "--reason", "one agent suffices")
    assert (r.root / ".pstack" / "runs" / "current").read_text().strip() == b


def rerouted_run_reports_the_new_one(r):
    old = run_started(r.rr("init", "--route", "orchestrate", "--task", "t"))
    r.rr("phase", "step-1", "--start")
    o = r.output("frame.md", "predicate\n")
    r.rr("evidence", "--kind", "artifact", "--result", "pass", "--phase", "step-1", "--output", o)
    r.rr("phase", "step-1", "--done")
    new = r.rr("reroute", "--route", "autonomous-run", "--reason", "one agent suffices").split("--run ")[-1].strip()
    text = r.rr("--run", old, "check", "--through", "step-1", code=1)
    assert f"run {new}: phase step-1: not recorded" in text and "step-2" not in text, text
    assert f"--run {new} tasks" in r.rr("--run", old, "tasks")
    Path(o).write_text("rewritten\n")
    assert "evidence file changed" in r.rr("--run", old, "check", code=1)
    (r.root / ".pstack" / "runs" / f"{new}.json").write_text("{")
    assert "cannot read that record" in r.rr("--run", old, "check", code=1)
    assert "is not valid JSON" in r.rr("--run", new, "status", code=2)


def contract_validation_rejects_bad_gates(r):
    import importlib.util
    build = Path(__file__).resolve().parent.parent
    sys.path.insert(0, str(build))
    spec = importlib.util.spec_from_file_location("gen_routes", build / "gen-routes.py")
    gen = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gen)
    graph = {"phases": [{"id": "a"}, {"id": "b"}], "steps": [{"id": "a/x", "parent": "a"}]}
    names = {"r", "other"}
    good = {"ordered": False, "reroute_to": ["other"],
            "gates": {"a": {"steps": ["a/x"]}, "b": {"evidence": "verify", "skip": True, "skip_with": "a"}}}
    assert gen.contract_problems("r", good, graph, names) == []
    assert gen.contract_problems("r", {"gates": {"b": {"skip": True, "skip_reasons": ["threads-only"]}}}, graph, names) == []
    for bad in ({"gates": {"b": {"skip_reasons": ["threads-only"]}}}, {"gates": {"b": {"skip": True, "skip_reasons": []}}},
                {"gates": {"b": {"skip": True, "skip_reasons": ["two words"]}}},
                {"gates": {"b": {"skip": True, "skip_with": "b"}}}, {"gates": {"b": {"skip_with": "a"}}},
                {"gates": {"b": {"steps": ["a/x"]}}}, {"gates": {"a": {"evidnce": "verify"}}},
                {"gates": {"a": {"evidence": "proof"}}}, {"gates": {"c": {}}}, {"gates": {}, "reroute_to": ["r"]},
                {"gates": {}, "reorder": True}, {"run": "no", "gates": {}},
                {"run": False, "gates": {"a": {"evidence": "artifact"}}}):
        assert gen.contract_problems("r", bad, graph, names), bad
    assert gen.contract_problems("r", {"run": False, "gates": {}}, graph, names) == []
    assert gen.contract_problems("r", {"gates": {}, "reroute_to": ["other"]}, graph, names, {"other"})


def load_recorder():
    import importlib.util
    # In-process git calls read the environment, so give them the same isolated config.
    os.environ.update({k: v for k, v in ENV.items() if k.startswith("GIT_")})
    spec = importlib.util.spec_from_file_location("run_record_under_test", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def git_in(path, *args):
    subprocess.run(["git", "-c", "protocol.file.allow=always", *args], cwd=path, check=True, capture_output=True, env=ENV)


def mkrepo(path, files, commit=True):
    path.mkdir(parents=True, exist_ok=True)
    git_in(path, "init", "-q")
    for name, text in files.items():
        (path / name).parent.mkdir(parents=True, exist_ok=True)
        (path / name).write_text(text)
    if commit:
        git_in(path, "add", "-A")
        git_in(path, "commit", "-qm", "c")
    return path


def head_tree_of(path):
    return subprocess.run(["git", "rev-parse", "HEAD^{tree}"], cwd=path, capture_output=True, text=True,
                          env=ENV).stdout.strip()


def index_flag_deletions_count(r):
    mod = load_recorder()
    for flag in ("--assume-unchanged", "--skip-worktree"):
        repo = mkrepo(r.root.parent / flag.strip("-"), {"app.py": "x\n", "b.py": "y\n"})
        git_in(repo, "update-index", flag, "app.py")
        before = mod.fingerprint(repo)
        (repo / "app.py").unlink()
        assert mod.fingerprint(repo) != before, f"deleting a {flag} file went unseen"


def gitlink_without_a_repository_counts_by_content(r):
    import shutil
    mod = load_recorder()
    outer = mkrepo(r.root.parent / "outer", {"app.py": "1\n"})
    mkrepo(outer / "vendor", {"lib.py": "1\n"})
    git_in(outer, "add", "-A")
    git_in(outer, "commit", "-qm", "gitlink")
    before = mod.fingerprint(outer)
    (outer / "vendor" / "lib.py").write_text("2\n")
    shutil.rmtree(outer / "vendor" / ".git")
    assert mod.fingerprint(outer) != before, "an edit under a gitlink with its .git removed went unseen"
    src = mkrepo(r.root.parent / "src", {"lib.py": "1\n"})
    host = mkrepo(r.root.parent / "host", {"app.py": "1\n"})
    git_in(host, "submodule", "add", "-q", str(src), "lib")
    git_in(host, "commit", "-qm", "sub")
    git_in(host, "submodule", "deinit", "-q", "-f", "lib")
    clean = mod.fingerprint(host)
    assert clean == head_tree_of(host), "an empty deinitialised submodule must still match its commit"
    (host / "lib" / "evil.py").write_text("import os\n")
    assert mod.fingerprint(host) != clean, "a file written into a deinitialised submodule went unseen"


def nested_worktree_setting_is_ignored(r):
    import shutil
    mod = load_recorder()
    outer = mkrepo(r.root.parent / "outer", {"app.py": "1\n"})
    vendor = mkrepo(outer / "vendor", {"lib.py": "1\n"})
    elsewhere = r.root.parent / "elsewhere"
    shutil.copytree(vendor, elsewhere, ignore=shutil.ignore_patterns(".git"))
    git_in(vendor, "config", "core.worktree", str(elsewhere))
    before = mod.fingerprint(outer)
    (vendor / "lib.py").write_text("2\n")
    assert mod.fingerprint(outer) != before, "the nested repository's own files were not fingerprinted"


def sparse_checkout_paths_count(r):
    for name in ("a/x.py", "b/y.py"):
        (r.root / name).parent.mkdir(exist_ok=True)
        r.write(name, "1\n")
    r.git("add", "-A")
    r.git("commit", "-qm", "ab")
    r.git("sparse-checkout", "set", "--cone", "--sparse-index", "a")
    r.reproduce(); r.implement(); r.verify()
    r.rr("phase", "verify", "--done")
    r.check(0, "complete through verify", through="verify")
    (r.root / "c").mkdir()
    r.write("c/z.py", "new, outside the cone\n")
    r.check(1, "verify: stale", through="verify")
    (r.root / "c" / "z.py").unlink()
    r.check(0, "complete through verify", through="verify")
    (r.root / "b").mkdir(exist_ok=True)
    r.write("b/y.py", "tracked, outside the cone, rewritten\n")
    r.check(1, "verify: stale", through="verify")


def ground_scope_inside_a_nested_repository(r):
    src = mkrepo(r.root.parent / "subsrc", {"lib.py": "1\n"})
    git_in(r.root, "submodule", "add", "-q", str(src), "lib")
    r.git("commit", "-qm", "sub")
    mkrepo(r.root / "vendor", {"v.py": "1\n"})
    r.rr("init", "--route", "investigation", "--task", "t")
    scopes = ("lib/lib.py", "lib/new.py", "vendor/v.py", "vendor/new.py")
    for scope in scopes:
        r.rr("ground", "add", "--skill", "how", "--scope", scope, "--output", r.output(scope.replace("/", "-"), "m\n"))
        assert "reusable" in r.rr("ground", "check", "--scope", scope)
    (r.root / "lib" / "lib.py").write_text("2\n")
    (r.root / "vendor" / "new.py").write_text("new\n")
    for scope in scopes:
        assert "changed since" in r.rr("ground", "check", "--scope", scope, code=1), scope


def malformed_entries_are_reported(r):
    import json
    r.rr("init", "--route", "investigation", "--task", "t")
    p = next((r.root / ".pstack" / "runs").glob("*.json"))
    rec = json.loads(p.read_text())
    for mutation in ({"evidence": [{}]}, {"baseline": "x"}, {"phases": [1]}, {"findings": [{}]}, {"pauses": "x"},
                     {"rerouted": {"run": None, "route": "x", "reason": "y"}}, {"graph": {"phases": [{}]}}):
        p.write_text(json.dumps({**rec, **mutation}))
        for cmd in ("check", "status"):
            text = r.rr(cmd, code=2)
            assert "is not a run record" in text and "Traceback" not in text, (mutation, text)


def unexpected_errors_exit_cleanly(r):
    mod = load_recorder()
    r.rr("init", "--route", "investigation", "--task", "t")

    def broken(a, root, rec):
        raise KeyError("surprise")

    mod.COMMANDS["status"] = broken
    cwd = os.getcwd()
    os.chdir(r.root)
    try:
        assert mod.main(["status"]) == 2
    finally:
        os.chdir(cwd)


def nested_committed_repo_counts_by_content(r):
    r.reproduce()
    vendor = r.root / "vendor"
    vendor.mkdir()
    r.write("vendor/lib.py", "x = 1\n")
    for args in (["init", "-q"], ["add", "-A"], ["commit", "-qm", "v"]):
        subprocess.run(["git", *args], cwd=vendor, check=True, capture_output=True, env=ENV)
    r.rr("ground", "add", "--skill", "how", "--scope", "vendor", "--output", r.output("how.md", "model\n"))
    r.implement(); r.verify()
    r.rr("phase", "verify", "--done")
    r.check(0, "complete through verify", through="verify")
    r.write("vendor/lib.py", "x = 2  # uncommitted\n")
    r.check(1, "verify: stale", through="verify")
    assert "changed since" in r.rr("ground", "check", "--scope", "vendor", code=1)


def registered_submodule_counts_by_content(r):
    src = r.root.parent / "subsrc"
    src.mkdir()
    (src / "lib.py").write_text("x = 1\n")
    for args in (["init", "-q"], ["add", "-A"], ["commit", "-qm", "s"]):
        subprocess.run(["git", *args], cwd=src, check=True, capture_output=True, env=ENV)
    subprocess.run(["git", "-c", "protocol.file.allow=always", "submodule", "add", "-q", str(src), "lib"],
                   cwd=r.root, check=True, capture_output=True, env=ENV)
    r.git("commit", "-qm", "add submodule")
    r.reproduce()
    r.rr("ground", "add", "--skill", "how", "--scope", "lib", "--output", r.output("how.md", "model\n"))
    r.implement(); r.verify()
    r.rr("phase", "verify", "--done")
    r.check(0, "complete through verify", through="verify")
    (r.root / "lib" / "lib.py").write_text("x = 2  # uncommitted\n")
    r.check(1, "verify: stale", through="verify")
    assert "changed since" in r.rr("ground", "check", "--scope", "lib/lib.py", code=1)


def index_flags_do_not_hide_edits(r):
    r.reproduce(); r.implement(); r.verify()
    r.rr("phase", "verify", "--done")
    r.git("add", "app.py")
    r.git("update-index", "--assume-unchanged", "app.py")
    r.check(0, "complete through verify", through="verify")
    r.write("app.py", "def send():\n    return 7\n")
    r.check(1, "verify: stale", through="verify")
    r.git("update-index", "--no-assume-unchanged", "app.py")
    r.git("update-index", "--skip-worktree", "app.py")
    r.check(1, "verify: stale", through="verify")


def reroute_waits_for_a_failed_delegate(r):
    r.rr("init", "--route", "orchestrate", "--task", "t")
    r.rr("delegate", "--job", "scout", "--status", "launched", "--role", "w", "--model", "m")
    r.rr("delegate", "--job", "scout", "--status", "failed", "--reason", "crashed")
    r.rr("phase", "step-1", "--done")
    text = r.rr("reroute", "--route", "autonomous-run", "--reason", "one agent suffices", code=2)
    assert "retry or drop failed delegates first: scout" in text, text
    r.rr("delegate", "--job", "scout", "--status", "dropped", "--reason", "one agent needs no scout")
    r.rr("reroute", "--route", "autonomous-run", "--reason", "one agent suffices")


def broken_records_are_reported(r):
    import json
    old = run_started(r.rr("init", "--route", "orchestrate", "--task", "t"))
    new = r.rr("reroute", "--route", "autonomous-run", "--reason", "one agent suffices").split("--run ")[-1].strip()
    runs = r.root / ".pstack" / "runs"
    for bad in ("{}", "[]"):
        (runs / f"{new}.json").write_text(bad)
        text = r.rr("--run", old, "check", code=1)
        assert "cannot read that record" in text and "Traceback" not in text, text
        text = r.rr("--run", new, "status", code=2)
        assert "is not a run record" in text and "Traceback" not in text, text
    rec = json.loads((runs / f"{old}.json").read_text())
    (runs / f"{new}.json").write_text(json.dumps({**rec, "run": new, "rerouted": {**rec["rerouted"], "run": old}}))
    text = r.rr("--run", old, "check", code=1)
    assert "reroute cycle" in text and "Traceback" not in text, text


def unreadable_output_is_reported(r):
    if hasattr(os, "geteuid") and os.geteuid() == 0:
        return  # root reads a mode-0 file, so this case cannot arise
    r.rr("init", "--route", "investigation", "--task", "t")
    o = r.output("secret.txt", "x\n")
    os.chmod(o, 0)
    try:
        text = r.rr("evidence", "--kind", "artifact", "--result", "pass", "--output", o, code=2)
        assert "cannot read output file" in text and "Traceback" not in text, text
        os.chmod(o, 0o644)
        r.rr("evidence", "--kind", "artifact", "--result", "pass", "--output", o)
        os.chmod(o, 0)
        text = r.rr("check", code=1)
        assert "evidence file unreadable" in text and "Traceback" not in text, text
    finally:
        os.chmod(o, 0o644)


def ground_scope_outside_is_refused(r):
    r.rr("init", "--route", "investigation", "--task", "t")
    sib = r.root.parent / "sib.py"
    sib.write_text("1\n")
    for scope in (str(sib), ".git/config", ".pstack/runs"):
        for action in (["add", "--skill", "how", "--scope", scope, "--output", r.output("how.md", "m\n")],
                       ["check", "--scope", scope]):
            text = r.rr("ground", *action, code=2)
            assert "outside the workspace, or in .git or .pstack" in text, text


def relpath_across_drives_is_outside(r):
    mod = load_recorder()
    real = mod.os.path.relpath

    def other_drive(*args):
        raise ValueError("path is on mount 'D:', start on mount 'C:'")

    mod.os.path.relpath = other_drive
    try:
        assert mod.outside(mod.relpath(r.root, r.out / "x.txt"))
    finally:
        mod.os.path.relpath = real


def output_rule_follows_the_directory_not_its_spelling(r):
    mod = load_recorder()
    alias = r.root.parent / "alias"
    alias.symlink_to(r.root)
    (r.root / ".pstack" / "runs").mkdir(parents=True)
    rec = {"run": "x"}
    try:
        mod.checked_output(alias, rec, str(r.root / "notes.txt"))
        raise AssertionError("an in-tree output passed under another spelling of the root")
    except mod.Fail as e:
        assert "inside the working tree" in str(e), e
    assert mod.checked_output(alias, rec, str(r.root / ".pstack" / "runs" / "o.txt"))
    assert mod.checked_output(alias, rec, str(r.out / "o.txt"))


def skip_reason_case_and_punctuation(r):
    for reason, code in (("Threads-only: answered the threads", 0), ("(threads-only) answered", 0),
                         ("THREADS-ONLY", 0), ("threads_only", 2), ("drive", 2)):
        r.rr("init", "--route", "babysit", "--task", "t")
        r.rr("phase", "step-6", "--skip", reason, code=code)


def paused_run_refuses_phases_until_resumed(r):
    import json
    r.reproduce()
    r.rr("phase", "implement", "--start")
    r.rr("phase", "implement", "--block", "paused: operator stepped away")
    r.rr("pause", "--next", "resume implement from the blocked attempt")
    assert "paused" in r.rr("phase", "implement", "--start", code=2)
    r.check(1, "paused at seq", "resume implement from the blocked attempt", through="plan")
    r.rr("resume")
    r.rr("phase", "implement", "--start")
    rec = json.loads(next((r.root / ".pstack" / "runs").glob("*.json")).read_text())
    assert rec["phases"][-1]["instance"] == "implement@1", rec["phases"][-1]


def run_follows_its_workspace_into_a_worktree(r):
    run = run_started(r.rr("init", "--route", "bug-fix", "--task", "t"))
    wt = r.root.parent / "wt"
    r.git("worktree", "add", "-q", str(wt), "-b", "fix")

    def rw(*args, code=0):
        return r.rr("--run", run, *args, code=code, cwd=wt)

    assert "workspace --path" in rw("phase", "reproduce", "--start", code=2)
    rw("workspace", "--path", ".")
    assert "workspace --path" in r.rr("--run", run, "phase", "reproduce", "--start", code=2)
    (wt / "test_app.py").write_text("assert False\n")
    git_in(wt, "add", "test_app.py")
    git_in(wt, "commit", "-qm", "test: failing repro")
    o = r.output("repro.txt", "AssertionError\n")
    rw("baseline", "--harness", "test_app.py", "--command", "c", "--output", o)
    rw("evidence", "--kind", "repro", "--result", "fail", "--output", o)
    rw("phase", "reproduce", "--done")
    rw("phase", "root-cause", "--start")
    rw("phase", "root-cause/confirm", "--done")
    rw("phase", "root-cause", "--done")
    rw("phase", "plan", "--skip", "fix stays inside one function")
    (wt / "app.py").write_text("def send():\n    return 1\n")
    rw("delegate", "--role", "pstack-worker", "--model", "deep", "--job", "implement")
    rw("phase", "implement", "--done")
    rw("phase", "cleanup", "--done")
    rw("phase", "review", "--skip", "no durable state")
    rw("evidence", "--kind", "verify", "--result", "pass", "--output", r.output("v.txt", "pass\n"))
    rw("phase", "verify", "--done")
    assert "complete through verify" in rw("check", "--through", "verify")
    assert "complete through verify" in r.rr("--run", run, "check", "--through", "verify")
    (wt / "app.py").write_text("def send():\n    return 2\n")
    assert "verify: stale" in r.rr("--run", run, "check", "--through", "verify", code=1)
    assert "already holds evidence" in rw("workspace", "--path", str(r.root), code=2)


def committing_inside_a_submodule_keeps_evidence_fresh(r):
    src = mkrepo(r.root.parent / "subsrc", {"lib.py": "1\n"})
    git_in(r.root, "submodule", "add", "-q", str(src), "lib")
    r.git("commit", "-qm", "add submodule")
    r.reproduce()
    (r.root / "lib" / "lib.py").write_text("2\n")
    r.implement(); r.verify()
    r.rr("phase", "verify", "--done")
    r.check(0, "complete through verify", through="verify")
    git_in(r.root / "lib", "commit", "-qam", "fix inside the submodule")
    r.check(0, "complete through verify", through="verify")
    r.git("add", "lib", "app.py")
    r.git("commit", "-qm", "record the submodule bump")
    r.check(0, "complete through verify", through="verify")
    (r.root / "lib" / "lib.py").write_text("3\n")
    r.check(1, "verify: stale", through="verify")


def works_without_a_git_binary(r):
    import shutil
    shutil.rmtree(r.root / ".git")
    env = {**ENV, "PATH": str(r.root.parent / "no-bin")}

    def rr(*args, code):
        p = subprocess.run([sys.executable, str(SCRIPT), *args], cwd=r.root, capture_output=True, text=True, env=env)
        text = p.stdout + p.stderr
        assert p.returncode == code and "unexpected" not in text, (args, p.returncode, text)
        return text

    rr("init", "--route", "investigation", "--task", "t", code=0)
    rr("phase", "step-1", "--done", code=0)
    assert "phase step-2: not recorded" in rr("check", code=1)


def closed_stdout_keeps_the_exit_code(r):
    r.rr("init", "--route", "investigation", "--task", "t")
    read, write = os.pipe()
    os.close(read)
    p = subprocess.run([sys.executable, str(SCRIPT), "check"], cwd=r.root, stdout=write, stderr=subprocess.PIPE,
                       text=True, env=ENV)
    os.close(write)
    assert p.returncode == 1 and "Traceback" not in p.stderr, (p.returncode, p.stderr)


def worktree_run(r, route="bug-fix", branch="fix"):
    run = run_started(r.rr("init", "--route", route, "--task", "t"))
    wt = r.root.parent / branch
    r.git("worktree", "add", "-q", str(wt), "-b", branch)
    r.rr("--run", run, "workspace", "--path", ".", cwd=wt)
    return run, wt


def delegate_cannot_take_over_the_run(r):
    run, wt = worktree_run(r, "feature", "feat")
    for step in ("step-1", "step-2", "step-3"):
        r.rr("--run", run, "phase", step, "--done", cwd=wt)
    r.rr("--run", run, "phase", "step-4", "--start", cwd=wt)
    r.rr("--run", run, "delegate", "--job", "impl", "--status", "launched", "--role", "w", "--model", "fast",
         "--phase", "step-4", cwd=wt)
    sub = r.root.parent / "sub"
    r.git("worktree", "add", "-q", str(sub), "-b", "sub")
    text = r.rr("--run", run, "evidence", "--kind", "verify", "--result", "pass", "--output", r.output("v.txt", "p\n"),
                code=2, cwd=sub)
    assert "records nothing: return your output paths to the parent" in text, text
    assert "a delegate attempt is open" in r.rr("--run", run, "workspace", "--path", ".", code=2, cwd=sub)
    r.rr("--run", run, "delegate", "--job", "impl", "--status", "returned", cwd=wt)
    assert "already moved" in r.rr("--run", run, "workspace", "--path", ".", code=2, cwd=sub)
    r.rr("--run", run, "workspace", "--path", str(r.root), cwd=wt)
    r.rr("--run", run, "phase", "step-4", "--done", "--note", "parent: moved back before any evidence")


def record_outlives_its_worktree(r):
    import json
    wt = r.root.parent / "wt"
    r.git("worktree", "add", "-q", str(wt), "-b", "fix")
    run = run_started(r.rr("init", "--route", "investigation", "--task", "t", cwd=wt))
    assert (r.root / ".pstack" / "runs" / f"{run}.json").is_file(), "the record should live in the main checkout"
    r.rr("--run", run, "phase", "step-1", "--done", cwd=wt)
    a = r.root.parent / "a"
    r.git("worktree", "add", "-q", str(a), "-b", "a")
    other = run_started(r.rr("init", "--route", "investigation", "--task", "t", cwd=a))
    b = r.root.parent / "b"
    r.git("worktree", "add", "-q", str(b), "-b", "b")
    r.rr("--run", other, "workspace", "--path", ".", cwd=b)
    r.git("worktree", "remove", "--force", str(a))
    r.rr("--run", other, "phase", "step-1", "--done", cwd=b)
    r.git("worktree", "remove", "--force", str(wt))
    text = r.rr("--run", run, "check", code=1)
    assert "was removed" in text and "cannot be checked complete" in text, text
    assert "was removed" in r.rr("--run", run, "status")
    assert "was removed" in r.rr("--run", run, "phase", "step-2", "--done", code=2)
    rec = json.loads((r.root / ".pstack" / "runs" / f"{run}.json").read_text())
    assert rec["phases"][-1]["name"] == "step-1"


def worktree_move_keeps_the_workspace(r):
    run, wt = worktree_run(r)
    moved = r.root.parent / "fix-moved"
    r.git("worktree", "move", str(wt), str(moved))
    r.rr("--run", run, "phase", "reproduce", "--start", cwd=moved)
    assert "was removed" not in r.rr("--run", run, "check", code=1)


def reroute_keeps_the_moved_workspace(r):
    import json
    run, wt = worktree_run(r, "orchestrate", "orch")
    r.rr("--run", run, "phase", "step-1", "--start", cwd=wt)
    new = r.rr("--run", run, "reroute", "--route", "autonomous-run", "--reason", "one unit", cwd=wt).split("--run ")[-1].strip()
    rec = json.loads((r.root / ".pstack" / "runs" / f"{new}.json").read_text())
    assert rec["workspace"]["moved"] and Path(rec["workspace"]["path"]) == wt.resolve(), rec["workspace"]
    assert (wt / ".pstack" / "runs" / "current").read_text().strip() == new
    assert "workspace --path" in r.rr("--run", new, "phase", "step-1", "--start", code=2)


def nested_worktrees_are_left_out(r):
    r.reproduce(); r.implement(); r.verify()
    r.rr("phase", "verify", "--done")
    r.check(0, "complete through verify", through="verify")
    nested = r.root / ".claude" / "worktrees" / "agent-1"
    r.git("worktree", "add", "-q", str(nested), "-b", "agent-1")
    r.check(0, "complete through verify", through="verify")
    (nested / "app.py").write_text("def send():\n    return 99\n")
    r.check(0, "complete through verify", through="verify")


def worktree_paths_parse_exactly(r):
    mod = load_recorder()
    odd = r.root.parent / "odd\nname"
    r.git("worktree", "add", "-q", str(odd), "-b", "odd")
    listed = [p.resolve() for p in mod.worktrees(r.root)]
    assert odd.resolve() in listed or mod.git_version() < (2, 36), listed


def prunable_worktree_path_counts(r):
    import shutil
    r.reproduce(); r.implement(); r.verify()
    r.rr("phase", "verify", "--done")
    nested = r.root / "agent"
    r.git("worktree", "add", "-q", str(nested), "-b", "agent")
    shutil.rmtree(nested)
    r.check(0, "complete through verify", through="verify")
    nested.mkdir()
    (nested / "hook.py").write_text("import app\n")
    r.check(1, "verify: stale", through="verify")


def submodule_keeps_its_own_records(r):
    import shutil
    src = mkrepo(r.root.parent / "subsrc", {"lib.py": "1\n"})
    git_in(r.root, "submodule", "add", "-q", str(src), "lib")
    r.git("commit", "-qm", "add submodule")
    run = run_started(r.rr("init", "--route", "investigation", "--task", "t", cwd=r.root / "lib"))
    assert (r.root / "lib" / ".pstack" / "runs" / f"{run}.json").is_file(), "the record belongs to the submodule checkout"
    moved = r.root.parent / "renamed"
    shutil.move(str(r.root), str(moved))
    text = r.rr("--run", run, "check", code=1, cwd=moved / "lib")
    assert "was removed" not in text and "phase step-1: not recorded" in text, text
    r.root = moved


def relative_worktree_gitdir_follows_a_move(r):
    mod = load_recorder()
    if mod.git_version() < (2, 48):
        return  # worktree.useRelativePaths arrived in Git 2.48
    r.git("config", "worktree.useRelativePaths", "true")
    run, wt = worktree_run(r)
    moved = r.root.parent / "fix-moved"
    r.git("worktree", "move", str(wt), str(moved))
    r.rr("--run", run, "phase", "reproduce", "--start", cwd=moved)
    assert "was removed" not in r.rr("--run", run, "status")


def unwritable_main_checkout(r):
    if hasattr(os, "geteuid") and os.geteuid() == 0:
        return  # root writes anywhere, so this case cannot arise
    wt = r.root.parent / "wt"
    r.git("worktree", "add", "-q", str(wt), "-b", "fix")
    os.chmod(r.root, 0o555)
    try:
        text = r.rr("init", "--route", "investigation", "--task", "t", cwd=wt)
        assert "stays in" in text and "Traceback" not in text, text
        assert (wt / ".pstack" / "runs").is_dir(), text
    finally:
        os.chmod(r.root, 0o755)
    other = run_started(r.rr("init", "--route", "investigation", "--task", "t"))
    runs = r.root / ".pstack" / "runs"
    os.chmod(runs, 0o555)
    try:
        r.rr("--run", other, "check", code=1)
        text = r.rr("--run", other, "phase", "step-1", "--done", code=2)
        assert "cannot write run records" in text and "unexpected" not in text, text
        assert "phase step-1: done" not in text, "an unsaved change was reported as recorded"
    finally:
        os.chmod(runs, 0o755)


def pause_safely_starts_no_run(r):
    import json
    text = r.rr("init", "--route", "pause-safely", "--task", "stop for the night", code=2)
    assert "starts no run of its own" in text and "pause --next" in text, text
    assert not list((r.root / ".pstack" / "runs").glob("*.json")), "a refused init must write no record"
    route = json.loads(SCRIPT.with_name("routes.json").read_text())["pause-safely"]
    assert route["contract"]["run"] is False and not route["contract"]["gates"], route["contract"]
    assert route["phases"] and route["checklist"], "pstack serve still maps the playbook"


def unwritable_existing_runs_dir_falls_back(r):
    if hasattr(os, "geteuid") and os.geteuid() == 0:
        return  # root writes anywhere, so this case cannot arise
    r.rr("init", "--route", "investigation", "--task", "first, in main")
    wt = r.root.parent / "wt"
    r.git("worktree", "add", "-q", str(wt), "-b", "fix")
    runs = r.root / ".pstack" / "runs"
    os.chmod(runs, 0o555)
    try:
        text = r.rr("init", "--route", "investigation", "--task", "t", cwd=wt)
        assert "stays in" in text and "Traceback" not in text, text
        run = run_started(text)
        assert (wt / ".pstack" / "runs" / f"{run}.json").is_file(), text
    finally:
        os.chmod(runs, 0o755)


def run_ids_stay_unique_across_checkouts(r):
    if hasattr(os, "geteuid") and os.geteuid() == 0:
        return  # root writes anywhere, so the fallback that makes the duplicate cannot arise
    r.rr("init", "--route", "investigation", "--task", "creates main's runs")
    a, b = r.root.parent / "a", r.root.parent / "b"
    r.git("worktree", "add", "-q", str(a), "-b", "a")
    r.git("worktree", "add", "-q", str(b), "-b", "b")
    runs = r.root / ".pstack" / "runs"
    os.chmod(runs, 0o555)
    try:
        r.rr("--run", "DUP", "init", "--route", "investigation", "--task", "t", cwd=a)
    finally:
        os.chmod(runs, 0o755)
    text = r.rr("--run", "DUP", "init", "--route", "investigation", "--task", "t", code=2, cwd=b)
    assert "run DUP already exists" in text, text
    assert not (runs / "DUP.json").exists() and not (b / ".pstack" / "runs" / "DUP.json").exists()


def foreign_repo_at_a_stale_worktree_path(r):
    import shutil
    mod = load_recorder()
    wc = r.root.parent / "wc"
    r.git("worktree", "add", "-q", str(wc), "-b", "wc")
    shutil.rmtree(wc)
    mkrepo(wc, {"other.py": "1\n"})
    foreign = run_started(r.rr("init", "--route", "investigation", "--task", "not ours", cwd=wc))
    assert "no run named" in r.rr("--run", foreign, "status", code=2)
    assert wc / ".pstack" / "runs" not in mod.record_dirs(r.root), mod.record_dirs(r.root)


def failed_reroute_leaves_no_orphan(r):
    import json
    old = run_started(r.rr("init", "--route", "orchestrate", "--task", "t"))
    runs = r.root / ".pstack" / "runs"
    (runs / f"{old}.tmp").mkdir()
    text = r.rr("reroute", "--route", "autonomous-run", "--reason", "one agent suffices", code=2)
    assert "cannot write run records" in text, text
    assert not list(runs.glob("*autonomous-run*.json")), list(runs.glob("*.json"))
    assert "rerouted" not in json.loads((runs / f"{old}.json").read_text())
    (runs / f"{old}.tmp").rmdir()
    r.rr("reroute", "--route", "autonomous-run", "--reason", "one agent suffices")
    assert len(list(runs.glob("*autonomous-run*.json"))) == 1


def deleted_main_checkout_is_named(r):
    import shutil
    base = r.root.parent
    git_in(base, "init", "-q", "--separate-git-dir", str(base / "repo.git"), str(base / "m"))
    (base / "m" / "app.py").write_text("x = 1\n")
    git_in(base / "m", "add", "-A")
    git_in(base / "m", "commit", "-qm", "c")
    git_in(base / "m", "worktree", "add", "-q", str(base / "w"), "-b", "w")
    shutil.rmtree(base / "m")
    text = r.rr("init", "--route", "investigation", "--task", "t", cwd=base / "w")
    assert "is gone" in text and "stays in" in text, text
    assert list((base / "w" / ".pstack" / "runs").glob("*.json")), text


def eval_at_tier_zero_closes_with_a_parent_note(r):
    r.rr("init", "--route", "eval", "--task", "compare two prompt variants")
    for step in ("step-1", "step-2", "step-3"):
        r.rr("phase", step, "--done")
    r.rr("phase", "step-4", "--done", "--note", "parent: host lacks subagents entirely")
    r.check(0, "complete through step-4", through="step-4")
    r.rr("phase", "step-5", "--done", "--note", "parent: none")
    r.check(1, "step-5: no returned delegate recorded", 'note "parent: <the limitation>"', through="step-5")


def plan_is_skipped_only_on_the_small_change_exit(r):
    r.rr("init", "--route", "multi-phase-plan", "--task", "t")
    r.rr("phase", "step-1", "--start")
    r.rr("evidence", "--kind", "artifact", "--result", "pass", "--phase", "step-1", "--output", r.output("s1.txt", "x\n"))
    r.rr("phase", "step-1", "--done")
    r.rr("phase", "step-2", "--done")
    r.rr("phase", "step-3", "--done")
    text = r.rr("phase", "step-4", "--skip", "lazy", code=2)
    assert "reason starting with: small-change" in text, text
    r.rr("phase", "step-4", "--skip", "small-change: one file with an obvious approach")
    for step in ("step-5", "step-6", "step-7"):
        r.rr("phase", step, "--skip", "small-change: no plan to check or hand back")
    r.check(0, "complete")


def reroute_only_from_the_first_phase(r):
    r.rr("init", "--route", "orchestrate", "--task", "t")
    r.rr("phase", "step-1", "--done")
    r.rr("phase", "step-2", "--done")
    text = r.rr("reroute", "--route", "autonomous-run", "--reason", "smaller than it looked", code=2)
    assert "still in its first phase" in text, text


CASES = [every_playbook_route_takes_its_steps, unknown_route_needs_phases, session_id_is_recorded,
         complete, commit_after_verify_stays_current, edit_after_verify_is_stale,
         same_size_edit_is_stale, failed_delegate_gets_one_retry, open_delegate_blocks_completion,
         over_budget_delegate_says_cancel, failure_needs_a_reason, pause_leaves_a_resume_point, edited_harness,
         open_finding_blocks, no_baseline, repro_on_other_code, implement_before_reproduce,
         evidence_file_rewritten, implement_needs_an_owner, check_through_commits, grounding_reuse,
         harness_must_be_committed, record_is_outside_the_fingerprint, outputs_under_pstack,
         root_cause_needs_confirmation, parent_note_names_the_limitation, review_verdicts_follow_the_check_scope,
         failed_review_blocks_until_passed_or_skipped, skip_only_with_its_phase, reroute_closes_into_the_new_run,
         reroute_only_from_the_first_phase, pr_cleanup_precedes_commits, tracked_output_is_refused,
         rebaseline_keeps_the_old_output_hash, old_format_record_is_checked,
         skipping_an_ungated_phase_keeps_its_failed_review, new_source_cannot_pass_as_output,
         nested_repo_without_a_commit, gc_changes_no_result, skip_reason_must_name_the_mode, changed_phase_list_says_why,
         without_git_outputs_stay_out_of_the_tree, reroute_keeps_its_obligations, reroute_moves_only_its_own_pointer,
         rerouted_run_reports_the_new_one, contract_validation_rejects_bad_gates,
         nested_committed_repo_counts_by_content, registered_submodule_counts_by_content, index_flags_do_not_hide_edits,
         reroute_waits_for_a_failed_delegate, broken_records_are_reported, unreadable_output_is_reported,
         ground_scope_outside_is_refused, relpath_across_drives_is_outside,
         output_rule_follows_the_directory_not_its_spelling, skip_reason_case_and_punctuation,
         paused_run_refuses_phases_until_resumed, index_flag_deletions_count,
         gitlink_without_a_repository_counts_by_content, nested_worktree_setting_is_ignored,
         sparse_checkout_paths_count, ground_scope_inside_a_nested_repository, malformed_entries_are_reported,
         unexpected_errors_exit_cleanly, run_follows_its_workspace_into_a_worktree,
         committing_inside_a_submodule_keeps_evidence_fresh, works_without_a_git_binary,
         closed_stdout_keeps_the_exit_code, delegate_cannot_take_over_the_run, record_outlives_its_worktree,
         worktree_move_keeps_the_workspace, reroute_keeps_the_moved_workspace, nested_worktrees_are_left_out,
         worktree_paths_parse_exactly, prunable_worktree_path_counts, submodule_keeps_its_own_records,
         relative_worktree_gitdir_follows_a_move, unwritable_main_checkout, pause_safely_starts_no_run,
         unwritable_existing_runs_dir_falls_back, run_ids_stay_unique_across_checkouts,
         foreign_repo_at_a_stale_worktree_path, failed_reroute_leaves_no_orphan, deleted_main_checkout_is_named,
         eval_at_tier_zero_closes_with_a_parent_note, plan_is_skipped_only_on_the_small_change_exit]

failed = 0
for case in CASES:
    with tempfile.TemporaryDirectory() as tmp:
        try:
            case(Run(tmp))
            print(f"ok   {case.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL {case.__name__}\n{e}")
print(f"\n{len(CASES) - failed}/{len(CASES)} run-record cases pass")
sys.exit(1 if failed else 0)
