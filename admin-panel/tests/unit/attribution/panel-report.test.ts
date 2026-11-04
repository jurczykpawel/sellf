/** Seller panel source report: the same query parsing and RPC as GET /api/v1/analytics/attribution. @J290 */
import { describe, expect, it, vi } from 'vitest';
import { ATTRIBUTION_PANEL_GROUP_BY, panelAttributionQuery, runAttributionReport } from '@/lib/attribution/report';

const now = new Date('2026-11-04T12:00:00Z');

describe('panel attribution query @J290', () => {
  it('defaults to the last 30 days, last touch, grouped by channel, source, campaign and partner', () => {
    const r = panelAttributionQuery({}, now);
    expect(r).toEqual({ ok: true, value: { from: new Date('2026-10-05T12:00:00Z'), to: now, touch: 'last',
      groupBy: ['channel', 'source', 'campaign', 'affiliate'], productId: null } });
    expect(ATTRIBUTION_PANEL_GROUP_BY).toEqual(['channel', 'source', 'campaign', 'affiliate']);
  });
  it('treats the end date as inclusive (whole day) and honours first touch', () => {
    expect(panelAttributionQuery({ touch: 'first', from: '2026-11-01', to: '2026-11-03' }, now)).toMatchObject({ ok: true, value: {
      touch: 'first', from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-11-04T00:00:00Z') } });
  });
  it.each([{ touch: 'middle' }, { from: 'nope' }, { from: '2026-11-03', to: '2026-11-01' }])('rejects %o', input => {
    expect(panelAttributionQuery(input, now).ok).toBe(false);
  });
});

describe('runAttributionReport', () => {
  it('calls get_attribution_report with the parsed query and returns its rows', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ channel: 'email', orders: 2 }], error: null });
    const q = { from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-11-02T00:00:00Z'), touch: 'first' as const,
      groupBy: [...ATTRIBUTION_PANEL_GROUP_BY], productId: null };
    await expect(runAttributionReport({ rpc } as never, q)).resolves.toEqual({ ok: true, rows: [{ channel: 'email', orders: 2 }] });
    expect(rpc).toHaveBeenCalledWith('get_attribution_report', { p_from: '2026-11-01T00:00:00.000Z', p_to: '2026-11-02T00:00:00.000Z',
      p_touch: 'first', p_group_by: ['channel', 'source', 'campaign', 'affiliate'] });
  });
  it('reports failure without leaking the database error', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(runAttributionReport({ rpc } as never, { from: now, to: now, touch: 'last', groupBy: ['channel'], productId: null }))
      .resolves.toEqual({ ok: false });
  });
});
