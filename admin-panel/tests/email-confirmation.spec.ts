/**
 * Delivered confirmation links and guest claims with local Supabase and Mailpit.
 * @see supabase/tests/claim-after-confirmation.sql
 */
import { randomUUID } from 'node:crypto';

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

import { acceptAllCookies } from './helpers/consent';
import { supabaseAdmin, setAuthSession } from './helpers/admin-auth';
import { extractMagicLink, waitForEmail } from './helpers/mailpit';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const baseUrl = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3777';

test.describe.configure({ mode: 'serial' });

for (const flow of ['login', 'post_checkout', 'password', 'subscription'] as const) {
  test(`${flow}: a delivered signup link confirms the address and claims the purchase`, async ({ page, request }) => {
    const id = randomUUID();
    const email = `confirmation-${id}@example.com`;
    const slug = `confirmation-${id}`;
    const password = 'Confirmation123!';
    let userId: string | undefined;
    const product = await supabaseAdmin.from('products').insert({ name: 'Confirmation course', slug, price: 10, currency: 'PLN', is_active: true, ...(flow === 'subscription' ? { product_type: 'subscription', billing_interval: 'month', billing_interval_count: 1, recurring_price: 10 } : {}) }).select('id').single();
    expect(product.error).toBeNull();
    const productId = product.data!.id;
    try {
      const sessionId = `cs_confirmation_${id.replaceAll('-', '')}`;
      const tx = await supabaseAdmin.from('payment_transactions').insert({ product_id: productId, customer_email: email, session_id: sessionId, amount: 1000, currency: 'PLN', status: 'completed', metadata: { full_name: 'Confirmed Buyer' } });
      expect(tx.error).toBeNull();
      const guest = await supabaseAdmin.from('guest_purchases').insert({ product_id: productId, customer_email: email, session_id: sessionId, transaction_amount: 1000 });
      expect(guest.error).toBeNull();
      if (flow === 'subscription') {
        const pending = await supabaseAdmin.auth.admin.createUser({ email, email_confirm: false });
        expect(pending.error).toBeNull();
        userId = pending.data.user!.id;
        const subscription = await supabaseAdmin.from('subscriptions').insert({ user_id: userId, product_id: productId, stripe_customer_id: `cus_confirmation_${id}`, stripe_subscription_id: `sub_confirmation_${id}`, status: 'active' }).select('id').single();
        expect(subscription.error).toBeNull();
        expect((await supabaseAdmin.from('user_product_access').insert({ user_id: userId, product_id: productId, subscription_id: subscription.data!.id })).error).toBeNull();
      }
      if (flow === 'password') {
        const client = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
        const signup = await client.auth.signUp({ email, password, options: { emailRedirectTo: `${baseUrl}/auth/callback?flow=login` } });
        expect(signup.error).toBeNull();
        expect(signup.data.session).toBeNull();
        userId = signup.data.user!.id;
        const login = await client.auth.signInWithPassword({ email, password });
        expect(login.error?.code).toBe('email_not_confirmed');
      } else {
        const sent = await request.post('/api/auth/magic-link', { data: { email, flow: flow === 'subscription' ? 'post_checkout' : flow, productSlug: flow === 'post_checkout' || flow === 'subscription' ? slug : undefined, captchaToken: 'test-token' } });
        expect(await sent.json()).toEqual({ ok: true });
      }
      const message = await waitForEmail(email);
      const link = extractMagicLink(message.HTML || message.Text || '');
      expect(link).not.toBeNull();
      const callback = new URL(link!);
      expect(callback.pathname).toBe('/auth/callback');
      expect(callback.searchParams.get('type')).toBe('signup');
      const user = await supabaseAdmin.rpc('find_user_id_by_email', { p_email: email });
      expect(user.error).toBeNull();
      userId = user.data!;
      const before = await supabaseAdmin.auth.admin.getUserById(userId!);
      expect(before.data.user?.email_confirmed_at).toBeFalsy();
      const accessBefore = await supabaseAdmin.from('user_product_access').select('id').eq('user_id', userId!).eq('product_id', productId);
      expect(accessBefore.data).toEqual([]);
      const paymentBefore = await supabaseAdmin.from('payment_transactions').select('user_id').eq('session_id', sessionId).single();
      expect(paymentBefore.data?.user_id).toBeNull();
      await acceptAllCookies(page);
      await page.goto(link!);
      await expect(page).toHaveURL(flow === 'post_checkout' || flow === 'subscription' ? /\/(p|checkout)\// : /\/(my-products|dashboard)/, { timeout: 30000 });
      const after = await supabaseAdmin.auth.admin.getUserById(userId!);
      expect(after.data.user?.email_confirmed_at).toBeTruthy();
      const accessAfter = await supabaseAdmin.from('user_product_access').select('id, subscription_id').eq('user_id', userId!).eq('product_id', productId);
      if (flow === 'subscription') expect(accessAfter.data?.[0]?.subscription_id).toBeTruthy();
      expect(accessAfter.data).toHaveLength(1);
      const claimed = await supabaseAdmin.from('guest_purchases').select('claimed_by_user_id').eq('session_id', sessionId).single();
      expect(claimed.data?.claimed_by_user_id).toBe(userId);
      const profile = await supabaseAdmin.from('profiles').select('full_name').eq('id', userId!).single();
      expect(profile.data?.full_name).toBe('Confirmed Buyer');
      if (flow === 'password') {
        const client = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
        expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull();
      }
    } finally {
      if (!userId) {
        const user = await supabaseAdmin.rpc('find_user_id_by_email', { p_email: email });
        userId = user.data ?? undefined;
      }
      await supabaseAdmin.from('guest_purchases').delete().eq('product_id', productId);
      await supabaseAdmin.from('payment_transactions').delete().eq('product_id', productId);
      await supabaseAdmin.from('subscriptions').delete().eq('product_id', productId);
      if (userId) await supabaseAdmin.auth.admin.deleteUser(userId);
      await supabaseAdmin.from('products').delete().eq('id', productId);
    }
  });
}

for (const provider of ['google', 'github']) {
  test(`${provider}: an already confirmed account claims purchases on creation`, async ({ page }) => {
    const id = randomUUID();
    const email = `confirmation-${id}@example.com`;
    const password = 'Confirmation123!';
    let userId: string | undefined;
    const product = await supabaseAdmin.from('products').insert({ name: 'OAuth course', slug: `confirmation-${id}`, price: 10, currency: 'PLN', is_active: true }).select('id').single();
    expect(product.error).toBeNull();
    const productId = product.data!.id;
    try {
      expect((await supabaseAdmin.from('guest_purchases').insert({ product_id: productId, customer_email: email, session_id: `cs_oauth_${id.replaceAll('-', '')}`, transaction_amount: 1000 })).error).toBeNull();
      const created = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { provider, providers: [provider] } });
      expect(created.error).toBeNull();
      userId = created.data.user!.id;
      expect(created.data.user!.email_confirmed_at).toBeTruthy();
      const access = await supabaseAdmin.from('user_product_access').select('id').eq('user_id', userId).eq('product_id', productId);
      expect(access.data).toHaveLength(1);
      await acceptAllCookies(page);
      await page.goto('/');
      await setAuthSession(page, email, password);
      await page.goto('/en/my-products');
      await expect(page.getByText('OAuth course').first()).toBeVisible();
    } finally {
      await supabaseAdmin.from('guest_purchases').delete().eq('product_id', productId);
      await supabaseAdmin.from('subscriptions').delete().eq('product_id', productId);
      if (userId) await supabaseAdmin.auth.admin.deleteUser(userId);
      await supabaseAdmin.from('products').delete().eq('id', productId);
    }
  });
}
