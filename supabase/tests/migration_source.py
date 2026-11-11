"""Read a named source section from the release migrations (also usable as a CLI)."""
from pathlib import Path
import sys

MIGRATIONS = Path(__file__).resolve().parents[1] / 'migrations'


def read_migration_source(name):
    marker = f'-- ===== Source: {name} =====\n'
    for path in sorted(MIGRATIONS.glob('2026111023590[0-7]_*.sql')):
        content = path.read_text()
        if marker in content:
            return content.split(marker, 1)[1].split('\n-- ===== Source:', 1)[0]
    raise ValueError(f'Migration source not found: {name}')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: migration_source.py <source-section.sql>')
    print(read_migration_source(sys.argv[1]), end='')
