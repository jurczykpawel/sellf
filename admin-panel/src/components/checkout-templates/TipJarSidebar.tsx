import { getTranslations, getFormatter } from 'next-intl/server';
import type { Product } from '@/types';
import { formatPrice } from '@/lib/constants';
import { getRecentSupporters } from '@/lib/checkout-templates/recent-supporters';

interface TipJarSidebarProps {
  product: Product;
}

function relativeTimeKey(when: string): { key: 'justNow' | 'minutesAgo' | 'hoursAgo' | 'daysAgo'; value?: number } {
  const diffMs = Date.now() - new Date(when).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return { key: 'justNow' };
  if (minutes < 60) return { key: 'minutesAgo', value: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { key: 'hoursAgo', value: hours };
  const days = Math.floor(hours / 24);
  return { key: 'daysAgo', value: days };
}

// Server-rendered sidebar for the tip-jar checkout template.
//
// BMC-style: header (icon + name + supporters count), About section
// (product.long_description as plain text — no Markdown rendering in v1),
// Recent supporters list (anonymized names + amount + relative time).
//
// Data is fetched server-side via the SAME loader as the public API
// endpoint, so the cache layer (unstable_cache + revalidateTag) is shared.
export default async function TipJarSidebar({ product }: TipJarSidebarProps) {
  const [t, tActions, formatter, supporters] = await Promise.all([
    getTranslations('tipJar'),
    getTranslations('supporterActions'),
    getFormatter(),
    getRecentSupporters(product.slug),
  ]);

  const totalCount = supporters?.totalCount ?? 0;
  const list = supporters?.supporters ?? [];

  return (
    <aside className="w-full lg:max-w-md flex flex-col gap-6">
      <header className="flex items-center gap-3">
        <span className="text-5xl leading-none" aria-hidden="true">
          {product.icon || '☕'}
        </span>
        <div>
          <h1 className="text-2xl font-bold text-sf-heading tracking-tight">
            {product.name}
          </h1>
          <p className="text-sm text-sf-muted">
            {t('supportersCount', { count: totalCount })}
          </p>
        </div>
      </header>

      {product.long_description ? (
        <section
          aria-labelledby="tipjar-about-heading"
          className="bg-sf-raised border border-sf-border rounded-2xl p-5"
        >
          <h2
            id="tipjar-about-heading"
            className="text-xs font-semibold uppercase tracking-widest text-sf-muted mb-2"
          >
            {t('about')}
          </h2>
          <p className="text-sf-body text-sm leading-relaxed whitespace-pre-line">
            {product.long_description}
          </p>
        </section>
      ) : null}

      <section
        aria-labelledby="tipjar-recent-heading"
        className="bg-sf-raised border border-sf-border rounded-2xl p-5"
      >
        <h2
          id="tipjar-recent-heading"
          className="text-xs font-semibold uppercase tracking-widest text-sf-muted mb-3"
        >
          {t('recentSupporters')}
        </h2>
        {list.length === 0 ? (
          <p className="text-sm text-sf-muted">{t('noSupportersYet')}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {list.map((s, idx) => {
              const time = relativeTimeKey(s.when);
              const actionKey = s.actionKey.replace('supporterActions.', '');
              return (
                <li
                  key={`${s.when}-${idx}`}
                  className="flex items-baseline justify-between gap-3 text-sm"
                >
                  <span className="text-sf-body">
                    <span className="font-medium text-sf-heading">{s.displayName}</span>{' '}
                    {tActions(actionKey as 'default')}
                  </span>
                  <span className="text-xs text-sf-muted whitespace-nowrap">
                    {formatPrice(s.amount, s.currency)} ·{' '}
                    {t(`timeAgo.${time.key}`, time.value !== undefined ? ({
                      minutes: time.value,
                      hours: time.value,
                      days: time.value,
                    } as Record<string, number>) : undefined)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </aside>
  );
}
