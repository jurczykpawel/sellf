// @vitest-environment happy-dom
import { createElement } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import AttributionSection from '@/components/admin/AttributionSection';
import pl from '@/messages/pl.json';
const m = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/actions/attribution', () => ({ getPurchaseAttribution: m.get }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key.split('.').reduce<unknown>((v, k) => v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined, pl.admin.payments.attribution) ?? key }));
afterEach(cleanup);
it('explains labeled touches and distinguishes the channel', async () => {
 m.get.mockResolvedValue({ success: true, data: { channel: 'email', first_channel: 'organic_search', last: { source: 'newsletter', medium: 'email', campaign: 'autumn', landing_path: '/checkout' }, first: { source: 'google', medium: 'organic' }, mode: 'stored', device_class: 'desktop', country: 'PL', sessions_count: 2 } });
 await act(async () => { render(createElement(AttributionSection, { transactionId: 'tx' })); });
 expect(screen.getByRole('heading', { name: 'Skąd przyszedł kupujący' })).toBeTruthy();
 for (const label of ['Źródło','Medium','Kampania','Strona wejścia']) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
 expect(screen.getByText('newsletter')).toBeTruthy(); expect(screen.getByText(pl.admin.payments.attribution.touchHelp)).toBeTruthy();
 expect(screen.getAllByText('E-mail').some(e => e.className.includes('rounded-full'))).toBe(true);
});
