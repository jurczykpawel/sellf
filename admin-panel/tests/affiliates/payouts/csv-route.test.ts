import { expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const download = vi.hoisted(() => vi.fn().mockResolvedValue(new Response('csv')));
vi.mock('@/lib/affiliates/payouts/download', () => ({ downloadPayoutCsv: download }));
import { GET } from '@/app/api/affiliates/payouts/[id]/csv/route';
const params = { params: Promise.resolve({ id: 'payout' }) };
it.each(['cross-site', 'same-site', 'none', null])('declines %s navigation before export', async site => {
  download.mockClear();
  const response = await GET(new NextRequest('http://localhost/api/affiliates/payouts/payout/csv?version=1', { headers: site ? { 'Sec-Fetch-Site': site } : {} }), params);
  expect(response.status).toBe(403); expect(download).not.toHaveBeenCalled();
  expect(response.headers.get('cache-control')).toContain('no-store');
});
it('exports on a same-origin request', async () => {
  await GET(new NextRequest('http://localhost/api/affiliates/payouts/payout/csv?version=1', { headers: { 'Sec-Fetch-Site': 'same-origin' } }), params);
  expect(download).toHaveBeenCalledWith({ payout_id: 'payout', version: '1' });
});
