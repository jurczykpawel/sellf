import { describe, it, expect } from 'vitest';
import { duplicateProductDraft } from '@/lib/product-duplicate';
import type { Product } from '@/types';

const source = {
  id: 'e3000000-0000-4000-a000-000000000001', slug: 'warsztat', name: 'Warsztat', created_at: 'x', updated_at: 'y',
  event_mode: true,
  sessions: [{
    id: 'e3000000-0000-4000-a000-0000000000a1', starts_at: '2099-01-10T09:00:00+00:00', timezone: 'Europe/Warsaw', sales_open: true, sort: 0,
    tiers: [{ id: 'e3000000-0000-4000-a000-0000000000b1', label: 'Early', price: 47, seats: 30, sort: 0 }, { id: 'e3000000-0000-4000-a000-0000000000b2', label: 'Late', price: 67, seats: null, sort: 1 }],
  }],
} as unknown as Product;

describe('duplicateProductDraft', () => {
  it('drops product identity and renames the copy', () => {
    const copy = duplicateProductDraft(source, '[COPY] ');
    expect(copy.id).toBe(''); expect(copy.slug).toBe(''); expect(copy.name).toBe('[COPY] Warsztat');
  });
  it('keeps sessions and tiers but without the source ids', () => {
    const copy = duplicateProductDraft(source, '[COPY] ');
    expect(copy.sessions).toHaveLength(1);
    expect(copy.sessions![0]).not.toHaveProperty('id');
    expect(copy.sessions![0].tiers.map(t => t.label)).toEqual(['Early', 'Late']);
    for (const t of copy.sessions![0].tiers) expect(t).not.toHaveProperty('id');
    expect(source.sessions![0].id).toBeDefined();
  });
});
