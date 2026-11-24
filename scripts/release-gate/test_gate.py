import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import tomllib
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

import all as gate
import browser
import prepare
import support


def load_historical_upgrade():
    spec = importlib.util.spec_from_file_location('historical_upgrade', support.TOOLS / 'historical-upgrade.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class GateContractTests(unittest.TestCase):
    def test_prepare_copies_and_remaps_without_source_changes(self):
        source = support.ROOT / 'supabase/config.toml'
        before = hashlib.sha256(source.read_bytes()).hexdigest()
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / 'stack'
            prepare.prepare_stack(target)
            config = tomllib.loads((target / 'supabase/config.toml').read_text())
            self.assertEqual(config['project_id'], 'sellf-rcgate')
            self.assertEqual(config['api']['port'], 55321)
            self.assertEqual(config['db']['port'], 55322)
            self.assertFalse(config['auth']['external']['github']['enabled'])
            self.assertEqual(config['auth']['jwt_secret'], 'env(RC_GATE_SUPABASE_JWT_SECRET)')
            self.assertEqual(
                sorted(p.name for p in (target / 'supabase/tests').glob('*.sql')),
                sorted(p.name for p in (support.ROOT / 'supabase/tests').glob('*.sql')),
            )
        self.assertEqual(before, hashlib.sha256(source.read_bytes()).hexdigest())

    def test_prepare_refuses_existing_directory(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary)
            sentinel = target / 'sentinel'
            sentinel.write_text('retained')
            with self.assertRaises(AssertionError):
                prepare.prepare_stack(target)
            self.assertEqual(sentinel.read_text(), 'retained')

    def test_release_versions(self):
        for version in ('2026.11.1', '2026.11.1-rc.1', '2026.11.1-rc.12'):
            self.assertEqual(support.validate_release_version(version), version)
        for version in ('2026.11.0', '2026.11.1-rc.0', '2026.11.1-rc.01', '2026.11.1-x'):
            with self.assertRaises(AssertionError):
                support.validate_release_version(version)

    def test_candidate_must_be_an_ancestor_of_workflow_revision(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            subprocess.run(['git', 'init', '-q', str(root)], check=True)
            commit = [
                'git',
                '-c',
                'user.name=Gate',
                '-c',
                'user.email=gate@example.test',
                'commit',
                '--allow-empty',
                '-qm',
                'Fixture',
            ]
            subprocess.run(commit, cwd=root, check=True)
            baseline = support.resolve_gate_head(root)
            subprocess.run(commit, cwd=root, check=True)
            head = support.resolve_gate_head(root)
            subprocess.run(['git', 'tag', 'candidate', baseline], cwd=root, check=True)
            with patch.object(gate, 'TOOLS', root / 'scripts' / 'release-gate'):
                self.assertEqual(gate.resolve_candidate('refs/tags/candidate', head), baseline)
                self.assertEqual(gate.resolve_candidate(baseline, head), baseline)
                with self.assertRaisesRegex(AssertionError, 'ancestor'):
                    gate.resolve_candidate(head, baseline)
                with self.assertRaises(AssertionError):
                    gate.resolve_candidate('--help', head)
            with self.assertRaisesRegex(AssertionError, 'HEAD differs'):
                support.resolve_gate_head(root, baseline)

    def test_new_credentials_are_unique_and_masked(self):
        with patch.dict(support.env, {}, clear=False), patch.object(support, 'mask') as mask:
            support.generate_credentials()
            values = [call.args[0] for call in mask.call_args_list]
            self.assertIn(support.env['APP_ENCRYPTION_KEY'], values)
            self.assertIn(support.env['RC_GATE_SUPABASE_JWT_SECRET'], values)
            self.assertEqual(len(values), len(set(values)))
            first = support.env['RC_GATE_SUPABASE_JWT_SECRET']
            support.generate_credentials()
            self.assertNotEqual(first, support.env['RC_GATE_SUPABASE_JWT_SECRET'])

    def test_stripe_environment_rejects_invalid_key_before_network(self):
        with patch.dict(gate.os.environ, {'STRIPE_SANDBOX_SECRET_KEY': 'invalid'}):
            with patch('urllib.request.urlopen') as request, self.assertRaises(AssertionError):
                gate.stripe_environment()
        request.assert_not_called()

    def test_real_candidate_batch_builder(self):
        module = load_historical_upgrade()
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / 'batch.sql'
            with patch.object(module, 'OUT', output.parent):
                module.build_batch(output)
            source = (support.ROOT / 'supabase/migrations/20261118000000_release_2026_11_1.sql').read_text()
            self.assertIn(source, output.read_text())
            self.assertIn('EXCEPTION WHEN OTHERS', output.read_text())
            self.assertGreater(output.stat().st_size, 120000)

    def test_historical_batch_builder_writes_both_streams_to_log(self):
        module = load_historical_upgrade()
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            updater = directory / 'admin-panel/scripts/upgrade.sh'
            updater.parent.mkdir(parents=True)
            updater.write_text('build_migration_batch() {\n  echo output\n  echo status >&2\n}\n')
            with patch.object(module, 'OUT', directory), patch.object(module, 'ROOT', directory):
                module.build_batch(directory / 'batch.sql')
            self.assertEqual((directory / 'historical-build-batch.log').read_text(), 'output\nstatus\n')

    def test_historical_sql_keeps_results_and_errors_in_the_log(self):
        module = load_historical_upgrade()
        run = subprocess.run

        def run_fixture(_command, **options):
            return run(['bash', '-c', 'echo status >&2; cat; test "$1" = ok', 'fixture', mode], **options)

        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            with patch.object(module, 'OUT', directory), patch.object(module.subprocess, 'run', run_fixture):
                mode = 'ok'
                self.assertEqual(module.sql('12\n'), '12')
                mode = 'error'
                with self.assertRaises(subprocess.CalledProcessError):
                    module.sql('partial\n')
            self.assertEqual((directory / 'historical-psql.log').read_text(), 'status\n12\nstatus\npartial\n')

    def test_release_layout_and_manifest_writer(self):
        with tempfile.TemporaryDirectory() as temporary:
            result = subprocess.run(
                ['python3', '-B', str(support.TOOLS / 'contracts.py')],
                env=support.env | {'RC_GATE_OUT': temporary},
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            receipt = Path(temporary) / 'public' / 'results.jsonl'
            self.assertTrue(receipt.is_file())
            validation = subprocess.run(
                ['python3', '-B', str(support.TOOLS / 'validate_receipt.py'), receipt],
                capture_output=True,
                text=True,
            )
            self.assertEqual(validation.returncode, 0, validation.stderr)

    def test_busy_port_is_left_to_its_owner(self):
        with patch('support.subprocess.run', return_value=subprocess.CompletedProcess([], 0, stdout='12345\n')):
            with self.assertRaisesRegex(AssertionError, 'occupied'):
                support.clean()

    def test_receipt_does_not_contain_child_output_or_arguments(self):
        with tempfile.TemporaryDirectory() as temporary:
            work = Path(temporary)
            receipt = work / 'public' / 'results.jsonl'
            with patch.object(support, 'OUT', work), patch.object(support, 'RECEIPT', receipt):
                with redirect_stdout(io.StringIO()) as console:
                    status = support.run(
                        'fixture', ['python3', '-c', "print('private-output'); raise SystemExit(7)", 'private-argument']
                    )
            self.assertEqual(status, 7)
            self.assertEqual(json.loads(receipt.read_text())['exit'], 7)
            for text in [console.getvalue(), receipt.read_text()]:
                self.assertNotIn('private-output', text)
                self.assertNotIn('private-argument', text)

    def test_maintenance_bypasses_project_dependencies(self):
        maintenance, _ = browser.LANES['stripe-maintenance']
        self.assertIn('--project=maintenance', maintenance.options)
        self.assertIn('--no-deps', maintenance.options)

    def test_count_rejects_missing_test_results_and_stripe_skips(self):
        report = {
            'errors': [],
            'suites': [
                {
                    'specs': [
                        {
                            'file': 'tests/offer-public.spec.ts',
                            'title': 'two production replicas bound lost invalidation and scheduled availability/sale',
                            'line': 1,
                            'tests': [
                                {'projectName': 'chromium', 'results': [{'status': 'skipped'}], 'status': 'skipped'}
                            ],
                        }
                    ]
                }
            ],
            'stats': {'expected': 0, 'skipped': 1, 'unexpected': 0, 'flaky': 0},
        }
        with patch('browser.record', side_effect=lambda _, code, **kwargs: code):
            self.assertEqual(browser.verify_result('ordinary', 1, report), 0)
            self.assertEqual(browser.verify_result('stripe', 1, report), 1)
            self.assertEqual(browser.verify_result('ordinary', 2, report), 1)
            report['suites'][0]['specs'][0]['title'] = 'unexpected omission'
            self.assertEqual(browser.verify_result('ordinary', 1, report), 1)
            report['suites'][0]['specs'][0]['tests'][0]['results'].clear()
            self.assertEqual(browser.verify_result('ordinary', 1, report), 1)

    def test_aggregate_fails_if_a_job_or_count_is_missing(self):
        counts = {suite.name: 1 for suites in browser.LANES.values() for suite in suites}
        expected = {'counts': counts, 'totals': {'main': len(counts)}}
        successful = {'result': 'success'}
        statuses = dict.fromkeys(('preflight', 'inventory', 'checks', 'stripe'), successful)
        with (
            tempfile.TemporaryDirectory() as tmp,
            redirect_stdout(io.StringIO()),
            patch.object(support, 'RECEIPT', Path(tmp) / 'results.jsonl'),
        ):
            self.assertEqual(gate.aggregate('fixture', expected, statuses), 0)
            self.assertEqual(gate.aggregate('fixture', expected, statuses | {'stripe': {'result': 'cancelled'}}), 1)
            self.assertEqual(gate.aggregate('fixture', expected | {'totals': {'main': len(counts) - 1}}, statuses), 1)
            counts.pop('sections')
            self.assertEqual(gate.aggregate('fixture', expected, statuses), 1)

    def test_matrix_jobs_have_disjoint_secret_boundaries(self):
        checks = set(gate.matrix(False)['lane'])
        stripe = set(gate.matrix(True)['lane'])
        self.assertFalse(checks & stripe)
        self.assertTrue(all(name.startswith('stripe-') for name in stripe))
        self.assertEqual(checks | stripe, set(gate.AUXILIARY) | set(browser.LANES))


if __name__ == '__main__':
    unittest.main()
