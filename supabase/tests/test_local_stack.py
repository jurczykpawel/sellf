"""Local integration-stack lifecycle contracts."""
import io
import os
import subprocess
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch
import local_stack


class Response:
    status = 200
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def read(self): return b'[]'


class ApiReadiness(unittest.TestCase):
    def setUp(self):
        self.target = patch.dict(os.environ, {'SUPABASE_URL': 'http://127.0.0.1:55321'})
        self.target.start()
        self.addCleanup(self.target.stop)

    def test_waits_for_both_read_paths_after_transport_and_startup_responses(self):
        requests = []
        responses = [ConnectionResetError(), Response(), urllib.error.HTTPError('local', 503, 'starting', {}, io.BytesIO()), Response(), Response()]
        def open_request(request, **kwargs):
            requests.append(request)
            result = responses.pop(0)
            if isinstance(result, Exception): raise result
            return result
        with patch.object(local_stack, 'urlopen', side_effect=open_request), patch.object(local_stack.time, 'sleep'):
            local_stack.wait_for_test_api('http://127.0.0.1:55321', 'fixture-key')
        self.assertEqual(len(requests), 5)
        self.assertTrue(all(request.get_method() == 'GET' for request in requests))
        self.assertEqual(requests[-1].full_url, 'http://127.0.0.1:55321/rest/v1/admin_users?select=id&limit=0')

    def test_reports_a_bounded_readiness_failure(self):
        ticks = [0.0]
        with patch.object(local_stack, 'urlopen', side_effect=ConnectionResetError()), patch.object(local_stack.time, 'monotonic', side_effect=lambda: ticks[0]), patch.object(local_stack.time, 'sleep', side_effect=lambda delay: ticks.__setitem__(0, ticks[0] + delay)):
            with self.assertRaises(TimeoutError):
                local_stack.wait_for_test_api('http://127.0.0.1:55321', 'fixture-key', timeout=1, interval=0.25)
        self.assertEqual(ticks[0], 1)

    def test_returns_authentication_errors_without_polling(self):
        error = urllib.error.HTTPError('local', 401, 'invalid key', {}, io.BytesIO())
        with patch.object(local_stack, 'urlopen', side_effect=error), patch.object(local_stack.time, 'sleep') as sleep:
            with self.assertRaises(urllib.error.HTTPError):
                local_stack.wait_for_test_api('http://127.0.0.1:55321', 'fixture-key')
        sleep.assert_not_called()

    def test_declines_a_different_target_before_network_access(self):
        with patch.object(local_stack, 'urlopen') as open_request:
            with self.assertRaises(ValueError): local_stack.wait_for_test_api('https://elsewhere.test', 'fixture-key')
        open_request.assert_not_called()


class DatabaseReset(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.workdir = Path(self.tmp.name)
        (self.workdir/'supabase').mkdir()
        (self.workdir/'supabase/config.toml').write_text('project_id = "sellf-fixture"\n[api]\nport = 55321\n')
        self.environment = patch.dict(os.environ, {'SUPABASE_URL': 'http://127.0.0.1:55321', 'SUPABASE_CLI_BINARY_OVERRIDE': '/fixture/supabase'})
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def test_stops_the_matching_writer_before_reset_and_restores_it_before_readiness(self):
        calls = []
        def run(command, **kwargs):
            calls.append(command)
            if command[:2] == ['docker', 'inspect']: return subprocess.CompletedProcess(command, 0, 'true\n', '')
            if command[0] == '/fixture/supabase' and command[1] == 'status': return subprocess.CompletedProcess(command, 0, '{"API_URL":"http://127.0.0.1:55321","SERVICE_ROLE_KEY":"fixture-key"}', '')
            return subprocess.CompletedProcess(command, 0, '', '')
        with patch.object(local_stack, 'get_test_database_container', return_value='supabase_db_sellf-fixture'), patch.object(local_stack.subprocess, 'run', side_effect=run), patch.object(local_stack, 'wait_for_test_api', side_effect=lambda *args: calls.append(['ready'])):
            local_stack.reset_test_database(str(self.workdir))
        stop = calls.index(['docker', 'stop', 'supabase_realtime_sellf-fixture'])
        reset = next(index for index, command in enumerate(calls) if command[:3] == ['/fixture/supabase', 'db', 'reset'])
        resume = calls.index(['docker', 'start', 'supabase_realtime_sellf-fixture'])
        self.assertLess(stop, reset)
        self.assertLess(reset, resume)
        self.assertLess(resume, calls.index(['ready']))

    def test_restores_the_writer_and_preserves_the_reset_error(self):
        calls = []
        def run(command, **kwargs):
            calls.append(command)
            if command[:2] == ['docker', 'inspect']: return subprocess.CompletedProcess(command, 0, 'true\n', '')
            if command[:3] == ['/fixture/supabase', 'db', 'reset']: raise subprocess.CalledProcessError(9, command)
            return subprocess.CompletedProcess(command, 0, '', '')
        with patch.object(local_stack, 'get_test_database_container', return_value='supabase_db_sellf-fixture'), patch.object(local_stack.subprocess, 'run', side_effect=run), patch.object(local_stack, 'wait_for_test_api') as ready:
            with self.assertRaises(subprocess.CalledProcessError) as error: local_stack.reset_test_database(str(self.workdir))
        self.assertEqual(error.exception.returncode, 9)
        self.assertIn(['docker', 'start', 'supabase_realtime_sellf-fixture'], calls)
        ready.assert_not_called()

    def test_declines_the_shared_project_before_running_commands(self):
        (self.workdir/'supabase/config.toml').write_text('project_id = "sellf"\n[api]\nport = 55321\n')
        with patch.object(local_stack.subprocess, 'run') as run:
            with self.assertRaises(ValueError): local_stack.reset_test_database(str(self.workdir))
        run.assert_not_called()

    def test_requires_the_container_to_match_the_project_before_running_commands(self):
        with patch.object(local_stack, 'get_test_database_container', return_value='supabase_db_other'), patch.object(local_stack.subprocess, 'run') as run:
            with self.assertRaises(ValueError): local_stack.reset_test_database(str(self.workdir))
        run.assert_not_called()


if __name__ == '__main__': unittest.main()
