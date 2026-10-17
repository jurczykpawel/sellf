/** Partner and admin earnings projection. @see lib/affiliates/portal/service.ts */
import * as React from 'react';
import { formatMinorDisplay } from '@/lib/affiliates/csv/formatter';
import { portalMessages } from '@/components/affiliates/portal/messages';
import type { PortalData, PortalResult } from '@/lib/affiliates/portal/model';
import styles from './AffiliatePortal.module.css';

interface Props { data: PortalData; locale: 'en' | 'pl'; currency?: string; memberId?: string }
export default function AffiliatePortal({ data, locale, currency, memberId }: Props): React.JSX.Element {
  const m = portalMessages[locale];
  const money = (amount: string, code: string): string => {
    const result = formatMinorDisplay(amount, code);
    return `${result.success ? locale === 'pl' ? result.data.replace('.', ',') : result.data : amount} ${code}${result.success ? '' : ` (${m.minorUnit})`}`;
  };
  const date = (value: string): React.JSX.Element => <time dateTime={value}>{new Date(value).toLocaleDateString(locale === 'en' ? 'en-GB' : 'pl', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}</time>;
  const memberStatus = { pending: m.pendingMember, approved: m.approved, rejected: m.rejected, suspended: m.suspended, terminated: m.terminated }[data.member.status];
  const fields = ['accrued', 'reversed', 'held', 'eligible', 'reserved', 'paid', 'debt', 'balance'] as const;
  return <section className={styles.portal} lang={locale} aria-labelledby="affiliate-title">
    <meta name="robots" content="noindex,nofollow" />
    {memberId ? <h2 id="affiliate-title">{m.selectedPartner}</h2> : <h1 id="affiliate-title">{m.title}</h1>}
    <p><strong>{data.member.code}</strong> · {memberStatus}</p>
    <p>{m.asOf}: {date(data.as_of)}</p>
    {data.sync_pending && <p className={styles.notice} role="status">{m.pending}</p>}
    {data.needs_review && <p className={styles.notice}>{m.review}</p>}
    {data.commissions.some(c => c.eligible_at === null && c.status === 'held') && <p className={styles.notice}>{m.unlimited}</p>}
    <h2>{m.summary}</h2>
    <p className={styles.notice}>{data.livemode === false ? m.testBalances : m.liveBalances}</p>
    <div className={styles.grid}>{data.balances.map(b => <article className={styles.card} key={b.currency} aria-label={b.currency}>
      <h3>{b.currency}</h3><dl className={styles.headlines}>{(['eligible', 'held', 'paid'] as const).map(field => <div key={field}><dt>{m[field]}</dt><dd>{money(b[field], b.currency)}</dd></div>)}</dl>
      {BigInt(b.debt) > BigInt(0) && <dl className={styles.debt}><div className={styles.row}><dt>{m.debt}</dt><dd>{money(b.debt, b.currency)}</dd></div></dl>}
    </article>)}</div>
    {!data.balances.length && <p>{m.empty}</p>}
    <details className={styles.help}><summary>{m.help}</summary><p>{m.definitions}</p><div className={styles.grid}>
      {data.balances.map(b => <article className={styles.card} key={b.currency}><h3>{b.currency}</h3><dl>{fields.map(field => <div className={styles.row} key={field}><dt>{m[field]}</dt><dd>{money(b[field], b.currency)}</dd></div>)}</dl></article>)}
    </div></details>
    <div className={styles.grid}><section><h2>{memberId ? m.adminCodes : m.codes}</h2><ul>{data.codes.map(c => <li key={c.code}><code>{c.code}</code> · {c.active ? m.active : m.inactive}</li>)}</ul>
    </section><section><h2>{m.rules}</h2><p>{m.subscription}</p><ul>{data.rules.map((r, i) => <li key={i}>{r.product}: {r.percentage_bps !== null ? `${r.percentage_bps / 100}%` : money(r.fixed_minor!, r.currency!)} · {r.enabled ? m.active : m.inactive}</li>)}</ul>
    </section></div><h2>{m.commissions}</h2>
    <div className={styles.listHeader} aria-hidden="true"><span>{m.earnedOn}</span><span>{m.product}</span><span>{m.commissionAmount}</span><span>{m.commissionStatus}</span></div>
    <ul className={styles.commissionList}>{data.commissions.map(c => {
      const status = c.needs_review ? m.reviewShort : c.sync_pending ? m.processing : ({ held: m.heldStatus, eligible: m.eligibleStatus, reserved: m.reservedStatus, paid: m.paidStatus, reversed: m.reversedStatus })[c.status];
      return <li className={styles.commissionRow} key={c.reference}>
        <div className={styles.commissionDate}>{date(c.paid_at)}</div>
        <div className={styles.product}><strong>{c.product}</strong>{c.status === 'held' && !c.sync_pending && !c.needs_review && <small>{c.eligible_at ? <>{m.maturity}: {date(c.eligible_at)}</> : m.never}</small>}</div>
        <strong className={styles.commissionAmount}>{money(c.current_minor, c.currency)}</strong>
        <div className={styles.chips}><span className={styles.chip}>{status}</span><span className={styles.chip}>{c.livemode ? m.live : m.test}</span></div>
      </li>;
    })}</ul>
    {(data.lag || data.commissions.length > 0) && <details className={styles.card}><summary>{m.technical}</summary>
      {data.lag && <><h2>{m.lag}</h2><dl>
        <div className={styles.row}><dt>{m.queued}</dt><dd>{data.lag.pending}</dd></div>
        <div className={styles.row}><dt>{m.queueReview}</dt><dd>{data.lag.needs_review}</dd></div>
        <div className={styles.row}><dt>{m.retrying}</dt><dd>{data.lag.retrying}</dd></div>
        <div className={styles.row}><dt>{m.syncError}</dt><dd>{data.lag.errors.sync_failed}</dd></div>
        <div className={styles.row}><dt>{m.sessionError}</dt><dd>{data.lag.errors.session_unresolved}</dd></div>
        <div className={styles.row}><dt>{m.fulfillmentWait}</dt><dd>{data.lag.errors.awaiting_fulfillment}</dd></div>
        {data.lag.next_attempt_at && <div className={styles.row}><dt>{m.nextAttempt}</dt><dd>{date(data.lag.next_attempt_at)}</dd></div>}
      </dl></>}
      <h2>{m.reference}</h2><ul>{data.commissions.map(c => <li key={c.reference}>{c.product}: <code>{c.reference}</code></li>)}</ul>
    </details>}
    {!data.commissions.length && <p>{m.empty}</p>}
    {data.next_cursor && <form method="get">
      {memberId && <input type="hidden" name="member" value={memberId} />}
      <input type="hidden" name="cursor" value={data.next_cursor} />
      {currency && <input type="hidden" name="currency" value={currency} />}
      <button className={styles.button} type="submit">{m.next}</button>
    </form>}
  </section>;
}

export function AffiliatePortalError({ error, locale }: { error: Extract<PortalResult, { success: false }>['error']; locale: 'en' | 'pl' }): React.JSX.Element {
  return <p role="alert" lang={locale}>{portalMessages[locale][error]}</p>;
}
