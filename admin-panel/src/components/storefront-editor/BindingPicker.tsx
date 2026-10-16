'use client';

/** Existing private catalogue APIs supply name-based composition bindings. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { api } from '@/lib/api/client';
import { getCategories } from '@/lib/actions/categories';
import { formatPrice } from '@/lib/constants';
import { getEffectiveUnitPrice } from '@/lib/services/omnibus';
import OrderedItemPicker from '@/components/ui/OrderedItemPicker';
import type { PickerItem } from '@/components/ui/OrderedItemPicker';
import type { Product } from '@/types';

interface BindingPickerProps { label: string; kind: 'products' | 'categories'; selectedIds: string[]; maxItems: number; onChange: (ids: string[]) => void }
export default function BindingPicker({ label, kind, selectedIds, maxItems, onChange }: BindingPickerProps) {
  const locale = useLocale();
  const t = useTranslations('orderedPicker');
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState('');
  const query = useRef('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const [results, setResults] = useState<PickerItem[]>([]);
  const [known, setKnown] = useState<Record<string, PickerItem>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const selectedKey = selectedIds.join(',');
  const productItem = useCallback((product: Product): PickerItem => {
    const price = product.product_type === 'subscription' ? product.recurring_price ?? product.price : getEffectiveUnitPrice(product);
    return { id: product.id, name: product.name, image: product.thumbnail_url ?? product.image_url,
      detail: formatPrice(price, product.currency, locale) + (product.product_type === 'subscription' ? ` · ${t('subscription')}` : ''),
      unavailable: !product.is_active || product.is_listed === false };
  }, [locale, t]);
  useEffect(() => {
    let active = true;
    if (kind !== 'products' || !selectedKey) return;
    Promise.all(selectedKey.split(',').map(id => api.get<Product>('products', id).then(response => response ? productItem(response) : null).catch(() => null)))
      .then(items => { if (active) setKnown(previous => ({ ...previous, ...Object.fromEntries(items.filter((item): item is PickerItem => item !== null).map(item => [item.id, item])) })); });
    return () => { active = false; };
  }, [kind, selectedKey, productItem]);
  useEffect(() => {
    if (kind !== 'categories') return;
    let active = true;
    getCategories().then(response => {
      if (!active) return;
      if (!response.success) { setError(t('failure')); return; }
      const items = (response.data ?? []).map(category => ({ id: category.id, name: category.name }));
      setResults(items); setKnown(Object.fromEntries(items.map(item => [item.id, item])));
    }).catch(() => { if (active) setError(t('failure')); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [kind, t, retry]);
  useEffect(() => {
    if (kind !== 'products') return;
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true); setError('');
      api.list<Product>('products', { search, limit: 12, sort_by: 'name', sort_order: 'asc' }).then(response => {
        if (!active) return;
        const items = response.data.map(productItem);
        setCursor(response.pagination.next_cursor ?? null);
        setResults(items); setKnown(previous => ({ ...previous, ...Object.fromEntries(items.map(item => [item.id, item])) }));
      }).catch(() => { if (active) { setResults([]); setError(t('failure')); } }).finally(() => { if (active) setLoading(false); });
    }, search ? 180 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [kind, search, productItem, t, retry]);
  async function loadMore() {
    if (!cursor || moreBusy) return;
    setMoreBusy(true);
    const requestedSearch = search;
    try {
      const response = await api.list<Product>('products', { search, cursor, limit: 12, sort_by: 'name', sort_order: 'asc' });
      if (query.current !== requestedSearch) return;
      const next = response.data.map(productItem);
      setResults(previous => [...new Map([...previous, ...next].map(item => [item.id, item])).values()]);
      setKnown(previous => ({ ...previous, ...Object.fromEntries(next.map(item => [item.id, item])) }));
      setCursor(response.pagination.next_cursor ?? null);
    } catch { if (query.current === requestedSearch) setError(t('failure')); }
    finally { if (query.current === requestedSearch) setMoreBusy(false); }
  }
  const items = [...selectedIds.flatMap(id => known[id] ? [known[id]] : []), ...results.filter(item => !selectedIds.includes(item.id))];
  return <OrderedItemPicker label={label} items={items} selectedIds={selectedIds} maxItems={maxItems} onChange={onChange}
    {...(kind === 'products' ? { search, onSearch: (value: string) => { query.current = value; setSearch(value); setCursor(null); setMoreBusy(false); setLoading(true); }, hasMore: !!cursor, onMore: loadMore, loadingMore: moreBusy } : {})} loading={loading} error={error} onRetry={() => { setError(''); setLoading(true); setRetry(value => value + 1); }} />;
}
