"""Install checked Linux release binaries in the runner's scratch space."""

import hashlib
import io
import tarfile
import urllib.request
import zipfile

from support import OUT, env, record

BIN = OUT / 'bin'
RELEASES = {
    'playerstack-bun': (
        'oven-sh/bun/bun-v1.4.3/bun-linux-x64.zip',
        '3e730528d89775f03f87f05c06787c4df4099d0a37f3f252e7b829cb23816e18',
    ),
    'stripe': (
        'stripe/stripe-cli/v1.55.14/stripe_1.55.14_linux_x86_64.tar.gz',
        'cfc9af47378a0331334b16da910812046957695244807e92706ed137b897a520',
    ),
    'cloudflared': (
        'cloudflare/cloudflared/2026.11.2/cloudflared-linux-amd64',
        '56f13335143ec0e22772963290683a84a04114a35ec64cbc794a4d39ff9bb8cf',
    ),
    'trivy': (
        'aquasecurity/trivy/v0.76.2/trivy_0.76.2_Linux-64bit.tar.gz',
        'bc0fc726e017b8927a62b2d3531d7a84ee01769daf5c99ed866dced54089fdbf',
    ),
    'trufflehog': (
        'trufflesecurity/trufflehog/v3.99.9/trufflehog_3.99.9_linux_amd64.tar.gz',
        '12050095c8063bf4d34f9f6cbce6ba9fa8d0deea9d503d0570364feba093658e',
    ),
}


def install(*names):
    BIN.mkdir(exist_ok=True)
    for name in names:
        source, checksum = RELEASES[name]
        owner, repo, tag, asset = source.split('/')
        url = f'https://github.com/{owner}/{repo}/releases/download/{tag}/{asset}'
        with urllib.request.urlopen(url, timeout=120) as response:
            data = response.read()
        assert hashlib.sha256(data).hexdigest() == checksum, f'Checksum mismatch: {name}'
        if asset.endswith('.tar.gz'):
            with tarfile.open(fileobj=io.BytesIO(data)) as archive:
                members = [
                    member
                    for member in archive.getmembers()
                    if member.isfile() and member.name.removeprefix('./') == name
                ]
                assert len(members) == 1, f'Expected one {name} executable'
                with archive.extractfile(members[0]) as binary:
                    data = binary.read()
        path = BIN / name
        if name == 'playerstack-bun':
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                data = archive.read('bun-linux-x64/bun')
            path = OUT / 'playerstack-bun' / 'bun'
            path.parent.mkdir()
            env['RC_GATE_PLAYERSTACK_BUN'] = str(path)
        path.write_bytes(data)
        path.chmod(0o700)
        record('setup-' + name, 0, version=tag)
    if not env['PATH'].startswith(str(BIN) + ':'):
        env['PATH'] = str(BIN) + ':' + env['PATH']
