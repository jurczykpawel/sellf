"""Publish bounded test identifiers extracted from runner-local reports."""

import json
from pathlib import Path
import re

from support import ADMIN, OUT, RUNTIME, record, redact, run
from validate_receipt import EMAIL, LOCAL_PATH, MAX_MESSAGE, MAX_TEST_IDS, MAX_TEXT, PRIVATE_REFERENCE, test_id

ANSI = re.compile(r'\x1b\[[0-9;?]*[A-Za-z]')


def public_test_file(file):
    path = Path(file).resolve()
    if path == RUNTIME / 'acceptance.spec.ts' and path.is_file():
        return path.name
    if path.is_relative_to(ADMIN / 'tests') and path.is_file():
        return path.relative_to(ADMIN).as_posix()
    return None


def test_identifier(file, title, project=None, line=None):
    if not file:
        return None
    if project is None:
        prefix = f'{file}|'
    else:
        prefix = f'{project or "default"}|{file}:{line}|'
    if prefix != redact(prefix):
        return None
    title = redact(title)
    title = ''.join(char if char.isprintable() and char != '|' else ' ' for char in title)
    title = ' '.join(PRIVATE_REFERENCE.sub('[redacted]', title).split()) or '[untitled]'
    space = MAX_TEXT - len(prefix)
    identifier = prefix + title[:min(120, space)]
    return identifier if space > 0 and test_id(identifier) else None


def public_message(text):
    """First part of a failure message without masked values, credentials, runner paths or addresses."""
    text = redact(ANSI.sub('', text or ''))
    text = LOCAL_PATH.sub('[path]', EMAIL.sub('[email]', text))
    text = ' '.join(''.join(char if char.isprintable() else ' ' for char in text).split())
    if len(text) <= MAX_MESSAGE:
        return text
    head = MAX_MESSAGE * 3 // 5
    return text[:head] + ' … ' + text[-(MAX_MESSAGE - head - 3):]  # tracebacks put the cause at the end


def record_failures(name, failures):
    """Publish failed test IDs with the matching sanitized failure text (same index)."""
    ids = []
    errors = []
    omitted = 0
    for identifier, message in failures:
        if identifier is None or len(ids) == MAX_TEST_IDS:
            omitted += 1
        else:
            ids.append(identifier)
            errors.append(public_message(message))
    if omitted:
        ids.append(f'+{omitted} omitted')
    record(name + '-failures', 0, testIds=ids, testErrors=errors)


def vitest_report_path(name):
    return OUT / (name + '-report.json')


def read_test_report(path):
    try:
        report = json.loads(path.read_text())
        return report if isinstance(report, dict) else None
    except (OSError, ValueError):
        return None


def run_vitest(name, command, extra=None):
    path = vitest_report_path(name)
    run(name, [*command, '--reporter=json', f'--outputFile={path}'], ADMIN, extra)
    verify_vitest(name)


def verify_vitest(name):
    report = read_test_report(vitest_report_path(name))
    if report is None:
        record(name + '-count', 1, reportMissing=True)
        record_failures(name, ())
        return

    def failures():
        for file in report['testResults']:
            path = public_test_file(ADMIN / file['name'])
            failed = [case for case in file['assertionResults'] if case['status'] == 'failed']
            if file['status'] == 'failed' and not failed:
                yield test_identifier(path, '[file failed]'), file.get('message')
            for case in failed:
                title = case['fullName'].strip()
                for prefix in (file['name'], path):
                    if prefix and title.startswith(prefix + ' '):
                        title = title[len(prefix) + 1:]
                        break
                yield test_identifier(path, title), (case.get('failureMessages') or [''])[0]

    record(
        name + '-count',
        int(not report['success']),
        total=report['numTotalTests'],
        passed=report['numPassedTests'],
        failed=report['numFailedTests'],
        skipped=report['numPendingTests'] + report['numTodoTests'],
        failedSuites=report['numFailedTestSuites'],
    )
    record_failures(name, failures())
