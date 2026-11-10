// @vitest-environment happy-dom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import IssuedLicensesSettings from '@/components/settings/IssuedLicensesSettings';
const translate = (key: string) => key;
vi.mock('next-intl', () => ({ useLocale: () => 'en', useTranslations: () => translate }));
vi.mock('@/components/tutorials/TutorialTrigger', () => ({ default: () => null }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('can leave the selected license and browse the full registry', async () => {
 const fetch = vi.fn(async (_url: string) => ({ ok: true, json: async () => ({ licenses: [], products: [], total: 0 }) }));
 vi.stubGlobal('fetch',fetch);
 await act(async () => { render(createElement(IssuedLicensesSettings,{enabled:true,initialLicenseId:'license'})); });
 expect(fetch.mock.calls[0]?.[0]).toContain('licenseId=license');
 await act(async () => { fireEvent.click(screen.getByRole('button',{name:'showAllLicenses'})); });
 expect(fetch.mock.calls.at(-1)?.[0]).not.toContain('licenseId');
 expect(screen.queryByRole('button',{name:'showAllLicenses'})).toBeNull();
});
