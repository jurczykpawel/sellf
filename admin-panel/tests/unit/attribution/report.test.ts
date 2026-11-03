/** Report query contract and the source an integrator receives in purchase.completed. */
import { describe, expect, it } from 'vitest';
import { parseAttributionQuery, toPurchaseAttributionView, toWebhookAttribution } from '@/lib/attribution/report';

const now = new Date('2026-11-03T12:00:00Z');
const q = (s: string) => parseAttributionQuery(new URLSearchParams(s), now);

describe('parseAttributionQuery', () => {
  it('defaults to 30 days, last touch, channel/source/medium/campaign/content', () => {
    expect(q('')).toEqual({ ok: true, value: { from: new Date('2026-10-04T12:00:00Z'), to: now, touch: 'last',
      groupBy: ['channel', 'source', 'medium', 'campaign', 'content'], productId: null } });
  });
  it('accepts days, explicit range and custom grouping', () => {
    expect(q('days=3')).toMatchObject({ ok: true, value: { from: new Date('2026-10-31T12:00:00Z') } });
    expect(q('from=2026-11-01&to=2026-11-02&group_by=channel,day&touch=first')).toMatchObject({ ok: true, value: { touch: 'first', groupBy: ['channel', 'day'] } });
  });
  it.each(['group_by=email', 'from=nope', 'from=2026-11-02&to=2026-11-01', 'touch=middle', 'days=0', 'product_id=1'])('rejects %s', s => {
    expect(q(s).ok).toBe(false);
  });
});

const row = {
  kind: 'payment', channel: 'paid_social', first_channel: 'email', mode: 'stored', consent: 'marketing',
  last_source: 'facebook', last_medium: 'paid_social', last_campaign: 'autumn', last_content: 'ad-2', last_term: null, last_utm_id: null,
  last_referrer_host: null, last_landing_path: '/offer', last_at: '2026-11-03T10:00:00Z',
  first_source: 'listmonk', first_medium: 'email', first_campaign: 'n1', first_content: null, first_term: null, first_utm_id: null,
  first_referrer_host: null, first_landing_path: '/', first_at: '2026-11-01T10:00:00Z',
  sessions_count: 2, first_seen_at: '2026-11-01T10:00:00Z', click_id_type: 'fbclid', click_id: 'IwAR-secret',
  device_class: 'mobile', country: 'PL', affiliate_member_id: null, created_at: '2026-11-03T10:00:00Z',
};

describe('attribution views', () => {
  it('admin/API view keeps the click id while retained and computes days to purchase', () => {
    expect(toPurchaseAttributionView(row)).toMatchObject({ days_to_purchase: 2, click: { type: 'fbclid', id: 'IwAR-secret' }, first: { source: 'listmonk' } });
  });
  it('webhook carries channel and touches but never the ad click id', () => {
    const hook = toWebhookAttribution(toPurchaseAttributionView(row));
    expect(hook).toMatchObject({ channel: 'paid_social', firstChannel: 'email', last: { source: 'facebook', campaign: 'autumn' }, first: { source: 'listmonk' }, deviceClass: 'mobile', country: 'PL', clickIdType: 'fbclid' });
    expect(JSON.stringify(hook)).not.toContain('IwAR');
  });
});
