"""Hash tracked files in the candidate and workflow harness."""

import hashlib
import subprocess

from support import ROOT, TOOLS, resolve_gate_head


def snapshot(root, pathspec=()):
    paths = subprocess.check_output(['git', 'ls-files', '-z', '--', *pathspec], cwd=root)
    hashes = {}
    for path in paths.decode().split('\0'):
        if not path:
            continue
        item = root / path
        if item.is_symlink():
            data = str(item.readlink()).encode()
        else:
            data = item.read_bytes()
        hashes[path] = hashlib.sha256(data).hexdigest()
    return resolve_gate_head(root), hashes


def frozen_source():
    return snapshot(ROOT), snapshot(TOOLS.parents[1], ('scripts/release-gate', '.github/workflows/release-gate.yml'))
