import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


VALIDATOR = Path(__file__).with_name('validate_receipt.py')


class ReceiptTests(unittest.TestCase):
    def validate(self, text):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'results.jsonl'
            if text is not None:
                path.write_text(text, encoding='utf-8')
            return subprocess.run([sys.executable, '-B', VALIDATOR, path], capture_output=True, text=True)

    def test_accepts_current_receipt_shapes_and_text_at_limit(self):
        rows = [
            {'name': 'final-end', 'exit': 1, 'head': 'a' * 40, 'failures': ['stripe'], 'testsByConfig': {'main': 12}},
            {
                'name': 'historical-11-0-to-11-1',
                'exit': 0,
                'countsBefore': [{'table': 'products', 'count': '2'}],
                'countsAfter': [{'table': 'products', 'count': '3'}],
                'changedCounts': [{'table': 'products', 'before': '2', 'after': '3'}],
            },
            {'name': 'image-smoke-http', 'exit': 1, 'checks': {'/': 200, '/login': 'ą' * 200}},
            {
                'name': 'release-layout',
                'exit': 0,
                'versions': {'package.json': '2026.11.1'},
                'sizes': [{'file': 'supabase/migrations/example.sql', 'sqlBytes': 10}],
            },
        ]
        result = self.validate('\n'.join(map(json.dumps, rows)))
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_rejects_any_invalid_line_without_echoing_it(self):
        valid = {'name': 'image-smoke-http', 'exit': 1}
        for invalid in (
            json.dumps({**valid, 'unexpected': 'diagnostic-marker'}),
            json.dumps({**valid, 'checks': {'/login': 'x' * 201}}),
            json.dumps({**valid, 'mismatched': ['x' * 201]}),
            json.dumps({**valid, 'checks': {'diagnostic-marker': 200}}),
            json.dumps({**valid, 'countsBefore': [{'table': 'products', 'diagnostic-marker': '2'}]}),
            '{"name":"diagnostic-marker","name":"other","exit":0}',
            '{"name":"diagnostic-marker","exit":',
            '[]',
        ):
            with self.subTest(invalid=invalid):
                result = self.validate(json.dumps(valid) + '\n' + invalid)
                self.assertEqual(result.returncode, 1)
                self.assertIn('line 2', result.stderr)
                self.assertNotIn('diagnostic-marker', result.stdout + result.stderr)

    def test_missing_receipt_is_allowed(self):
        self.assertEqual(self.validate(None).returncode, 0)

    def test_accepts_test_ids_and_omission_count(self):
        prefix = 'chromium|tests/example.spec.ts:12|'
        ids = [prefix + 'x' * (200 - len(prefix))] * 40 + ['+3 omitted']
        row = {'name': 'chromium-failures', 'exit': 0, 'testIds': ids}
        result = self.validate(json.dumps(row))
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_failure_messages_reject_paths_addresses_and_credentials(self):
        valid = {'name': 'chromium-failures', 'exit': 0, 'testIds': [], 'testErrors': ['line 3: Timeout 5000ms http://localhost:3777/en']}
        self.assertEqual(self.validate(json.dumps(valid)).returncode, 0)
        for message in ('see /home/runner/work/a.log', 'mail a@example.com', 'sk_' + 'test_diagnostic_marker', 'x' * 1201):
            with self.subTest(message=message):
                result = self.validate(json.dumps({**valid, 'testErrors': [message]}))
                self.assertEqual(result.returncode, 1)
                self.assertNotIn('diagnostic_marker', result.stdout + result.stderr)

    def test_rejects_unsafe_test_ids(self):
        prefix = 'tests/example.test.ts|'
        for ids in (
            [prefix + 'sk_' + 'test_diagnostic_marker'],
            [prefix + 'https://example.com/data'],
            [prefix + '/tmp/private.log'],
            [prefix + 'a\nb'],
            [prefix + 'x' * 200],
            [prefix + 'test'] * 42,
            [17],
        ):
            with self.subTest(ids=ids):
                row = {'name': 'unit-failures', 'exit': 0, 'testIds': ids}
                result = self.validate(json.dumps(row))
                self.assertEqual(result.returncode, 1)
                self.assertNotIn('diagnostic_marker', result.stdout + result.stderr)
