import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Cancel/Resume endpoints used to wait for customer.subscription.updated
// webhook to mirror cancel_at_period_end into our DB. That left a window
// where the UI refetch landed before the webhook, returning stale data —
// users had to click twice (or refresh) to see the new state. The endpoints
// now mirror the change locally right after Stripe accepts the update; the
// webhook still re-upserts idempotently.

function read(rel: string): string {
  return readFileSync(resolve(__dirname, '../../', rel), 'utf-8');
}

describe('subscription cancel/resume mirror DB write before returning', () => {
  it.each([
    ['cancel', true],
    ['resume', false],
  ] as const)('%s endpoint sets cancel_at_period_end=%s in DB after Stripe success', (action, expected) => {
    const source = read(`src/app/api/subscriptions/[id]/${action}/route.ts`);
    expect(source).toMatch(/\.from\(['"]subscriptions['"]\)[\s\S]+?\.update\(\{[\s\S]+?cancel_at_period_end:\s*(true|false)/);
    const updateBlock = source.match(/\.update\(\{[\s\S]+?\}\)/);
    expect(updateBlock).not.toBeNull();
    expect(updateBlock![0]).toContain(`cancel_at_period_end: ${expected}`);
    expect(updateBlock![0]).toContain('updated_at:');
  });

  it.each(['cancel', 'resume'] as const)('%s endpoint scopes update by id AND user_id (no cross-tenant write)', (action) => {
    const source = read(`src/app/api/subscriptions/[id]/${action}/route.ts`);
    expect(source).toMatch(/\.eq\(['"]id['"],\s*id\)[\s\S]+?\.eq\(['"]user_id['"],\s*user\.id\)/);
  });

  it.each(['cancel', 'resume'] as const)('%s endpoint calls Stripe BEFORE mirroring DB (Stripe is authoritative)', (action) => {
    const source = read(`src/app/api/subscriptions/[id]/${action}/route.ts`);
    const stripeIdx = source.indexOf('stripe.subscriptions.update(');
    const mirrorIdx = source.indexOf("adminSupabase\n    .from('subscriptions')\n    .update(");
    expect(stripeIdx).toBeGreaterThan(-1);
    expect(mirrorIdx).toBeGreaterThan(-1);
    expect(stripeIdx).toBeLessThan(mirrorIdx);
  });

  it.each(['cancel', 'resume'] as const)('%s endpoint uses createAdminClient (RLS only grants SELECT to authenticated)', (action) => {
    const source = read(`src/app/api/subscriptions/[id]/${action}/route.ts`);
    expect(source).toContain("import { createAdminClient } from '@/lib/supabase/admin'");
    // Update must run through service-role client, not the user-side supabase.
    expect(source).toMatch(/adminSupabase\s*=\s*createAdminClient\(\)/);
    expect(source).toMatch(
      /adminSupabase\s*\n?\s*\.from\(['"]subscriptions['"]\)\s*\n?\s*\.update/,
    );
  });

  it.each(['cancel', 'resume'] as const)('%s endpoint does NOT fire WebhookService.trigger (avoids double delivery)', (action) => {
    // Stripe.subscriptions.update() already triggers customer.subscription.updated,
    // which the Stripe webhook handler converts to a single outgoing 'subscription.updated'
    // delivery. Firing the same outgoing webhook again from here would double-deliver.
    const source = read(`src/app/api/subscriptions/[id]/${action}/route.ts`);
    expect(source).not.toMatch(/WebhookService\.trigger/);
    expect(source).not.toMatch(/triggerWebhook|fireWebhook/);
  });
});
