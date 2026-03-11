import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

/**
 * ============================================================================
 * SECURITY TEST: Partial vs Full Refund — Access Revocation Logic
 * ============================================================================
 *
 * VULNERABILITY: All refund endpoints blindly revoked access on ANY refund
 * (V-CRITICAL-07), including partial refunds. This meant a $1 partial refund
 * on a $100 product would revoke the customer's access entirely.
 *
 * Additionally, the webhook handler always set status='refunded' regardless
 * of partial/full, and the v1 API used 'partially_refunded' status which
 * violates the DB constraint CHECK (status IN ('completed','refunded','disputed')).
 *
 * FIX:
 * - All endpoints now check isFullRefund before revoking access
 * - Partial refunds keep status='completed' with refunded_amount tracking
 * - Only full refunds set status='refunded' and revoke access
 * - Server Action fixed: removed erroneous amount * 100 (DB stores cents)
 *
 * SOURCE_TEXT_VERIFY: These tests read production source to verify the
 * partial-vs-full refund logic is present in all refund code paths.
 * ============================================================================
 */

// ===== LOAD REAL PRODUCTION SOURCE CODE =====

const webhookPath = join(__dirname, '../../../src/app/api/webhooks/stripe/route.ts');
const webhookSource = readFileSync(webhookPath, 'utf-8');

const serverActionPath = join(__dirname, '../../../src/lib/actions/payment.ts');
const serverActionSource = readFileSync(serverActionPath, 'utf-8');

const adminRefundPath = join(__dirname, '../../../src/app/api/admin/payments/refund/route.ts');
const adminRefundSource = readFileSync(adminRefundPath, 'utf-8');

const v1RefundPath = join(__dirname, '../../../src/app/api/v1/payments/[id]/refund/route.ts');
const v1RefundSource = readFileSync(v1RefundPath, 'utf-8');

describe('Partial vs Full Refund Security', () => {
  describe('Webhook handler (charge.refunded)', () => {
    it('determines full vs partial refund from charge amounts', () => {
      expect(webhookSource).toContain('charge.amount_refunded >= charge.amount');
    });

    it('sets status to refunded only on full refund', () => {
      expect(webhookSource).toContain("isFullRefund ? 'refunded' : 'completed'");
    });

    it('skips access revocation on partial refund', () => {
      expect(webhookSource).toContain('if (!isFullRefund)');
      expect(webhookSource).toMatch(/if \(!isFullRefund\)\s*\{[\s\S]*?return/);
    });

    it('delegates access revocation to shared revokeTransactionAccess()', () => {
      expect(webhookSource).toContain('revokeTransactionAccess');
      expect(webhookSource).toContain("from '@/lib/services/access-revocation'");
    });
  });

  describe('Server Action (processRefund)', () => {
    it('does NOT multiply amount by 100 (DB already stores cents)', () => {
      // The old bug: amount: Math.round(refundAmount * 100)
      expect(serverActionSource).not.toContain('refundAmount * 100');
      expect(serverActionSource).not.toContain('* 100');
    });

    it('passes amount directly to Stripe (already in cents)', () => {
      expect(serverActionSource).toContain('amount: refundAmount');
    });

    it('checks isFullRefund before revoking access', () => {
      expect(serverActionSource).toContain('isFullRefund');
      expect(serverActionSource).toContain("isFullRefund ? 'refunded' : 'completed'");
    });

    it('only revokes access on full refund via shared function', () => {
      expect(serverActionSource).toContain('isFullRefund');
      expect(serverActionSource).toContain('revokeTransactionAccess');
    });
  });

  describe('Admin API (/api/admin/payments/refund)', () => {
    it('determines full vs partial refund', () => {
      expect(adminRefundSource).toContain('isFullRefund');
      expect(adminRefundSource).toContain('totalRefunded >= transaction.amount');
    });

    it('sets correct status based on refund type', () => {
      expect(adminRefundSource).toContain("isFullRefund ? 'refunded' : 'completed'");
    });

    it('does NOT use partially_refunded status (violates DB constraint)', () => {
      expect(adminRefundSource).not.toContain('partially_refunded');
    });

    it('only revokes access on full refund', () => {
      expect(adminRefundSource).toMatch(/if \(isFullRefund\)\s*\{/);
    });
  });

  describe('V1 API (/api/v1/payments/:id/refund)', () => {
    it('determines full vs partial refund', () => {
      expect(v1RefundSource).toContain('isFullRefund');
      expect(v1RefundSource).toContain('totalRefunded >= payment.amount');
    });

    it('does NOT use partially_refunded status (violates DB constraint)', () => {
      expect(v1RefundSource).not.toContain('partially_refunded');
    });

    it('only revokes access on full refund', () => {
      expect(v1RefundSource).toMatch(/if \(isFullRefund\)\s*\{/);
    });

    it('sets correct status based on refund type', () => {
      expect(v1RefundSource).toContain("isFullRefund ? 'refunded' : 'completed'");
    });
  });
});
