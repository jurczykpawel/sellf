'use client';

/**
 * "Orders" tab of the Payments page: who ordered what — paid orders, bank transfers,
 * free self-claims, manual grants and lead sign-ups — with type and status filters.
 * Paid/transfer rows link to the transaction details via `?order=<number>`.
 * @see src/app/api/admin/orders/route.ts
 */
import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatAdminDate } from '@/lib/timezone';
import { fromMinorUnits } from '@/lib/currency/minor-units';
import { ORDER_TYPES } from '@/lib/orders/merge';
import type { OrderRow } from '@/lib/orders/merge';

const ORDER_STATUSES = ['completed', 'awaiting_payment', 'pending', 'refunded', 'partially_refunded', 'disputed', 'cancelled', 'abandoned', 'active', 'expired', 'confirmed'];

interface OrdersTableProps {
  searchTerm: string;
  onOpenTransaction: (order: OrderRow) => void;
}

export default function OrdersTable({ searchTerm, onOpenTransaction }: OrdersTableProps) {
  const t = useTranslations('admin.payments.orders');
  const locale = useLocale();
  const [type, setType] = useState('all');
  const [status, setStatus] = useState('all');
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const latest = useRef(0);

  const requestKey = `${type}|${status}|${searchTerm}`;
  const [previousKey, setPreviousKey] = useState(requestKey);
  if (previousKey !== requestKey) {
    setPreviousKey(requestKey);
    setLoading(true);
  }

  const fetchPage = async (cursor: string | null) => {
    const query = new URLSearchParams({ type, status });
    if (searchTerm.trim()) query.set('search', searchTerm.trim());
    if (cursor) query.set('cursor', cursor);
    const response = await fetch(`/api/admin/orders?${query}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('load');
    return await response.json() as { orders: OrderRow[]; nextCursor: string | null };
  };

  // A filter change restarts from the first page; only the newest request may write state.
  useEffect(() => {
    const request = ++latest.current;
    fetchPage(null)
      .then(body => {
        if (request !== latest.current) return;
        setOrders(body.orders);
        setNextCursor(body.nextCursor);
        setFailed(false);
      })
      .catch(() => { if (request === latest.current) setFailed(true); })
      .finally(() => { if (request === latest.current) setLoading(false); });
    // fetchPage reads the same three filters listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, status, searchTerm]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    const request = latest.current;
    setLoadingMore(true);
    try {
      const body = await fetchPage(nextCursor);
      if (request !== latest.current) return;
      setOrders(current => [...current, ...body.orders]);
      setNextCursor(body.nextCursor);
    } catch {
      if (request === latest.current) setFailed(true);
    } finally {
      setLoadingMore(false);
    }
  };

  const formatAmount = (order: OrderRow) => order.amount !== null && order.currency
    ? new Intl.NumberFormat(locale, { style: 'currency', currency: order.currency.toUpperCase() }).format(fromMinorUnits(order.amount, order.currency))
    : t('noCharge');

  const selectClass = 'px-3 py-2 border-2 border-sf-border-medium bg-sf-raised text-sf-heading text-sm focus:outline-none focus:ring-2 focus:ring-sf-accent';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-sf-muted">
          {t('typeFilter')}
          <select aria-label={t('typeFilter')} value={type} onChange={e => setType(e.target.value)} className={selectClass}>
            <option value="all">{t('allTypes')}</option>
            {ORDER_TYPES.map(value => <option key={value} value={value}>{t(`types.${value}`)}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-sf-muted">
          {t('statusFilter')}
          <select aria-label={t('statusFilter')} value={status} onChange={e => setStatus(e.target.value)} className={selectClass}>
            <option value="all">{t('allStatuses')}</option>
            {ORDER_STATUSES.map(value => <option key={value} value={value}>{t(`statuses.${value}`)}</option>)}
          </select>
        </label>
      </div>

      <div aria-busy={loading} className={loading ? 'opacity-50' : ''}>
        {failed ? (
          <p role="alert" className="text-sm text-sf-danger">{t('loadError')}</p>
        ) : !loading && orders.length === 0 ? (
          <p className="text-sm text-sf-muted">{t('empty')}</p>
        ) : (
          <div className="overflow-x-auto border-2 border-sf-border-medium">
            <table className="min-w-full divide-y divide-sf-border-subtle text-sm">
              <thead className="bg-sf-raised">
                <tr>
                  {['order', 'customer', 'product', 'type', 'status', 'amount', 'date'].map(column => (
                    <th key={column} scope="col" className="px-4 py-3 text-left text-xs font-medium text-sf-muted uppercase tracking-wider">{t(`columns.${column}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-sf-base divide-y divide-sf-border-subtle">
                {orders.map(order => (
                  <tr key={order.id}>
                    <td className="px-4 py-3 whitespace-nowrap font-medium text-sf-heading">
                      {order.transactionId ? (
                        <button type="button" onClick={() => onOpenTransaction(order)} className="text-sf-accent hover:text-sf-accent-hover underline">
                          {order.orderNumber ? `#${order.orderNumber}` : t('openTransaction')}
                        </button>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 break-all text-sf-heading">{order.email ?? t('unknownCustomer')}</td>
                    <td className="px-4 py-3 text-sf-body">{order.productName ?? '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-sf-body">{t(`types.${order.type}`)}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-sf-body">{t(`statuses.${order.status}`)}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-sf-heading">{formatAmount(order)}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-sf-muted">{formatAdminDate(order.createdAt, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!failed && nextCursor && (
          <div className="flex justify-center pt-4">
            <button
              type="button"
              onClick={loadMore}
              disabled={loading || loadingMore}
              className="px-4 py-2 text-sm font-medium text-sf-accent border border-sf-border rounded-md hover:bg-sf-hover disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loadingMore ? t('loadingMore') : t('loadMore')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
