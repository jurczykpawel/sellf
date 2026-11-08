// @vitest-environment happy-dom
/** Storefront campaigns remain the first touch when a buyer reaches checkout. */
import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ATTRIBUTION_STORAGE_KEY } from '@/lib/attribution/collect';
import { readBrowserAttribution } from '@/lib/attribution/browser';
import SmartLandingClient from '@/components/storefront/SmartLandingClient';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, isAdmin: false }) }));
vi.mock('@/components/DashboardLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/storefront/Storefront', () => ({ default: () => null }));
vi.mock('@/components/storefront/AdminOnboardingCTA', () => ({ default: () => null }));
vi.mock('@/components/storefront/ComingSoonEmptyState', () => ({ default: () => null }));
beforeEach(() => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key), clear: () => values.clear() };
  vi.stubGlobal('localStorage', storage);
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
});
const consent = (categories: string[]) => { document.cookie = `sellf_consent_v3=${encodeURIComponent(JSON.stringify({ categories }))}; path=/`; };
const mount = () => render(React.createElement(SmartLandingClient, { hasProducts: true, shopConfig: null, year: 2026, showSellfBranding: true }));
afterEach(() => { cleanup(); localStorage.clear(); document.cookie = 'sellf_consent_v3=; max-age=0; path=/'; window.history.replaceState(null, '', '/'); vi.unstubAllGlobals(); });

it('retains the store campaign as first touch and the product campaign as last touch', () => {
  consent(['analytics']);
  window.history.replaceState(null, '', '/en/store?utm_source=first&utm_campaign=store&ref=partner');
  mount();
  window.history.replaceState(null, '', '/en/p/course?utm_source=second&utm_campaign=product');
  expect(readBrowserAttribution()).toMatchObject({ first: { source: 'first', campaign: 'store', landing_path: '/en/store' }, last: { source: 'second' }, sessions_count: 1 });
});
it('captures the current landing after consent and clears history on withdrawal', () => {
  window.history.replaceState(null, '', '/pl/store?utm_source=landing');
  mount();
  expect(localStorage.getItem(ATTRIBUTION_STORAGE_KEY)).toBeNull();
  consent(['analytics']);
  act(() => { window.dispatchEvent(new Event('cc:onConsent')); });
  expect(JSON.parse(localStorage.getItem(ATTRIBUTION_STORAGE_KEY) ?? '{}')).toMatchObject({ first: { source: 'landing' } });
  consent([]);
  act(() => { window.dispatchEvent(new Event('cc:onChange')); });
  expect(localStorage.getItem(ATTRIBUTION_STORAGE_KEY)).toBeNull();
});
it('does not store campaign history without consent', () => {
  window.history.replaceState(null, '', '/en/store?utm_source=first&ref=partner');
  mount();
  window.history.replaceState(null, '', '/en/p/course?utm_source=second');
  expect(readBrowserAttribution()).toMatchObject({ consent: 'none', first: null, last: { source: 'second' } });
  expect(localStorage.getItem(ATTRIBUTION_STORAGE_KEY)).toBeNull();
});

it('captures query-only campaign navigation while the storefront stays mounted', () => {
  consent(['analytics']);
  window.history.replaceState(null, '', '/en/store?utm_source=first');
  const view = mount();
  window.history.replaceState(null, '', '/en/store?utm_source=next');
  view.rerender(React.createElement(SmartLandingClient, { hasProducts: true, shopConfig: null, year: 2026, showSellfBranding: true }));
  window.history.replaceState(null, '', '/en/p/course');
  expect(readBrowserAttribution()).toMatchObject({ first: { source: 'first' }, last: { source: 'next' }, sessions_count: 1 });
});
