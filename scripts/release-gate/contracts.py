"""Release layout and real manifest writer contract for stable and RC 11.1."""

import hashlib
import json
from pathlib import Path
import re
import subprocess

from support import ROOT, env, record, validate_release_version
import tempfile

versions = {
    path: json.loads((ROOT / path).read_text())['version'] for path in ('package.json', 'admin-panel/package.json')
}
assert len(set(versions.values())) == 1, versions
version = validate_release_version(next(iter(versions.values())))
assert 'version-' + version + '-blue' in (ROOT / 'README.md').read_text()
assert '${SELLF_VERSION:-' + version + '}' in (ROOT / 'docker-compose.yml').read_text()
assert 'SELLF_VERSION=' + version in (ROOT / '.env.docker.example').read_text()
# Compare actual working files as well as committed files; renames/deletions cannot hide changes.
released = subprocess.check_output(
    ['git', 'ls-tree', '-r', '--name-only', 'v2026.11.0', '--', 'supabase/migrations'], cwd=ROOT, text=True
).splitlines()
old = [
    name
    for name in released
    if not (ROOT / name).is_file()
    or (ROOT / name).read_bytes() != subprocess.check_output(['git', 'show', 'v2026.11.0:' + name], cwd=ROOT)
]
assert not old, f'released migrations modified/deleted: {old}'
added = sorted(
    str(p.relative_to(ROOT))
    for p in (ROOT / 'supabase/migrations').iterdir()
    if p.is_file() and str(p.relative_to(ROOT)) not in released
)
assert added == ['supabase/migrations/20261118000000_release_2026_11_1.sql'], added
updater = (ROOT / 'admin-panel/scripts/upgrade.sh').read_text()
assert re.search(r'^MIN_UPDATER_VERSION=2$', updater, re.M), '11.1 requires updater 2'
# No per-file size cap: updater 2 streams SQL and JSON from files.
sizes = [{'file': name, 'sqlBytes': (ROOT / name).stat().st_size} for name in added]
with tempfile.TemporaryDirectory(prefix='sellf-gate-manifest-') as temporary:
    directory = Path(temporary)
    archive = directory / 'fixture.tar.gz'
    archive.write_bytes(b'gate contract')
    for candidate in dict.fromkeys([version, '2026.11.1', '2026.11.1-rc.1']):
        # A reused output directory must lose stale legacy assets as well.
        for name in ['sellf-build.manifest', 'sellf-build.manifest.sig']:
            (directory / name).write_text('stale')
        subprocess.run(
            [
                'bash',
                str(ROOT / 'admin-panel/scripts/ci/write-release-manifests.sh'),
                candidate,
                str(archive),
                str(directory),
            ],
            check=True,
            cwd=ROOT,
            env=env,
        )
        expected = (
            f'version={candidate}\nsha256={hashlib.sha256(archive.read_bytes()).hexdigest()}\nmin_updater_version=2\n'
        )
        assert (directory / 'sellf-build.v2.manifest').read_text() == expected
        assert not (directory / 'sellf-build.manifest').exists()
        assert not (directory / 'sellf-build.manifest.sig').exists()
record(
    'release-layout',
    0,
    sizes=sizes,
    versions=versions,
    addedMigrations=added,
    changedReleasedMigrations=old,
    minUpdaterVersion=2,
    manifest='v2-only',
    rcChecked=True,
)
