#!/usr/bin/env python3
"""Exercise overlapping artifact commands and lock lifetime in an isolated checkout."""
import hashlib
import json
import os
from pathlib import Path
import select
import shutil
import signal
import subprocess
import sys
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parent.parent.parent


class BuildLockTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix="pstack-build-lock-")
        cls.root = Path(cls.tmp.name)
        for folder in ("build", "core"):
            shutil.copytree(SOURCE / folder, cls.root / folder)
        cls.wrapper = cls.root / "build/build_lock.py"
        subprocess.run(["node", "build/build.mjs"], cwd=cls.root, check=True,
                       stdout=subprocess.DEVNULL, timeout=20)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def start(self, command):
        return subprocess.Popen(command, cwd=self.root, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True)

    def finish(self, proc, expected=0):
        try:
            out, err = proc.communicate(timeout=20)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.communicate()
            self.fail("Build command did not release its lock")
        self.assertEqual(proc.returncode, expected, out + err)

    def test_concurrent_build_verify_and_package(self):
        for _ in range(2):
            processes = [self.start(command) for command in (
                ["node", "build/build.mjs"],
                ["node", "build/verify.mjs"],
                [sys.executable, "build/package.py"],
            )]
            try:
                for proc in processes:
                    self.finish(proc)
            finally:
                for proc in processes:
                    if proc.poll() is None:
                        proc.kill()
                        proc.communicate()
        skill = self.root / "dist/claude/.claude/skills/figure-it-out/SKILL.md"
        self.assertTrue(skill.is_file())
        data = self.root / "packaging/src/pstack_cli/data"
        indexes = list((data / "hosts").glob("*.json"))
        self.assertEqual(len(indexes), 5)
        hashes = {sha for index in indexes for sha in json.loads(index.read_text()).values()}
        for sha in hashes:
            blob = data / "blobs" / sha[:2] / sha
            self.assertEqual(hashlib.sha256(blob.read_bytes()).hexdigest(), sha)

    def test_failed_command_releases_lock_and_preserves_exit_code(self):
        self.finish(self.start([sys.executable, str(self.wrapper), sys.executable,
                                "-c", "raise SystemExit(17)"]), expected=17)
        self.finish(self.start([sys.executable, str(self.wrapper), sys.executable,
                                "-c", "pass"]))

    def test_command_inherits_make_jobserver_descriptors(self):
        read_fd, write_fd = os.pipe()
        os.write(write_fd, b"token")
        os.close(write_fd)
        try:
            proc = subprocess.Popen(
                [sys.executable, str(self.wrapper), sys.executable, "-c",
                 "import os, sys; assert os.read(int(sys.argv[1]), 5) == b'token'", str(read_fd)],
                cwd=self.root, pass_fds=(read_fd,), stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, text=True)
            self.finish(proc)
        finally:
            os.close(read_fd)

    def test_child_keeps_lock_if_wrapper_is_killed(self):
        owner = self.start([sys.executable, str(self.wrapper), sys.executable, "-c",
                            "import os, signal; print(os.getpid(), flush=True); signal.pause()"])
        child_pid = None
        contender = None
        try:
            self.assertTrue(select.select([owner.stdout], [], [], 5)[0], "owner did not start")
            child_pid = int(owner.stdout.readline())
            owner.kill()
            owner.wait(timeout=5)
            contender = self.start([sys.executable, str(self.wrapper), sys.executable, "-c", "pass"])
            self.assertTrue(select.select([contender.stderr], [], [], 5)[0], "contender did not start")
            self.assertIn("Waiting for another PSTACK build", contender.stderr.readline())
            self.assertIsNone(contender.poll())
            os.kill(child_pid, signal.SIGTERM)
            child_pid = None
            self.finish(contender)
        finally:
            if child_pid:
                os.kill(child_pid, signal.SIGTERM)
            if owner.poll() is None:
                owner.kill()
            owner.communicate(timeout=5)
            if contender and contender.poll() is None:
                contender.kill()
                contender.communicate()


if __name__ == "__main__":
    unittest.main(verbosity=2)
