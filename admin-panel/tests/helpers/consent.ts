import { Page } from '@playwright/test';
import { CONSENT_COOKIE_NAME } from '@/lib/constants';

/**
 * Cookieconsent (orestbida/cookieconsent v3) wire format for the consent cookie.
 *
 * Categories map to service groups:
 *   - necessary  -> always granted (no toggleable services)
 *   - analytics  -> 'gtm', 'umami'
 *   - marketing  -> 'pixel'
 *
 * App-level consent helpers (hasFacebookConsent / hasGTMConsent) parse this
 * shape directly from the cookie — no library load required for SSR/tests.
 */

/**
 * Note: Umami is NOT a consent service in Sellf — it runs cookieless and
 * therefore is exempt from consent (ePrivacy Art. 5(3) / GDPR recital 30).
 */
const CATEGORY_BY_SERVICE: Record<string, 'analytics' | 'marketing'> = {
  gtm: 'analytics',
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
      name: CONSENT_COOKIE_NAME,
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
 * Accepts both legacy consent-lib service names (`'google-tag-manager'`,
 * `'facebook-pixel'`, `'umami-analytics'`) and short canonical names
 * (`'gtm'`, `'pixel'`, `'umami'`) so existing callers do not have to change.
 */
export async function setConsentPreferences(page: Page, consents: Record<string, boolean>) {
  // Umami (legacy `umami-analytics`, `umami`) is intentionally ignored — it
  // runs cookieless and is not gated by consent in Sellf.
  const aliases: Record<string, string> = {
    'google-tag-manager': 'gtm',
    'facebook-pixel': 'pixel',
    gtm: 'gtm',
    pixel: 'pixel',
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
  await page.context().clearCookies({ name: CONSENT_COOKIE_NAME });
}
