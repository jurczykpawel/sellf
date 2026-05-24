export const FEATURE_KEYS = [
  'dashboard',
  'payments',
  'subscriptions',
  'orderBumps',
  'oto',
  'embed',
  'checkoutTemplates',
  'coupons',
  'webhooks',
  'webhookRetry',
  'leads',
  'waitlist',
  'pwyw',
  'tipJar',
  'loginWall',
  'delivery',
  'omnibus',
  'saleLimits',
  'funnels',
  'refunds',
  'security',
  'gus',
  'magicLink',
  'mcp',
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const USE_CASE_KEYS = ['courses', 'subscriptions', 'digital', 'leads'] as const;
export type UseCaseKey = (typeof USE_CASE_KEYS)[number];

export const TIER_KEYS = ['free', 'registered', 'pro', 'business'] as const;
export type TierKey = (typeof TIER_KEYS)[number];
