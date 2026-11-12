/**
 * Sales → Sales sources: the purchase attribution report for the seller (first/last touch, date
 * range; channel, source, campaign and partner with orders and net revenue). Same query and RPC
 * as GET /api/v1/analytics/attribution. Plain GET form, no client JS. Mobile shows cards instead
 * of the table so 390 px never scrolls sideways.
 * @see src/lib/attribution/report.ts — panelAttributionQuery, runAttributionReport
 * @see supabase/migrations/20261110235907_release_2026_11_0_attribution_mail_analytics.sql — get_attribution_report()
 */
import { getLocale, getTranslations } from 'next-intl/server';
import { verifyAdminAccess } from '@/lib/auth-server';
import { createClient } from '@/lib/supabase/server';
import { panelAttributionQuery, runAttributionReport } from '@/lib/attribution/report';
import type { AttributionReportRow } from '@/lib/attribution/report';

interface AttributionPageProps {
  searchParams: Promise<{ touch?: string; from?: string; to?: string }>;
}

const pick = (value: unknown) => (typeof value === 'string' ? value.slice(0, 40) : undefined);
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

export default async function AttributionPage({ searchParams }: AttributionPageProps) {
  await verifyAdminAccess();
  const [t, locale, params] = await Promise.all([getTranslations('attributionReport'), getLocale(), searchParams]);
  const input = { touch: pick(params.touch), from: pick(params.from), to: pick(params.to) };
  const parsed = panelAttributionQuery(input);
  const report = parsed.ok ? await runAttributionReport(await createClient(), parsed.value) : { ok: false as const };
  const rows: AttributionReportRow[] = report.ok ? report.rows : [];
  const touch = parsed.ok ? parsed.value.touch : 'last';
  const fromValue = input.from ?? (parsed.ok ? dateOnly(parsed.value.from) : '');
  const toValue = input.to ?? (parsed.ok ? dateOnly(parsed.value.to) : '');

  const money = (value: AttributionReportRow[string], currency: AttributionReportRow[string]) => {
    const amount = typeof value === 'number' ? value : 0;
    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency: String(currency || 'PLN') }).format(amount);
    } catch {
      return `${amount.toFixed(2)} ${currency ?? ''}`;
    }
  };
  const text = (value: AttributionReportRow[string]) => (value === null || value === undefined || value === '' ? t('none') : String(value));
  const columns = [
    { key: 'channel', label: t('channel') },
    { key: 'source', label: t('source') },
    { key: 'campaign', label: t('campaign') },
    { key: 'affiliate', label: t('partner') },
  ] as const;
  const field = 'mt-1 block w-full min-w-0 rounded-lg border border-sf-border bg-sf-input px-3 py-2 text-sf-body';

  return (
    <div className="space-y-8 min-w-0">
      <div>
        <h1 className="text-[32px] sm:text-[40px] font-[800] text-sf-heading tracking-[-0.03em] leading-[1.1]">{t('title')}</h1>
        <p className="text-sf-body mt-2">{t('subtitle')}</p>
      </div>

      <form method="get" className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end" aria-label={t('title')}>
        <label className="text-sm font-medium text-sf-heading min-w-0">
          {t('touch')}
          <select name="touch" defaultValue={touch} className={field}>
            <option value="last">{t('touchLast')}</option>
            <option value="first">{t('touchFirst')}</option>
          </select>
        </label>
        <label className="text-sm font-medium text-sf-heading min-w-0">
          {t('from')}
          <input type="date" name="from" defaultValue={fromValue} className={field} />
        </label>
        <label className="text-sm font-medium text-sf-heading min-w-0">
          {t('to')}
          <input type="date" name="to" defaultValue={toValue} className={field} />
        </label>
        <button type="submit" className="rounded-lg bg-sf-accent-bg hover:bg-sf-accent-hover px-4 py-2 font-semibold text-white focus:outline-none focus:ring-2 focus:ring-sf-accent">
          {t('show')}
        </button>
        <p className="sm:col-span-4 text-xs text-sf-muted">{t('touchHelp')}</p>
      </form>

      {!report.ok ? (
        <p role="alert" className="text-sf-danger">{t('error')}</p>
      ) : rows.length === 0 ? (
        <p className="text-sf-muted">{t('empty')}</p>
      ) : (
        <>
          <ul className="md:hidden space-y-3" aria-label={t('title')}>
            {rows.map((row, i) => (
              <li key={i} className="rounded-xl border border-sf-border p-4 min-w-0">
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  {columns.map(c => (
                    <div key={c.key} className="contents">
                      <dt className="text-sf-muted">{c.label}</dt>
                      <dd className="text-sf-heading break-words min-w-0">{text(row[c.key])}</dd>
                    </div>
                  ))}
                  <dt className="text-sf-muted">{t('orders')}</dt>
                  <dd className="text-sf-heading">{text(row.orders)}</dd>
                  <dt className="text-sf-muted">{t('net')}</dt>
                  <dd className="text-sf-heading font-semibold">{money(row.net, row.currency)}</dd>
                </dl>
              </li>
            ))}
          </ul>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-sf-muted border-b border-sf-border">
                  {columns.map(c => <th key={c.key} scope="col" className="py-2 pr-4 font-medium">{c.label}</th>)}
                  <th scope="col" className="py-2 pr-4 font-medium text-right">{t('orders')}</th>
                  <th scope="col" className="py-2 pr-4 font-medium text-right">{t('gross')}</th>
                  <th scope="col" className="py-2 font-medium text-right">{t('net')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className="border-b border-sf-border text-sf-heading">
                    {columns.map(c => <td key={c.key} className="py-2 pr-4 break-words">{text(row[c.key])}</td>)}
                    <td className="py-2 pr-4 text-right">{text(row.orders)}</td>
                    <td className="py-2 pr-4 text-right">{money(row.gross, row.currency)}</td>
                    <td className="py-2 text-right font-semibold">{money(row.net, row.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
