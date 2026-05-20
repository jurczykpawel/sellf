import 'server-only';
import { getCaptchaConfig } from '@/lib/captcha/config';
import type { CaptchaConfig } from '@/lib/captcha/types';

export interface RuntimeAppConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  stripePublishableKey: string;
  captcha: CaptchaConfig;
  siteUrl: string;
  demoMode: boolean;
  passwordLoginEnabled: boolean;
  oauthProviders: string[];
}

export function buildRuntimeConfig(): RuntimeAppConfig {
  return {
    supabaseUrl: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    stripePublishableKey:
      process.env.STRIPE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!,
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
  };
}
