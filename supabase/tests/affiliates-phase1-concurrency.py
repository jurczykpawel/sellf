"""Run against the disposable, seeded T0 database after affiliates-phase1.sql."""
import concurrent.futures
import os
import subprocess
import time
import unittest

CONTAINER = os.environ.get('AFFILIATE_TEST_CONTAINER', 'supabase_db_sellf-aff-t0')
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
    def wait_for_lock_holder(self, name):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            result = run(f"SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='{name}' AND wait_event='PgSleep')")
            if result.stdout.strip() == 't':
                return
        self.fail('Lock holder was not ready')

    def test_held_history_does_not_block_reserve(self):
        held = 'af000000-0000-4000-a000-000000000012'
        blocker = subprocess.Popen(command(f"SET application_name='affiliate-held-fixture'; BEGIN; SELECT id FROM public.payment_transactions WHERE id='{held}' FOR UPDATE; SELECT pg_sleep(3); ROLLBACK;"),
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            self.wait_for_lock_holder('affiliate-held-fixture')
            result = run("SET lock_timeout='500ms'; " + RESERVE.replace("'EUR'", "'PLN'"))
            self.assertEqual(result.returncode, 0, result.stderr)
        finally:
            blocker.communicate(timeout=5)
            cleanup = run(f"SELECT public.affiliate_cancel_payout('{ACTOR}',id,version,true,'No transfer') FROM public.affiliate_payouts WHERE member_id='{MEMBER}' AND currency='PLN' AND status='reserved';")
            self.assertEqual(cleanup.returncode, 0, cleanup.stderr)

    def test_pending_generation_remains_in_lock_scope(self):
        held = 'af000000-0000-4000-a000-000000000012'
        self.assertEqual(run(f"UPDATE payment_transactions SET refunded_amount=1 WHERE id='{held}'").returncode, 0)
        blocker = subprocess.Popen(command(f"SET application_name='affiliate-pending-fixture'; BEGIN; SELECT id FROM public.payment_transactions WHERE id='{held}' FOR UPDATE; SELECT pg_sleep(3); ROLLBACK;"),
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            self.wait_for_lock_holder('affiliate-pending-fixture')
            result = run("SET lock_timeout='500ms'; " + RESERVE.replace("'EUR'", "'PLN'"))
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('lock timeout', result.stderr)
        finally:
            blocker.communicate(timeout=5)
            cleanup = run(f"UPDATE payment_transactions SET refunded_amount=0 WHERE id='{held}'; SELECT affiliate_apply_sync(payment_id,lease_token,requested_generation,'2026-01-02',true) FROM affiliate_claim_work(100);")
            self.assertEqual(cleanup.returncode, 0, cleanup.stderr)

    def test_reserve_reserve_refund(self):
        first = subprocess.Popen(command("SET application_name='affiliate-reserve-fixture'; BEGIN; " + RESERVE + ' SELECT pg_sleep(3); COMMIT;'),
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            self.wait_for_lock_holder('affiliate-reserve-fixture')
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                second = pool.submit(run, RESERVE)
                refund = pool.submit(run, f"UPDATE public.payment_transactions SET refunded_amount=6150 WHERE id='{PAYMENT}';")
                self.assertNotEqual(second.result().returncode, 0)
                self.assertEqual(refund.result().returncode, 0)
            output, error = first.communicate(timeout=10)
            self.assertEqual(first.returncode, 0, error)
            payout = output.splitlines()[0]
            self.assertRegex(payout, r'^[0-9a-f-]{36}$')
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
