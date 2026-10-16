/** Partner and admin earnings projection. @see lib/affiliates/portal/service.ts */
import * as React from 'react';
import { formatMinorDisplay } from '@/lib/affiliates/csv/formatter';
import { portalMessages } from '@/components/affiliates/portal/messages';
import type { PortalData, PortalResult } from '@/lib/affiliates/portal/model';
import styles from './AffiliatePortal.module.css';

interface Props { data: PortalData; locale: 'en' | 'pl'; currency?: string }
export default function AffiliatePortal({ data, locale, currency }: Props): React.JSX.Element {
  const m = portalMessages[locale];
  const money = (amount: string, code: string): string => {
    const result = formatMinorDisplay(amount, code);
    return `${result.success ? locale === 'pl' ? result.data.replace('.', ',') : result.data : amount} ${code}${result.success ? '' : ` (${m.minorUnit})`}`;
  };
  const date = (value: string): React.JSX.Element => <time dateTime={value}>{new Date(value).toLocaleString(locale, { timeZone: 'UTC' })} UTC</time>;
  const memberStatus = { pending: m.pendingMember, approved: m.approved, rejected: m.rejected, suspended: m.suspended, terminated: m.terminated }[data.member.status];
  const fields = ['accrued', 'reversed', 'held', 'eligible', 'reserved', 'paid', 'debt', 'balance'] as const;
  return <section className={styles.portal} lang={locale} aria-labelledby="affiliate-title">
    <meta name="robots" content="noindex,nofollow" />
    <h1 id="affiliate-title">{m.title}</h1>
    <p><strong>{data.member.code}</strong> · {memberStatus}</p>
    <p>{m.asOf}: {date(data.as_of)}</p>
    {data.sync_pending && <p className={styles.notice} role="status">{m.pending}</p>}
    {data.needs_review && <p className={styles.notice}>{m.review}</p>}
    <h2>{m.summary}</h2>
    <div className={styles.grid}>{data.balances.map(b => <article className={styles.card} key={b.currency} aria-label={b.currency}>
      <h3>{b.currency}</h3><p className={styles.amount}>{money(b.eligible, b.currency)}</p><p>{m.eligible}</p><dl>{fields.map(field => <div className={styles.row} key={field}><dt>{m[field]}</dt><dd>{money(b[field], b.currency)}</dd></div>)}</dl>
    </article>)}</div>
    {!data.balances.length && <p>{m.empty}</p>}
    <details className={styles.help}><summary>{m.help}</summary><p>{m.definitions}</p></details>
    <div className={styles.grid}><section><h2>{m.codes}</h2><ul>{data.codes.map(c => <li key={c.code}><code>{c.code}</code> · {c.active ? m.active : m.inactive}</li>)}</ul>
    </section><section><h2>{m.rules}</h2><p>{m.subscription}</p><ul>{data.rules.map((r, i) => <li key={i}>{r.product}: {r.percentage_bps !== null ? `${r.percentage_bps / 100}%` : money(r.fixed_minor!, r.currency!)} · {r.enabled ? m.active : m.inactive}</li>)}</ul>
    </section></div><h2>{m.commissions}</h2><ul className={styles.grid}>{data.commissions.map(c => <li className={styles.card} key={c.reference}>
      <dl><div className={styles.row}><dt>{m.earnedOn}</dt><dd>{date(c.paid_at)}</dd></div><div className={styles.row}><dt>{m.reference}</dt><dd><code>#{c.reference.slice(-8)}</code></dd></div>
        <div className={styles.row}><dt>{m.accrued}</dt><dd>{money(c.accrued_minor, c.currency)}</dd></div>
        <div className={styles.row}><dt>{m.earned}</dt><dd>{money(c.current_minor, c.currency)}</dd></div>
        <div className={styles.row}><dt>{m.maturity}</dt><dd>{c.eligible_at ? date(c.eligible_at) : m.never}</dd></div>
      </dl><p>{c.livemode ? m.live : m.test}</p>{c.sync_pending && <p>{m.processing}</p>}{c.needs_review && <p>{m.reviewShort}</p>}
    </li>)}</ul>
    {data.lag && <details className={styles.card}><summary>{m.technical}</summary>
      <h2>{m.lag}</h2><dl>
        <div className={styles.row}><dt>{m.queued}</dt><dd>{data.lag.pending}</dd></div>
        <div className={styles.row}><dt>{m.queueReview}</dt><dd>{data.lag.needs_review}</dd></div>
        <div className={styles.row}><dt>{m.retrying}</dt><dd>{data.lag.retrying}</dd></div>
        <div className={styles.row}><dt>{m.syncError}</dt><dd>{data.lag.errors.sync_failed}</dd></div>
        <div className={styles.row}><dt>{m.sessionError}</dt><dd>{data.lag.errors.session_unresolved}</dd></div>
        <div className={styles.row}><dt>{m.fulfillmentWait}</dt><dd>{data.lag.errors.awaiting_fulfillment}</dd></div>
        {data.lag.next_attempt_at && <div className={styles.row}><dt>{m.nextAttempt}</dt><dd>{date(data.lag.next_attempt_at)}</dd></div>}
      </dl>
    </details>}
    {!data.commissions.length && <p>{m.empty}</p>}
    {data.next_cursor && <form method="get">
      <input type="hidden" name="cursor" value={data.next_cursor} />
      {currency && <input type="hidden" name="currency" value={currency} />}
      <button className={styles.button} type="submit">{m.next}</button>
    </form>}
  </section>;
}

export function AffiliatePortalError({ error, locale }: { error: Extract<PortalResult, { success: false }>['error']; locale: 'en' | 'pl' }): React.JSX.Element {
  return <p role="alert" lang={locale}>{portalMessages[locale][error]}</p>;
}
