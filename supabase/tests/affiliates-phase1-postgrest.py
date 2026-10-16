"""HTTP regression test on the disposable, seeded sellf-aff-t0fix stack."""
import json
import subprocess
import unittest
import urllib.error
import urllib.request


class AffiliatePostgrest(unittest.TestCase):
    def test_stale_member_version_returns_conflict(self):
        status = subprocess.run(
            ['supabase', 'status', '--workdir', '/private/tmp/sellf-aff-t0fix', '--output', 'json'],
            capture_output=True, text=True, check=True, timeout=30,
        )
        key = json.loads(status.stdout)['SERVICE_ROLE_KEY']
        request = urllib.request.Request(
            'http://127.0.0.1:55501/rest/v1/rpc/affiliate_member_update',
            data=json.dumps({
                'p_actor': 'dddddddd-0000-4000-a000-000000000000',
                'p_member': 'af000000-0000-4000-a000-000000000001',
                'p_expected_version': 0,
                'p_status': 'approved',
                'p_reason': 'Version conflict test',
            }).encode(),
            headers={'apikey': key, 'Authorization': f'Bearer {key}',
                     'Content-Type': 'application/json'},
            method='POST',
        )
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                self.fail(f'Expected HTTP 409, received {response.status}')
        except urllib.error.HTTPError as error:
            with error:
                self.assertEqual(error.code, 409)
                body = json.load(error)
            self.assertEqual(body['code'], 'PT409')
            self.assertEqual(body['message'], 'Version changed')
        except TimeoutError:
            self.fail('Conflicting RPC timed out instead of returning HTTP 409')


if __name__ == '__main__':
    unittest.main()
