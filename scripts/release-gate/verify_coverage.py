"""Prove config ownership and that execution shards partition the full collection."""

from collections import Counter
from fnmatch import fnmatch
from pathlib import Path

from browser import CANONICAL, LANES, list_suite, test_ids
from support import ADMIN, OUT, ROOT, json, record


def inventory():
    reports = {name: list_suite(suite) for name, suite in CANONICAL.items()}
    files = {path: set() for path in (ADMIN / 'tests').rglob('*.spec.ts')}
    for name, report in reports.items():
        config = CANONICAL[name]
        projects = [value.split('=', 1)[1] for value in config.options if value.startswith('--project=')]
        for project in report['config']['projects']:
            if projects and project['name'] not in projects:
                continue

            def matches(path, patterns):
                return any(
                    fnmatch(str(path), pattern if pattern.startswith(('/', '**/')) else '**/' + pattern)
                    for pattern in patterns
                )

            for path in files:
                if (
                    path.is_relative_to(Path(project['testDir']))
                    and matches(path, project['testMatch'])
                    and not matches(path, project['testIgnore'])
                ):
                    files[path].add(name)

        for _, path, *_ in test_ids(report):
            absolute = (Path(report['config']['rootDir']) / path).resolve()
            if absolute.is_relative_to(ADMIN / 'tests') and absolute.suffixes[-2:] == ['.spec', '.ts']:
                assert absolute in files, f'Unknown spec: {absolute.name}'
                files[absolute].add(name)

    unknown = [str(path.relative_to(ROOT)) for path, owners in files.items() if len(owners) != 1]
    assert not unknown, f'Unassigned or overlapping specs: {unknown}'
    canonical = sum((test_ids(report) for report in reports.values()), Counter())
    partition = Counter()
    counts = {}
    for suites in LANES.values():
        for suite in suites:
            report = reports[suite.name] if CANONICAL.get(suite.name) == suite else list_suite(suite)
            ids = test_ids(report)
            assert ids, f'Empty suite: {suite.name}'
            partition.update(ids)
            counts[suite.name] = ids.total()
    assert canonical == partition, 'Browser execution lanes differ from the complete test inventory'
    totals = {name: test_ids(report).total() for name, report in reports.items()}
    result = {'counts': counts, 'totals': totals, 'specFiles': len(files)}
    (OUT / 'playwright-coverage.json').write_text(json.dumps(result, indent=2) + '\n')
    record('playwright-coverage-inventory', 0, specFiles=len(files), testsByConfig=totals)
    return result
