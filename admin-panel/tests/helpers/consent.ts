import { Page } from '@playwright/test';

/**
 * Cookieconsent (orestbida/cookieconsent v3) wire format for `sellf_consent` cookie.
 *
 * Categories map to service groups:
 *   - necessary  -> always granted (no toggleable services)
 *   - analytics  -> 'gtm', 'umami'
 *   - marketing  -> 'pixel'
 *
 * App-level consent helpers (hasFacebookConsent / hasGTMConsent) parse this
 * shape directly from the cookie — no library load required for SSR/tests.
 */

const CATEGORY_BY_SERVICE: Record<string, 'analytics' | 'marketing'> = {
  gtm: 'analytics',
  umami: 'analytics',
  pixel: 'marketing',
};

const ALL_SERVICES = Object.keys(CATEGORY_BY_SERVICE);

const NOW = () => new Date().toISOString();
const CONSENT_ID = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

function buildCookieValue(acceptedServices: Record<string, boolean>) {
  const categories = new Set<string>(['necessary']);
  const services: Record<string, string[]> = {
    necessary: [],
    analytics: [],
    marketing: [],
  };

  for (const [service, accepted] of Object.entries(acceptedServices)) {
    if (!accepted) continue;
    const cat = CATEGORY_BY_SERVICE[service];
    if (!cat) continue;
    categories.add(cat);
    services[cat].push(service);
  }

  return JSON.stringify({
    categories: [...categories],
    services,
    revision: 0,
    data: null,
    consentId: CONSENT_ID(),
    consentTimestamp: NOW(),
    lastConsentTimestamp: NOW(),
  });
}

async function writeConsentCookie(page: Page, services: Record<string, boolean>) {
  await page.context().addCookies([
    {
      name: 'sellf_consent',
      value: buildCookieValue(services),
      domain: 'localhost',
      path: '/',
    },
  ]);
}

/**
 * Bypasses the consent banner by setting an "accept all" cookie.
 */
export async function acceptAllCookies(page: Page) {
  const all: Record<string, boolean> = {};
  for (const s of ALL_SERVICES) all[s] = true;
  await writeConsentCookie(page, all);
}

/**
 * Sets specific consent preferences.
 *
 * Accepts both legacy Klaro service names (`'google-tag-manager'`,
 * `'facebook-pixel'`, `'umami-analytics'`) and short canonical names
 * (`'gtm'`, `'pixel'`, `'umami'`) so existing callers do not have to change.
 */
export async function setConsentPreferences(page: Page, consents: Record<string, boolean>) {
  const aliases: Record<string, string> = {
    'google-tag-manager': 'gtm',
    'facebook-pixel': 'pixel',
    'umami-analytics': 'umami',
    gtm: 'gtm',
    pixel: 'pixel',
    umami: 'umami',
  };
  const mapped: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(consents)) {
    const canonical = aliases[k];
    if (canonical) mapped[canonical] = v;
  }
  await writeConsentCookie(page, mapped);
}

/**
 * Clears consent cookie to simulate no consent given.
 */
export async function clearConsent(page: Page) {
  await page.context().clearCookies({ name: 'sellf_consent' });
}
