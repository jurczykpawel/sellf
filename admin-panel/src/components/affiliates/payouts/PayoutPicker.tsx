'use client';
/** Searchable payout selections with server search and keyboard navigation. @see PayoutPanel.tsx */
import { useEffect, useId, useState } from 'react';
interface Props { disabled?: boolean; label: string; placeholder?: string; emptyLabel: string; options: { value: string; label: string }[]; selectedValue: string; onSelect: (value: string) => void; onSearch: (search: string) => void }
export default function PayoutPicker({ disabled, label, placeholder, emptyLabel, options, selectedValue, onSelect, onSearch }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [active, setActive] = useState(-1);
  useEffect(() => { if (open && active >= 0) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' }); }, [active, id, open]);
  const rows = options.filter(o => o.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const selected = options.find(o => o.value === selectedValue)?.label ?? '';
  function close() { setOpen(false); setQuery(''); setActive(-1); onSearch(''); }
  function choose(value: string) { onSelect(value); close(); }
  return <div className="relative min-w-0"><label htmlFor={id} className="block text-sm font-medium">{label}</label>
    <input disabled={disabled} id={id} role="combobox" aria-expanded={open} aria-controls={`${id}-options`} aria-autocomplete="list" aria-activedescendant={open && rows[active] ? `${id}-${active}` : undefined} autoComplete="off" placeholder={placeholder} value={open ? query : selected}
      onFocus={() => setOpen(true)} onBlur={close} onChange={e => { setQuery(e.target.value); setActive(-1); setOpen(true); onSearch(e.target.value); }}
      onKeyDown={e => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); if (rows.length) setActive(i => e.key === 'ArrowDown' ? (i + 1) % rows.length : i < 0 ? rows.length - 1 : (i - 1 + rows.length) % rows.length); }
        else if (e.key === 'Enter') { e.preventDefault(); if (rows[active]) choose(rows[active].value); }
        else if (e.key === 'Escape') { e.preventDefault(); close(); }
      }} className="mt-1 w-full rounded-md border border-sf-border bg-sf-input px-3 py-2 text-sm text-sf-heading focus:outline-none focus:ring-2 focus:ring-sf-accent" />
    {open && <ul id={`${id}-options`} role="listbox" aria-label={label} className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-md border border-sf-border bg-sf-base py-1 shadow-lg">
      {rows.map((option, index) => <li id={`${id}-${index}`} role="option" aria-selected={selectedValue === option.value} key={option.value} onMouseDown={e => e.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(option.value)} className={`cursor-pointer px-3 py-2 text-sm ${index === active ? 'bg-sf-hover text-sf-heading' : 'text-sf-body'}`}>{option.label}</li>)}
      {!rows.length && <li role="presentation" className="px-3 py-2 text-sm text-sf-muted">{emptyLabel}</li>}
    </ul>}
  </div>;
}
