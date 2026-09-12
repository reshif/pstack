#!/usr/bin/env python3
"""Compare this port against an upstream checkout.

The port rewrites the upstream files listed under `port_owned` in
build/upstream.json and restores them over the top of any re-derivation. That protects the rewrites and silently discards upstream's own
changes to the same files. This is the check that turns that silence into a
failure: it compares the upstream content each rewrite was derived FROM against
what upstream ships now.

    python3 build/check-upstream.py /path/to/cursor-plugins [--rev REV]
"""
import hashlib
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
UP = json.loads((ROOT / "build" / "upstream.json").read_text())


def upstream_path(rel: str) -> str:
    if rel.startswith("playbooks/"):
        return f"pstack/skills/poteto-mode/playbooks/{rel.split('/')[-1]}"
    return f"pstack/{rel}"


def blob(repo: pathlib.Path, rev: str, path: str):
    r = subprocess.run(["git", "-C", str(repo), "show", f"{rev}:{path}"],
                       capture_output=True)
    return hashlib.sha256(r.stdout).hexdigest() if r.returncode == 0 else None


def main() -> int:
    if len(sys.argv) < 2:
        sys.exit(__doc__.strip())
    repo = pathlib.Path(sys.argv[1]).expanduser().resolve()
    rev = sys.argv[sys.argv.index("--rev") + 1] if "--rev" in sys.argv else "origin/main"

    if not (repo / ".git").is_dir():
        sys.exit(f"not a git checkout: {repo}")
    subprocess.run(["git", "-C", str(repo), "fetch", "--quiet", "origin"], check=False)

    head = subprocess.run(["git", "-C", str(repo), "rev-parse", rev],
                          capture_output=True, text=True).stdout.strip()
    print(f"port derived from  {UP['commit'][:12]}  (pstack {UP['version']})")
    print(f"upstream {rev:<10} {head[:12]}")

    if head == UP["commit"]:
        print("\nIn sync. Nothing upstream has changed.")
        return 0

    changed = subprocess.run(
        ["git", "-C", str(repo), "diff", "--name-only", UP["commit"], head, "--", "pstack/"],
        capture_output=True, text=True).stdout.split()
    print(f"\n{len(changed)} upstream file(s) changed since this port was derived:")
    for f in changed:
        print(f"  {f}")

    # The dangerous subset: upstream changed a file the port rewrites, so a
    # re-derivation would restore the port's version and lose upstream's change.
    conflicts = []
    for rel, recorded in UP["port_owned"].items():
        now = blob(repo, head, upstream_path(rel))
        if now is None:
            conflicts.append((rel, "deleted upstream"))
        elif now != recorded:
            conflicts.append((rel, "upstream changed a file this port rewrites"))

    if conflicts:
        print(f"\nCONFLICT: {len(conflicts)} port-owned file(s) need a human merge.")
        for rel, why in conflicts:
            print(f"  {rel}\n    {why}")
            print(f"    review: git -C {repo} diff {UP['commit']} {head} -- {upstream_path(rel)}")
        print("\nMerge upstream's change into core/, then update build/upstream.json.")
        return 1

    print("\nNo port-owned file was touched. A normal re-derivation will pick these up.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
