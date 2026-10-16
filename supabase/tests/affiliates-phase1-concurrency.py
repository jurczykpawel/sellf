"""Run against the disposable, seeded T0 database after affiliates-phase1.sql."""
import concurrent.futures
import subprocess
import unittest

CONTAINER = 'supabase_db_sellf-aff-t0'
ACTOR = 'dddddddd-0000-4000-a000-000000000000'
MEMBER = 'af000000-0000-4000-a000-000000000001'
PAYMENT = 'af000000-0000-4000-a000-000000000011'
PREFIX = "DO $$ BEGIN PERFORM set_config('request.jwt.claims','{\"role\":\"service_role\"}',false); END $$; "
RESERVE = f"SELECT id FROM public.affiliate_reserve('{ACTOR}','{MEMBER}','EUR',now(),1,1,'parallel-demo');"


def command(sql):
    return ['docker', 'exec', CONTAINER, 'psql', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', PREFIX + sql]


def run(sql):
    return subprocess.run(command(sql), capture_output=True, text=True, timeout=30)


class AffiliateConcurrency(unittest.TestCase):
    def test_reserve_reserve_refund(self):
        first = subprocess.Popen(command('BEGIN; ' + RESERVE + ' SELECT pg_sleep(1); COMMIT;'),
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            payout = first.stdout.readline().strip()
            self.assertRegex(payout, r'^[0-9a-f-]{36}$')
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                second = pool.submit(run, RESERVE)
                refund = pool.submit(run, f"UPDATE public.payment_transactions SET refunded_amount=6150 WHERE id='{PAYMENT}';")
                self.assertNotEqual(second.result().returncode, 0)
                self.assertEqual(refund.result().returncode, 0)
            _, error = first.communicate(timeout=10)
            self.assertEqual(first.returncode, 0, error)
            result = run(f"SELECT count(*)=1 AND bool_and(needs_review) FROM public.affiliate_payouts WHERE member_id='{MEMBER}' AND currency='EUR' AND status='reserved';")
            self.assertEqual(result.stdout.strip(), 't', result.stderr)
            result = run(f"SELECT sum(l.amount_minor)=2000 FROM public.affiliate_payout_allocations a JOIN public.affiliate_ledger l ON l.id=a.entry_id WHERE a.payout_id='{payout}' AND a.released_at IS NULL;")
            self.assertEqual(result.stdout.strip(), 't', result.stderr)
        finally:
            if first.poll() is None:
                first.kill()
                first.communicate()
            cleanup = run(f"SELECT public.affiliate_cancel_payout('{ACTOR}',id,version,true,'No transfer') FROM public.affiliate_payouts WHERE member_id='{MEMBER}' AND currency='EUR' AND status='reserved'; UPDATE public.payment_transactions SET refunded_amount=0 WHERE id='{PAYMENT}';")
            self.assertEqual(cleanup.returncode, 0, cleanup.stderr)


if __name__ == '__main__':
    unittest.main()
