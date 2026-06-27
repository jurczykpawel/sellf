/**
 * Telemetry collectors. Three independent reads, each fail-safe (a DB hiccup or
 * missing config never throws — it degrades to a safe default) so the caller can
 * always assemble a valid envelope.
 *
 *  - collectMetrics()    — one RPC round-trip; all counts, clamped to >= 0.
 *  - collectDeployment() — coarsened runtime facts (node:os) + integration/config
 *                          flags bound to their REAL sources. Deliberately omits
 *                          node_env, raw mem_total_mb and the raw runtime version.
 *  - collectLicenseTier()— the resolved Sellf license tier.
 *
 * Flag SOURCES (verified against the live schema, not assumed):
 *   tax_mode / default_currency / omnibus_enabled  -> public.shop_config (singleton)
 *   stripe_mode                                     -> public.stripe_configurations (active row)
 *   embed_enabled / subscriptions_enabled           -> public.products counts
 *   license_keys_enabled                            -> public.seller_license_keys (active)
 *   gtm / meta_pixel / umami / facebook_capi /
 *     google_ads / currency_api                     -> public.integrations_config (id=1)
 *   captcha_provider                                -> getCaptchaProvider() (env-derived)
 *   oauth_providers_count                           -> OAUTH_PROVIDERS env (runtime-config source)
 *   registration_enabled                            -> REGISTRATION_ENABLED env (see note below)
 *
 * @see ./coarsen.ts — bucketing of host facts
 * @see supabase/migrations/20260627120000_telemetry.sql — get_telemetry_metrics RPC
 */

import os from 'node:os';

import { getCaptchaProvider } from '@/lib/captcha/config';
import { resolveCurrentTier } from '@/lib/license/resolve';
import { createAdminClient } from '@/lib/supabase/admin';
import { APP_VERSION } from '@/lib/version';

import { cpuBucket, majorVersion, memBucket } from './coarsen';

const MAX = 1_000_000_000;
const clamp = (n: unknown): number => {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.trunc(n) : 0;
  return Math.min(Math.max(v, 0), MAX);
};

export async function collectMetrics(): Promise<Record<string, number>> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc('get_telemetry_metrics');
    if (error || !data) throw error ?? new Error('no data');
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) out[k] = clamp(v);
    return out;
  } catch {
    return {}; // safe default — a DB hiccup still yields a valid (empty) envelope
  }
}

/** DB- and env-derived integration/config flags, bound to the real config sources. */
async function collectFlags(): Promise<Record<string, unknown>> {
  const supabase = createAdminClient();

  // shop_config is a singleton; order+limit makes the read robust if a stray row exists.
  const { data: shop } = await supabase
    .from('shop_config')
    .select('tax_mode, default_currency, omnibus_enabled')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  // integrations_config is the singleton id=1 holding all tracking/integration toggles.
  const { data: integrations } = await supabase
    .from('integrations_config')
    .select(
      'gtm_container_id, gtm_ss_enabled, facebook_pixel_id, fb_capi_enabled, umami_website_id, google_ads_conversion_id, currency_api_enabled',
    )
    .eq('id', 1)
    .maybeSingle();

  const { data: stripe } = await supabase
    .from('stripe_configurations')
    .select('mode')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  const { count: embed } = await supabase
    .from('products')
    .select('id', { head: true, count: 'exact' })
    .eq('embed_enabled', true);
  const { count: subs } = await supabase
    .from('products')
    .select('id', { head: true, count: 'exact' })
    .eq('product_type', 'subscription');
  const { count: licKeys } = await supabase
    .from('seller_license_keys')
    .select('id', { head: true, count: 'exact' })
    .eq('is_active', true);

  // Mirror runtime-config.ts: lowercase + filter to the supported provider allow-list
  // so the count reflects actual active OAuth providers, not arbitrary env noise.
  const oauthProviders = (process.env.OAUTH_PROVIDERS ?? '')
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter((p) =>
      ['google', 'github', 'discord', 'twitter', 'azure', 'facebook', 'apple'].includes(p),
    );

  return {
    stripe_mode: stripe?.mode ?? 'off',
    tax_mode: shop?.tax_mode ?? 'none',
    default_currency: shop?.default_currency ?? null,
    omnibus_enabled: Boolean(shop?.omnibus_enabled),
    embed_enabled: (embed ?? 0) > 0,
    subscriptions_enabled: (subs ?? 0) > 0,
    license_keys_enabled: (licKeys ?? 0) > 0,
    // No in-app registration toggle exists yet (registration is always open via magic
    // link). Bind to an ops env so it reflects reality and is forward-compatible.
    // TODO: rebind if a DB/config-level "disable signups" toggle is ever added.
    registration_enabled: process.env.REGISTRATION_ENABLED !== 'false',
    gtm: Boolean(integrations?.gtm_container_id) || Boolean(integrations?.gtm_ss_enabled),
    meta_pixel: Boolean(integrations?.facebook_pixel_id),
    umami: Boolean(integrations?.umami_website_id),
    facebook_capi: Boolean(integrations?.fb_capi_enabled),
    google_ads: Boolean(integrations?.google_ads_conversion_id),
    currency_api: Boolean(integrations?.currency_api_enabled),
    captcha_provider: getCaptchaProvider(),
    oauth_providers_count: oauthProviders.length,
  };
}

export async function collectDeployment(): Promise<Record<string, unknown>> {
  let flags: Record<string, unknown> = {};
  try {
    flags = await collectFlags();
  } catch {
    flags = {};
  }
  return {
    app_version: APP_VERSION,
    runtime: 'node',
    runtime_version_major: majorVersion(process.version),
    os: os.platform(),
    arch: os.arch(),
    cpu_bucket: cpuBucket(os.cpus().length),
    mem_bucket: memBucket(Math.round(os.totalmem() / (1024 * 1024))),
    ...flags,
  };
}

export async function collectLicenseTier(): Promise<string | null> {
  try {
    return await resolveCurrentTier();
  } catch {
    return null;
  }
}
