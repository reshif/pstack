#!/usr/bin/env python3
"""Serialize commands that generate or consume this checkout's build artifacts."""
import fcntl
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
LOCK_ENV = "PSTACK_BUILD_LOCK"
_lock = None


def ensure_build_lock():
    global _lock
    if os.environ.get(LOCK_ENV) == str(ROOT):
        return
    # Keep this inode outside dist/ and never unlink it: other processes may be
    # waiting on it, and clean/rebuild replaces the artifact directories.
    _lock = (ROOT / ".pstack-build.lock").open("a+b")
    try:
        fcntl.flock(_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print("Waiting for another PSTACK build command to finish…", file=sys.stderr, flush=True)
        fcntl.flock(_lock, fcntl.LOCK_EX)
    os.set_inheritable(_lock.fileno(), True)
    os.environ[LOCK_ENV] = str(ROOT)


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: build_lock.py COMMAND [ARG ...]")
    try:
        ensure_build_lock()
        # Retain the lock in the child and preserve Make's inherited jobserver
        # descriptors, just as executing the command directly would.
        code = subprocess.call(sys.argv[1:], close_fds=False)
    except KeyboardInterrupt:
        return 130
    return code if code >= 0 else 128 - code


if __name__ == "__main__":
    sys.exit(main())
