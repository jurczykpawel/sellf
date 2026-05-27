import { getTranslations } from 'next-intl/server';
import { Check } from 'lucide-react';
import { Reveal } from '@/components/motion/Reveal';
import { TIER_KEYS, type TierKey } from '@/lib/landing/feature-keys';

const TSA_SHOP = 'https://sellf.techskills.academy';

interface TierAction {
  href: string;
  external: boolean;
}

// Business intentionally goes to a mailto contact — not a paid product.
// The Business-tier features (RBAC, SSO, advanced analytics) aren't
// implemented in code yet, so selling a fixed-price product would be vapor.
// Everything Business is negotiated 1-on-1.
const TIER_ACTIONS: Record<TierKey, TierAction> = {
  free:       { href: '#deploy-paths',                  external: false },
  registered: { href: `${TSA_SHOP}/p/sellf-registered`, external: true  },
  pro:        { href: `${TSA_SHOP}/p/sellf-pro`,        external: true  },
  business:   { href: 'mailto:hello@sellf.app?subject=Sellf%20Business%20%E2%80%94%20inquiry', external: false },
};

type RowKey =
  | 'products'
  | 'buyers'
  | 'payments'
  | 'webhooks'
  | 'csvExport'
  | 'watermark'
  | 'themes'
  | 'apiScopes';

const ROW_KEYS: RowKey[] = [
  'products',
  'buyers',
  'payments',
  'webhooks',
  'csvExport',
  'watermark',
  'themes',
  'apiScopes',
];

const MATRIX: Record<RowKey, Record<TierKey, boolean>> = {
  products:   { free: true,  registered: true,  pro: true,  business: true  },
  buyers:     { free: true,  registered: true,  pro: true,  business: true  },
  payments:   { free: true,  registered: true,  pro: true,  business: true  },
  webhooks:   { free: true,  registered: true,  pro: true,  business: true  },
  csvExport:  { free: false, registered: true,  pro: true,  business: true  },
  watermark:  { free: false, registered: false, pro: true,  business: true  },
  themes:     { free: false, registered: false, pro: true,  business: true  },
  apiScopes:  { free: false, registered: false, pro: true,  business: true  },
};

export async function LicenseTier() {
  const t = await getTranslations('landing.licenseTier');

  return (
    <section data-landing-section="license-tier" className="py-24 md:py-32 bg-sf-base">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <Reveal className="text-center mb-12">
          <p className="text-sm font-medium text-sf-muted tracking-[0.08em] uppercase mb-3">
            {t('categoryLabel')}
          </p>
          <h2 className="text-4xl md:text-5xl font-bold text-sf-heading mb-4">
            {t('title')}
          </h2>
          <p className="text-xl text-sf-body max-w-3xl mx-auto">
            {t('subtitle')}
          </p>
        </Reveal>

        <Reveal animation="fade-up" delay={100}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {TIER_KEYS.map((tier) => {
              const isPro = tier === 'pro';
              return (
                <div
                  key={tier}
                  data-tier={tier}
                  data-shimmer={isPro ? 'true' : 'false'}
                  className={`relative rounded-2xl border p-6 flex flex-col gap-3 bg-sf-raised/80 ${
                    isPro
                      ? 'border-sf-accent tier-shimmer'
                      : 'border-sf-border-accent'
                  }`}
                >
                  <div className="relative z-10 flex flex-col gap-3 h-full">
                    <span className="text-xs font-mono uppercase tracking-wider text-sf-muted">
                      {t(`${tier}.name`)}
                    </span>
                    <h3 className="text-2xl font-bold text-sf-heading">
                      {t(`${tier}.name`)}
                    </h3>
                    {/* Pricing — visible per tier, no hidden costs */}
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-black text-sf-heading">
                        {t(`${tier}.price`)}
                      </span>
                      <span className="text-xs text-sf-muted">
                        {t(`${tier}.priceNote`)}
                      </span>
                    </div>
                    <p className="text-sm text-sf-body min-h-[5rem]">
                      {t(`${tier}.tagline`)}
                    </p>
                    <ul className="space-y-2 text-sm flex-1">
                      {ROW_KEYS.map((row) => {
                        const has = MATRIX[row][tier];
                        return (
                          <li
                            key={row}
                            data-row={row}
                            data-included={has ? 'yes' : 'no'}
                            className={`flex items-center gap-2 ${
                              has
                                ? 'text-sf-body'
                                : 'text-sf-muted/50 line-through'
                            }`}
                          >
                            <Check
                              className={`h-3 w-3 shrink-0 ${
                                has ? 'text-sf-accent' : 'text-transparent'
                              }`}
                              aria-hidden="true"
                            />
                            <span>{t(`rows.${row}`)}</span>
                          </li>
                        );
                      })}
                    </ul>
                    {(() => {
                      const action = TIER_ACTIONS[tier];
                      const externalProps = action.external
                        ? { target: '_blank' as const, rel: 'noopener noreferrer' }
                        : {};
                      return (
                        <a
                          href={action.href}
                          {...externalProps}
                          className="mt-2 w-full inline-flex items-center justify-center gap-2 bg-sf-accent text-white rounded-lg py-2 font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent-hover transition-colors hover:bg-sf-accent-hover"
                        >
                          {t(`${tier}.cta`)}
                        </a>
                      );
                    })()}
                  </div>
                </div>
              );
            })}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
