#!/usr/bin/env python3
"""Pack the generated builds into the Python package as a content-addressed store.

The five host builds share most of their bytes: the guide images alone were
duplicated five times. Store each distinct file once under its hash, and give
each host an index mapping its paths onto those hashes.
"""
import hashlib
import json
import pathlib
import shutil
import sys

from build_lock import ensure_build_lock

ensure_build_lock()

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "packaging" / "src" / "pstack_cli" / "data"
DIST = ROOT / "dist"

if not DIST.is_dir():
    sys.exit("dist/ missing. Run `make` first.")

shutil.rmtree(DATA, ignore_errors=True)
(DATA / "blobs").mkdir(parents=True)
(DATA / "hosts").mkdir()

blobs, raw = {}, 0
for host_dir in sorted(p for p in DIST.iterdir() if p.is_dir()):
    index, execs = {}, []
    for f in sorted(host_dir.rglob("*")):
        if not f.is_file():
            continue
        # The blob store keeps bytes, not modes, so the scripts skills run directly are listed here.
        if f.stat().st_mode & 0o111:
            execs.append(f.relative_to(host_dir).as_posix())
        data = f.read_bytes()
        raw += len(data)
        sha = hashlib.sha256(data).hexdigest()
        if sha not in blobs:
            blob = DATA / "blobs" / sha[:2] / sha
            blob.parent.mkdir(parents=True, exist_ok=True)
            blob.write_bytes(data)
            blobs[sha] = len(data)
        index[f.relative_to(host_dir).as_posix()] = sha
    (DATA / "hosts" / f"{host_dir.name}.json").write_text(
        json.dumps(index, indent=0, sort_keys=True), encoding="utf-8")
    # Not *.json, which would read as one more host.
    (DATA / "hosts" / f"{host_dir.name}.exec").write_text(json.dumps(execs, indent=0), encoding="utf-8")

shutil.copy2(ROOT / "core" / "manifest.json", DATA / "manifest.json")
stored = sum(blobs.values())
print(f"packaged {len(list((DATA / 'hosts').glob('*.json')))} hosts, "
      f"{len(blobs)} distinct files ({stored/1e6:.1f}MB stored, "
      f"{raw/1e6:.1f}MB raw, {100 - stored*100/raw:.0f}% saved)")
