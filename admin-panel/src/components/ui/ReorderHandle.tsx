'use client';

/** Shared pointer and keyboard ordering control. */
import { useId, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { GripVertical } from 'lucide-react';

interface ReorderHandleProps { name: string; index: number; count: number; onMove: (target: number) => void }
export default function ReorderHandle({ name, index, count, onMove }: ReorderHandleProps) {
  const t = useTranslations('orderedPicker');
  const hint = useId();
  const touch = useRef(false);
  return <>
    <button type="button" draggable className="flex h-11 w-9 shrink-0 touch-none items-center justify-center rounded-md text-sf-muted hover:bg-sf-hover focus-visible:outline-2 focus-visible:outline-sf-accent"
      aria-label={t('reorder', { name })} aria-describedby={hint} title={t('reorderHint')}
      onKeyDown={event => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        const target = index + (event.key === 'ArrowUp' ? -1 : 1);
        if (target >= 0 && target < count) onMove(target);
      }}
      onDragStart={event => { event.dataTransfer.setData('text/plain', String(index)); event.dataTransfer.setData('application/x-sellf-list', event.currentTarget.closest('[data-reorder-list]')?.id ?? ''); event.dataTransfer.effectAllowed = 'move'; }}
      onPointerDown={event => { if (event.pointerType === 'touch') { touch.current = true; event.currentTarget.setPointerCapture(event.pointerId); } }}
      onPointerUp={event => {
        if (!touch.current) return;
        touch.current = false;
        const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-reorder-index]');
        if (row && row.closest('[data-reorder-list]') === event.currentTarget.closest('[data-reorder-list]')) onMove(Number(row.dataset.reorderIndex));
      }} onPointerCancel={() => { touch.current = false; }}>
      <GripVertical size={18} aria-hidden="true" />
    </button><span className="sr-only" id={hint}>{t('reorderHint')}</span>
  </>;
}
