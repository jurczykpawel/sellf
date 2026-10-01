import 'server-only';
import { getCaptchaConfig } from '@/lib/captcha/config';
import type { CaptchaConfig } from '@/lib/captcha/types';
import { getTrustedDownloadProviders } from '@/lib/trustedDownloadProviders';
import { getStripePublishableKey } from '@/lib/stripe/publishable-key';

export interface RuntimeAppConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  stripePublishableKey: string;
  captcha: CaptchaConfig;
  siteUrl: string;
  demoMode: boolean;
  passwordLoginEnabled: boolean;
  oauthProviders: string[];
  trustedDownloadDomains: string[];
}

export function buildRuntimeConfig(): RuntimeAppConfig {
  // DO NOT flip this precedence to prefer NEXT_PUBLIC_* — measured, not
  // theoretical: Next.js statically inlines every `process.env.NEXT_PUBLIC_*`
  // reference at BUILD time, in server bundles too, not just client ones.
  // build-release.yml (and the Dockerfile's non-fullstack path) build with
  // placeholder NEXT_PUBLIC_* values ("Dummy values for build - real values
  // loaded at runtime via /api/runtime-config" — see that workflow's build
  // step) specifically so the REAL value can be supplied later via the
  // server-only SUPABASE_URL/SUPABASE_ANON_KEY/SITE_URL, which are NOT
  // NEXT_PUBLIC_-prefixed and therefore stay a live process.env lookup at
  // request time. `NEXT_PUBLIC_X || SUPABASE_X` gets constant-folded by the
  // minifier the moment NEXT_PUBLIC_X is a non-empty build-time string —
  // confirmed by grepping a real production build's compiled output: the
  // /api/runtime-config handler had `supabaseUrl:"https://placeholder..."`
  // baked in as a literal, permanently, with the SUPABASE_URL fallback
  // eliminated as dead code. That breaks every Mikrus/Vercel/generic-tarball
  // install using the standard release pipeline.
  //
  // Deployments where SUPABASE_URL is internal-only (e.g. a self-hosted
  // Supabase behind Coolify's internal Docker network, reachable from the
  // server at http://kong:8000 but not from a browser) need a separate,
  // publicly reachable URL for the browser. PUBLIC_SUPABASE_URL fills that
  // gap: it is server-only (not
  // NEXT_PUBLIC_-prefixed, so it stays a live process.env read instead of
  // getting build-time inlined like the comment above describes) and only
  // affects this browser-facing value — server code keeps using
  // SUPABASE_URL directly wherever it already does.
  return {
    supabaseUrl:
      process.env.PUBLIC_SUPABASE_URL ||
      process.env.SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    stripePublishableKey: getStripePublishableKey(),
    captcha: getCaptchaConfig(),
    siteUrl: process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL!,
    demoMode: process.env.DEMO_MODE === 'true',
    passwordLoginEnabled:
      process.env.DEMO_MODE === 'true' || process.env.E2E_MODE === 'true',
    oauthProviders: (process.env.OAUTH_PROVIDERS || '')
      .split(',')
      .map((p) => p.trim().toLowerCase())
      .filter((p) =>
        ['google', 'github', 'discord', 'twitter', 'azure', 'facebook', 'apple'].includes(p),
      ),
    trustedDownloadDomains: [...getTrustedDownloadProviders()],
  };
}
