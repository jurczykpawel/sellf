'use client';

/**
 * Admin funnel based on existing payment records, with an independent period filter.
 * @see src/lib/actions/checkout-funnel.ts
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { getCheckoutFunnel } from '@/lib/actions/checkout-funnel';
import { useUserPreferences } from '@/contexts/UserPreferencesContext';
import type { CheckoutFunnelStats } from '@/lib/actions/checkout-funnel';

const buckets = ['paid', 'pending', 'abandoned', 'other'] as const;
const metrics = ['started', ...buckets] as const;

export default function CheckoutFunnel() {
  const t = useTranslations('admin.dashboard.checkoutFunnel');
  const format = useFormatter();
  const productId = useSearchParams().get('productId') || undefined;
  const { hideValues } = useUserPreferences();
  const [days, setDays] = useState(30);
  const [retry, setRetry] = useState(0);
  const requestKey = `${days}:${productId ?? ''}:${retry}`;
  const [state, setState] = useState<{ key?: string; data?: CheckoutFunnelStats; error: boolean }>({ error: false });
  const loading = state.key !== requestKey;

  useEffect(() => {
    let cancelled = false;
    getCheckoutFunnel(days, productId).then(result => {
      if (!cancelled) setState({ key: requestKey, data: result.success ? result.data : undefined, error: !result.success || !result.data });
    }).catch(() => {
      if (!cancelled) setState({ key: requestKey, error: true });
    });
    return () => { cancelled = true; };
  }, [days, productId, requestKey]);

  const number = (value: number) => hideValues ? '•••' : format.number(value);
  const share = (paid: number, total: number) => hideValues ? '•••' : total ? format.number(paid / total, { style: 'percent', maximumFractionDigits: 1 }) : '—';

  return (
    <section aria-labelledby="checkout-funnel-title" className="bg-sf-base border-2 border-sf-border-subtle p-4 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 id="checkout-funnel-title" className="text-xl font-bold text-sf-heading">{t('title')}</h2>
        <label className="flex items-center gap-2 text-sm text-sf-heading">
          {t('period')}
          <select value={days} onChange={event => setDays(Number(event.target.value))} className="bg-sf-base border-2 border-sf-border-medium px-3 py-2">
            {[7, 30, 90].map(value => <option key={value} value={value}>{t('days', { count: value })}</option>)}
          </select>
        </label>
      </div>
      <div aria-busy={loading}>
        {loading ? <p role="status" className="text-sf-muted">{t('loading')}</p> : state.error ? (
          <div role="alert" className="text-sf-danger">
            <p>{t('error')}</p>
            <button onClick={() => setRetry(value => value + 1)} className="mt-2 border-2 border-sf-border-medium px-3 py-2 text-sf-heading">{t('retry')}</button>
          </div>
        ) : state.data && (
          <>
            <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {buckets.map(metric => <div key={metric} className="border-2 border-sf-border-subtle p-4">
                <dt className="text-sm text-sf-muted">{t(metric)}</dt>
                <dd className="text-2xl font-bold text-sf-heading tabular-nums">{number(state.data!.totals[metric])}</dd>
              </div>)}
            </dl>
            <p className="my-4 text-sm text-sf-body">
              {hideValues ? t('sum', { started: '•••', paid: '•••', pending: '•••', abandoned: '•••', other: '•••' }) : t('sum', {
                started: format.number(state.data.totals.started), paid: format.number(state.data.totals.paid), pending: format.number(state.data.totals.pending),
                abandoned: format.number(state.data.totals.abandoned), other: format.number(state.data.totals.other ?? 0),
              })}
              {' · '}{t('paidShare')}: {share(state.data.totals.paid, state.data.totals.started)}
            </p>
            <div className="space-y-3">
              <details className="border-2 border-sf-border-subtle">
                <summary className="cursor-pointer p-3 font-semibold text-sf-heading">{t('helpTitle')}</summary>
                <div className="p-3 pt-0 text-sm text-sf-muted space-y-2">
                  <ul className="list-disc pl-5 space-y-1">{(['defPaid', 'defPending', 'defAbandoned', 'defOther'] as const).map(key => <li key={key}>{t(key)}</li>)}</ul>
                  <p>{t('paidShareHelp')}</p>
                  <p>{t('definition')}</p>
                  <p>{t('limitations')}</p>
                </div>
              </details>
              {state.data.products.length === 0 ? <p className="text-sf-muted">{t('empty')}</p> : (
                <details className="border-2 border-sf-border-subtle">
                  <summary className="cursor-pointer p-3 font-semibold text-sf-heading">{t('byProduct')} ({state.data.products.length})</summary>
                  <div className="overflow-x-auto p-3 pt-0">
                    <table className="w-full text-sm text-sf-heading">
                      <caption className="sr-only">{t('byProduct')}</caption>
                      <thead><tr className="border-b-2 border-sf-border-medium">
                        <th scope="col" className="text-left p-3">{t('product')}</th>
                        {metrics.map(metric => <th scope="col" key={metric} className="text-right p-3">{t(metric)}</th>)}
                        <th scope="col" className="text-right p-3">{t('paidShare')}</th>
                      </tr></thead>
                      <tbody>{state.data.products.map(product => <tr key={product.productId ?? 'unknown'} className="border-b border-sf-border-subtle">
                        <th scope="row" className="text-left p-3 font-medium">{product.name ?? t('unknownProduct')}</th>
                        {metrics.map(metric => <td key={metric} className="text-right p-3 tabular-nums">{number(product[metric] ?? 0)}</td>)}
                        <td className="text-right p-3 tabular-nums">{share(product.paid, product.started)}</td>
                      </tr>)}</tbody>
                    </table>
                  </div>
                </details>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
