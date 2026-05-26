-- ============================================================================
-- SECURITY FIX: Revoke PUBLIC execute on process_stripe_payment_completion_with_bump
-- ============================================================================
--
-- VULNERABILITY (CRITICAL):
-- Migration 20260515180000_payment_completion_idempotent_by_pi.sql created
-- a new wrapper function public.process_stripe_payment_completion_with_bump
-- but the REVOKE from PUBLIC was omitted. PostgreSQL grants EXECUTE to PUBLIC
-- by default on new functions, and ALTER DEFAULT PRIVILEGES from migration
-- 20260302000000 did not take effect for this function.
--
-- IMPACT:
-- Any unauthenticated (anon) or authenticated non-admin user could call this
-- function directly via Supabase REST API (/rest/v1/rpc/...) with a fake
-- session_id and stripe_payment_intent_id to:
--   1. Create a completed payment_transaction record without paying
--   2. Create a guest_purchase / user_product_access row granting access
--
-- Confirmed exploitable: 2026-05-20 during internal pentest.
--
-- FIX:
-- Explicitly REVOKE EXECUTE FROM PUBLIC, anon, authenticated on both
-- public and public schema variants of the function.
-- ============================================================================

-- Fix: public wrapper (the one with PUBLIC execute discovered by pentest)
REVOKE EXECUTE ON FUNCTION public.process_stripe_payment_completion_with_bump(
  TEXT, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, UUID[], UUID
) FROM PUBLIC, anon, authenticated;

-- Ensure service_role still has access
GRANT EXECUTE ON FUNCTION public.process_stripe_payment_completion_with_bump(
  TEXT, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, UUID[], UUID
) TO service_role;

-- Fix: public schema proxy (belt-and-suspenders — it was already revoked in
-- 20260310180000 but re-confirm after any CREATE OR REPLACE)
REVOKE EXECUTE ON FUNCTION public.process_stripe_payment_completion_with_bump(
  TEXT, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, UUID[], UUID
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.process_stripe_payment_completion_with_bump(
  TEXT, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, UUID[], UUID
) TO service_role;

-- Also fix the original process_stripe_payment_completion (belt-and-suspenders)
REVOKE EXECUTE ON FUNCTION public.process_stripe_payment_completion(
  TEXT, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.process_stripe_payment_completion(
  TEXT, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID
) TO service_role;

-- Preventive: ensure ALTER DEFAULT PRIVILEGES is set so future functions
-- in public do NOT get PUBLIC execute
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM authenticated;
