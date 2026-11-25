"""Validate the public JSONL receipt before artifact upload."""

import json
import math
from pathlib import Path
import re
import sys


MAX_TEST_IDS = 40
MAX_TEXT = 200
MAX_MESSAGE = 1200
CREDENTIAL = re.compile(r'(sk|pk|rk|whsec|sb_secret|sb_publishable|sf_live|sf_test)_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_.-]+')
PRIVATE_REFERENCE = re.compile(
    r'(?<!\S)\S*[/\\]\S*|(?:data:|mailto:|www\.)\S+|(?<![\w.+-])[\w.+-]+@[\w.-]+\.[a-z]{2,}',
    re.IGNORECASE,
)
LOCAL_PATH = re.compile(r'(?<![\w:/.])/(?:home|tmp|opt|usr|var|private|Users|runner|__w|mnt)/\S*')
EMAIL = re.compile(r'(?<![\w.+-])[\w.+-]+@[\w.-]+\.[a-z]{2,}', re.IGNORECASE)
TEST_FILE = r'(?:tests/(?:[\w-][\w.-]*/)*[\w-][\w.-]*\.(?:tsx?|jsx?)|acceptance\.spec\.ts)'
TEST_ID = re.compile(rf'(?:[\w.-]+\|{TEST_FILE}:[1-9][0-9]*|{TEST_FILE})\|([^|]+)')


def short_text(value):
    return isinstance(value, str) and len(value) <= MAX_TEXT


def integer(value):
    return type(value) is int


def fields(value, schema):
    return isinstance(value, dict) and all(key in schema and schema[key](item) for key, item in value.items())


def items(check):
    return lambda value: isinstance(value, list) and all(check(item) for item in value)


def count_text(value):
    return short_text(value) and re.fullmatch(r'[0-9]+', value) is not None


def test_id(value):
    if not short_text(value) or not value.isprintable() or CREDENTIAL.search(value):
        return False
    match = TEST_ID.fullmatch(value)
    return bool(match and not PRIVATE_REFERENCE.search(match[1]))


def test_ids(value):
    if not isinstance(value, list) or len(value) > MAX_TEST_IDS + 1:
        return False
    if value and short_text(value[-1]) and re.fullmatch(r'\+[1-9][0-9]* omitted', value[-1]):
        value = value[:-1]
    return len(value) <= MAX_TEST_IDS and all(test_id(item) for item in value)


def safe_message(value):
    """Failure text published next to a test ID: no credentials, runner paths or addresses."""
    return (
        isinstance(value, str)
        and len(value) <= MAX_MESSAGE
        and value.isprintable()
        and not CREDENTIAL.search(value)
        and not LOCAL_PATH.search(value)
        and not EMAIL.search(value)
    )


TABLE_COUNTS = items(lambda value: fields(value, {'table': short_text, 'count': count_text}))
RECEIPT_FIELDS = {
    **dict.fromkeys(('name', 'lane', 'head', 'version', 'error', 'baseline', 'migration', 'manifest'), short_text),
    **dict.fromkeys(
        (
            'exit',
            'expected',
            'passed',
            'skipped',
            'total',
            'failed',
            'failedSuites',
            'unexpectedSkips',
            'failedOrFlaky',
            'completed',
            'specFiles',
            'critical',
            'fixableHigh',
            'unfixedHigh',
            'files',
            'sqlBytes',
            'minUpdaterVersion',
            'listed',
            'familyTotal',
        ),
        integer,
    ),
    **dict.fromkeys(('reportMissing', 'repeatSkipped', 'rcChecked'), lambda value: type(value) is bool),
    **dict.fromkeys(('failures', 'mismatched', 'addedMigrations', 'changedReleasedMigrations'), items(short_text)),
    'testIds': test_ids,
    'testErrors': lambda value: isinstance(value, list) and len(value) <= MAX_TEST_IDS and all(map(safe_message, value)),
    'steps': lambda value: isinstance(value, list) and len(value) <= 10 and all(map(safe_message, value)),
    'seconds': lambda value: type(value) in (int, float) and math.isfinite(value),
    'checks': lambda value: fields(
        value, dict.fromkeys(('/', '/api/health', '/login'), lambda item: integer(item) or short_text(item))
    ),
    'testsByConfig': lambda value: fields(
        value,
        dict.fromkeys(
            (
                'main',
                'sections',
                'transfer',
                'invoicing',
                'runtime',
                'stripe',
                'template-author',
                'live-template-acceptance',
            ),
            integer,
        ),
    ),
    'versions': lambda value: fields(value, dict.fromkeys(('package.json', 'admin-panel/package.json'), short_text)),
    'sizes': items(lambda value: fields(value, {'file': short_text, 'sqlBytes': integer})),
    'countsBefore': TABLE_COUNTS,
    'countsAfter': TABLE_COUNTS,
    'changedCounts': items(
        lambda value: fields(value, {'table': short_text, 'before': count_text, 'after': count_text})
    ),
}


def unique_keys(pairs):
    value = dict(pairs)
    if len(value) != len(pairs):
        raise ValueError('Duplicate receipt key')
    return value


def validate(path):
    if path.is_symlink() or path.parent.is_symlink() or path.parent.parent.is_symlink():
        raise ValueError('Expected a regular receipt file')
    if not path.exists():
        return
    if not path.is_file():
        raise ValueError('Expected a regular receipt file')

    with path.open('rb') as receipt:
        for number, line in enumerate(receipt, 1):
            try:
                row = json.loads(line.decode('utf-8'), object_pairs_hook=unique_keys)
                if fields(row, RECEIPT_FIELDS) and {'name', 'exit'} <= row.keys():
                    continue
            except (ValueError, OverflowError, RecursionError):
                pass
            raise ValueError(f'Invalid receipt at line {number}')


if __name__ == '__main__':
    try:
        validate(Path(sys.argv[1]))
    except ValueError as error:
        sys.exit(str(error))
    except OSError:
        sys.exit('Could not read receipt')
