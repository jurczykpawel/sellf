'use client';

/** Search and ordered selection shared by bundle items and storefront bindings. */
import Image from 'next/image';
import { useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ImageIcon, Plus, X } from 'lucide-react';
import ReorderHandle from '@/components/ui/ReorderHandle';

export interface PickerItem { id: string; name: string; detail?: string; image?: string | null; unavailable?: boolean }
interface OrderedItemPickerProps {
  label: string; items: PickerItem[]; selectedIds: string[]; onChange: (ids: string[]) => void;
  maxItems?: number; search?: string; onSearch?: (value: string) => void; loading?: boolean; error?: string; onRetry?: () => void; hasMore?: boolean; onMore?: () => void; loadingMore?: boolean;
}
export default function OrderedItemPicker({ label, items, selectedIds, onChange, maxItems = Infinity, search, onSearch, loading, error, onRetry, hasMore, onMore, loadingMore }: OrderedItemPickerProps) {
  const t = useTranslations('orderedPicker');
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState(selectedIds.length === 0);
  const [localSearch, setLocalSearch] = useState('');
  const term = search ?? localSearch;
  const [announcement, setAnnouncement] = useState('');
  const candidates = items.filter(item => !selectedIds.includes(item.id) && item.name.toLocaleLowerCase().includes(term.trim().toLocaleLowerCase()));
  const move = (index: number, target: number) => {
    if (index === target || target < 0 || target >= selectedIds.length) return;
    const next = [...selectedIds]; const [id] = next.splice(index, 1); next.splice(target, 0, id); onChange(next);
    setAnnouncement(t('moved', { name: items.find(item => item.id === id)?.name ?? t('unavailable'), position: target + 1, count: next.length }));
  };
  const identity = (item: PickerItem) => <>
    <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-sf-raised text-sf-muted">
      {item.image ? <Image unoptimized src={item.image} alt="" width={40} height={40} className="h-full w-full object-cover" /> : <ImageIcon size={17} aria-hidden="true" />}
    </span>
    <span className="min-w-0 flex-1"><span className="block break-words font-medium">{item.name}</span>{item.detail && <span className="block text-xs text-sf-muted">{item.detail}</span>}{item.unavailable && <span className="block text-xs text-sf-warning">{t('notAvailable')}</span>}</span>
  </>;
  return <section ref={rootRef} className="min-w-0 space-y-3" aria-label={label} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setExpanded(false); }}>
    <label htmlFor={inputId} className="block text-sm font-semibold">{label}</label>
    {selectedIds.length > 0 && <ol id={`${inputId}-selected`} data-reorder-list className="relative space-y-2">
      {selectedIds.map((id, index) => {
        const item = items.find(item => item.id === id) ?? { id, name: t('unavailable'), unavailable: true };
        return <li key={id} data-reorder-index={index} className="flex items-center gap-2 rounded-xl border border-sf-border bg-sf-base p-2"
          onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const from = Number(event.dataTransfer.getData('text/plain')); if (event.dataTransfer.getData('application/x-sellf-list') === `${inputId}-selected` && Number.isInteger(from) && from >= 0 && from < selectedIds.length) move(from, index); }}>
          {selectedIds.length > 1 && <ReorderHandle name={item.name} index={index} count={selectedIds.length} onMove={target => move(index, target)} />}
          {identity(item)}<button type="button" className="flex h-11 w-10 shrink-0 items-center justify-center rounded-md text-sf-muted hover:bg-sf-hover focus-visible:outline-2 focus-visible:outline-sf-accent" aria-label={t('remove', { name: item.name })} onClick={() => onChange(selectedIds.filter(selected => selected !== id))}><X size={17} aria-hidden="true" /></button>
        </li>;
      })}
    </ol>}
    {(selectedIds.length < maxItems || maxItems === 1) && <>
      <input ref={inputRef} id={inputId} onFocus={() => setExpanded(true)} onKeyDown={event => { if (event.key === 'Escape') setExpanded(false); }} type="search" maxLength={200} value={term} placeholder={t('search')} aria-label={`${label} · ${t('search')}`} className="w-full rounded-lg border border-sf-muted bg-sf-input px-3 py-2.5 text-sm outline-offset-2 focus-visible:outline-sf-accent" onChange={event => { setExpanded(true); setLocalSearch(event.target.value); onSearch?.(event.target.value); }} />
      {expanded && <div aria-live="polite" className="text-sm text-sf-muted">{error || (loading ? t('loading') : candidates.length === 0 ? t('noMatches') : '')}{error && onRetry && <button type="button" className="ml-2 underline" onClick={onRetry}>{t('retry')}</button>}</div>}
      {expanded && !loading && <ul className="max-h-56 overflow-y-auto rounded-xl border border-sf-border bg-sf-base divide-y divide-sf-border">
        {candidates.map(item => <li key={item.id}><button type="button" aria-label={t('add', { name: item.name })} className="flex w-full items-center gap-3 p-3 text-left text-sm hover:bg-sf-hover focus-visible:outline-2 focus-visible:outline-sf-accent" onClick={() => { onChange(maxItems === 1 ? [item.id] : [...selectedIds, item.id]); setLocalSearch(''); onSearch?.(''); setExpanded(false); requestAnimationFrame(() => { (inputRef.current ?? rootRef.current?.querySelector<HTMLButtonElement>('ol li:last-child button:last-of-type'))?.focus(); setExpanded(false); }); }}>{identity(item)}<Plus size={17} className="shrink-0 text-sf-accent" aria-hidden="true" /></button></li>)}
      </ul>}
      {expanded && !loading && hasMore && onMore && <button type="button" className="min-h-11 w-full rounded-lg border border-sf-border px-3 text-sm hover:bg-sf-hover focus-visible:outline-2 focus-visible:outline-sf-accent disabled:opacity-50" disabled={loadingMore} onClick={onMore}>{loadingMore ? t('loading') : t('more')}</button>}
    </>}
    <p className="sr-only" aria-live="polite">{announcement}</p>
  </section>;
}
