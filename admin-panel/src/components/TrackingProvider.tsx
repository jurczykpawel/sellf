'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import Script from 'next/script'
import { CONSENT_COOKIE_NAME } from '@/lib/constants'

/** Validate GTM container ID format (GTM-XXXXXXX) */
function isValidGtmId(id: string): boolean {
  return /^GTM-[A-Z0-9]{1,10}$/i.test(id)
}

/** Validate Facebook Pixel ID format (numeric) */
function isValidFbPixelId(id: string): boolean {
  return /^\d{10,20}$/.test(id)
}

/** Validate Umami website ID format (UUID) */
function isValidUmamiId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
}

/** Validate URL for script sources. HTTPS only, no userinfo, no auth, no whitespace, no quotes. */
function isValidScriptUrl(url: string): boolean {
  if (/[\s'"`<>\\]/.test(url)) return false
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    if (parsed.username || parsed.password) return false
    return true
  } catch {
    return false
  }
}

interface PublicIntegrationsConfig {
  gtm_container_id?: string | null
  gtm_server_container_url?: string | null
  facebook_pixel_id?: string | null
  fb_capi_enabled?: boolean
  umami_website_id?: string | null
  umami_script_url?: string | null
  cookie_consent_enabled?: boolean
  consent_logging_enabled?: boolean
}

interface TrackingProviderProps {
  config: PublicIntegrationsConfig | null
  /**
   * Per-request CSP nonce supplied by the root layout. Forwarded to every
   * inline <Script> so the browser accepts them under the
   * `script-src 'nonce-...'` directive set by middleware.
   */
  nonce?: string
}

/**
 * Stable anonymous ID kept in localStorage. Used as the join key for
 * `consent_logs` rows so consent revisions for the same visitor stay correlated
 * without us learning who they are.
 */
function getOrCreateAnonId(): string {
  try {
    const existing = localStorage.getItem('sf_anonymous_id')
    if (existing) return existing
    const fresh = crypto.randomUUID()
    localStorage.setItem('sf_anonymous_id', fresh)
    return fresh
  } catch {
    return 'no-storage'
  }
}

export default function TrackingProvider({ config, nonce }: TrackingProviderProps) {
  // Always call hooks at the top — the early return below must not skip them.
  const initialisedRef = useRef(false)
  const pathname = usePathname()

  // Admin dashboard must not load any marketing/analytics tracking: it's
  // self-traffic noise, a privacy problem (admin actions hitting Meta/Google),
  // and a misconfigured server-side GTM URL stalls every admin page load. The
  // consent useEffect below already skips /dashboard; mirror that for the
  // injected <script> tags so GTM/Pixel/Umami never mount on the admin panel.
  const isAdminPath = pathname?.includes('/dashboard') ?? false

  // Stable derived values used both in rendered scripts and the init effect.
  const gtm_container_id = config?.gtm_container_id && isValidGtmId(config.gtm_container_id) ? config.gtm_container_id : null
  const facebook_pixel_id = config?.facebook_pixel_id && isValidFbPixelId(config.facebook_pixel_id) ? config.facebook_pixel_id : null
  const umami_website_id = config?.umami_website_id && isValidUmamiId(config.umami_website_id) ? config.umami_website_id : null
  const umami_script_url = config?.umami_script_url && isValidScriptUrl(config.umami_script_url) ? config.umami_script_url : 'https://cloud.umami.is/script.js'
  const gtmBaseUrl = config?.gtm_server_container_url && isValidScriptUrl(config.gtm_server_container_url)
    ? config.gtm_server_container_url.replace(/\/$/, '')
    : 'https://www.googletagmanager.com'
  const cookie_consent_enabled = !!config?.cookie_consent_enabled
  const consent_logging_enabled = !!config?.consent_logging_enabled

  useEffect(() => {
    if (!config || !cookie_consent_enabled || initialisedRef.current) return
    // Admin dashboard does not need tracking — and vanilla-cookieconsent v3
    // attaches DOM nodes under <body> that collide with React reconciliation
    // when /dashboard pages re-render after a server action
    // (Uncaught NotFoundError: insertBefore / removeChild → global-error
    // boundary). Tracking still runs on the public storefront where it
    // matters; admin panel skips it.
    if (typeof window !== 'undefined' && window.location.pathname.includes('/dashboard')) return
    initialisedRef.current = true

    let cancelled = false

    ;(async () => {
      // Dynamic import keeps the bundle out of the SSR path and lets us no-op
      // gracefully if the library is not installed (e.g. during teardown).
      const [CookieConsent] = await Promise.all([
        import('vanilla-cookieconsent'),
        import('vanilla-cookieconsent/dist/cookieconsent.css'),
      ])

      if (cancelled) return

      // Root layout hardcodes `<html lang="en">`, so reading document.documentElement.lang
      // would always return 'en'. Locale lives in the URL prefix (/pl, /en).
      const path = window.location.pathname.toLowerCase()
      const sellfLang = path === '/pl' || path.startsWith('/pl/') ? 'pl' : 'en'

      /**
       * Build the legacy `{service: bool}` payload that `/api/consent` and the
       * `consent_logs.consents` JSONB column have always expected. Lets us
       * change the consent library without rewriting historical rows.
       *
       * Note: `umami-analytics` is intentionally NOT here — Umami runs in
       * cookieless mode (no client cookies, anonymised visitor hashing) and
       * therefore does not require consent under GDPR Art. 6 / recital 30.
       */
      const buildLegacyConsents = () => ({
        'google-tag-manager': CookieConsent.acceptedService('gtm', 'analytics'),
        'facebook-pixel': CookieConsent.acceptedService('pixel', 'marketing'),
      })

      const updateGtagConsent = () => {
        const w = window as unknown as { gtag?: (...args: unknown[]) => void }
        if (typeof w.gtag !== 'function') return
        const analyticsGranted = CookieConsent.acceptedCategory('analytics')
        const marketingGranted = CookieConsent.acceptedCategory('marketing')
        w.gtag('consent', 'update', {
          analytics_storage: analyticsGranted ? 'granted' : 'denied',
          ad_storage: marketingGranted ? 'granted' : 'denied',
          ad_user_data: marketingGranted ? 'granted' : 'denied',
          ad_personalization: marketingGranted ? 'granted' : 'denied',
        })
      }

      let logTimer: ReturnType<typeof setTimeout> | null = null
      const logConsent = () => {
        if (!consent_logging_enabled) return
        if (logTimer) clearTimeout(logTimer)
        logTimer = setTimeout(() => {
          try {
            fetch('/api/consent', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                anonymous_id: getOrCreateAnonId(),
                consents: buildLegacyConsents(),
                consent_version: '1',
              }),
            }).catch((err) => console.warn('[TrackingProvider] consent log:', err))
          } catch {
            /* localStorage etc. blocked — silently skip */
          }
        }, 100)
      }

      // Build a description that names only the providers actually configured.
      // GDPR Art. 7 + EDPB guidance: the consent prompt must specifically tell
      // the user what data, why, how long, and who has access. Generic copy
      // (e.g. "we use cookies") does NOT satisfy the "freely given, specific
      // and informed" standard.
      //
      // Umami runs cookieless and is NOT enumerated here — under recital 30 +
      // ePrivacy Art. 5(3), purely anonymous analytics that do not store
      // anything on the user device are exempt from consent.
      const enabledAnalytics: string[] = []
      if (gtm_container_id) enabledAnalytics.push('Google Tag Manager')
      const enabledMarketing: string[] = []
      if (facebook_pixel_id) enabledMarketing.push('Meta Pixel')
      const analyticsPart = enabledAnalytics.length
        ? `${enabledAnalytics.join(', ')} — up to 24 months`
        : ''
      const marketingPart = enabledMarketing.length
        ? `${enabledMarketing.join(', ')} — ~7 days`
        : ''
      const analyticsPartPl = enabledAnalytics.length
        ? `${enabledAnalytics.join(', ')} — do 24 miesięcy`
        : ''
      const marketingPartPl = enabledMarketing.length
        ? `${enabledMarketing.join(', ')} — ~7 dni`
        : ''
      const enDescription =
        `We use cookies to run the site (necessary)` +
        (analyticsPart ? `, measure usage (analytics: ${analyticsPart})` : '') +
        (marketingPart ? `, and run marketing (${marketingPart})` : '') +
        `. You can change your choice anytime via Cookie preferences in the footer.`
      const plDescription =
        `Używamy ciasteczek do działania strony (niezbędne)` +
        (analyticsPartPl ? `, mierzenia ruchu (analityka: ${analyticsPartPl})` : '') +
        (marketingPartPl ? `, oraz marketingu (${marketingPartPl})` : '') +
        `. Wybór zmienisz w każdej chwili przez Preferencje ciasteczek w stopce.`

      await CookieConsent.run({
        // Distinct from Klaro's old `sellf_consent` cookie — a same-name host-only
        // leftover would shadow this one and re-trigger the banner forever.
        cookie: { name: CONSENT_COOKIE_NAME, expiresAfterDays: 365 },
        // Explicit opt-in: GDPR requires consent BEFORE non-essential cookies.
        // cookieconsent v3 defaults to opt-in, but locking it down here keeps
        // a future maintainer from accidentally flipping the model.
        mode: 'opt-in',
        // Headless browsers (Playwright Chromium) are detected as bots by the
        // default heuristic and the banner is hidden — which makes every E2E
        // test that asserts banner visibility flake. We intentionally turn
        // this off; real production analytics scripts have their own bot
        // filtering downstream.
        hideFromBots: false,
        guiOptions: {
          consentModal: { layout: 'box', position: 'bottom right' },
          preferencesModal: { layout: 'box' },
        },
        categories: {
          necessary: { enabled: true, readOnly: true },
          analytics: {
            autoClear: {
              cookies: [{ name: /^_ga/ }, { name: '_gid' }],
            },
            services: {
              ...(gtm_container_id ? { gtm: { label: 'Google Tag Manager' } } : {}),
            },
          },
          marketing: {
            autoClear: {
              cookies: [{ name: /^_fbp/ }, { name: '_fbc' }],
            },
            services: {
              ...(facebook_pixel_id ? { pixel: { label: 'Meta Pixel' } } : {}),
            },
          },
        },
        language: {
          default: sellfLang,
          translations: {
            en: {
              consentModal: {
                title: 'We use cookies',
                description: enDescription,
                acceptAllBtn: 'Accept all',
                acceptNecessaryBtn: 'Reject all',
                showPreferencesBtn: 'Manage preferences',
              },
              preferencesModal: {
                title: 'Cookie preferences',
                acceptAllBtn: 'Accept all',
                acceptNecessaryBtn: 'Reject all',
                savePreferencesBtn: 'Save preferences',
                closeIconLabel: 'Close',
                sections: [
                  { title: 'Necessary', linkedCategory: 'necessary' },
                  { title: 'Analytics', linkedCategory: 'analytics' },
                  { title: 'Marketing', linkedCategory: 'marketing' },
                ],
              },
            },
            pl: {
              consentModal: {
                title: 'Używamy ciasteczek',
                description: plDescription,
                acceptAllBtn: 'Akceptuj wszystkie',
                acceptNecessaryBtn: 'Odrzuć wszystkie',
                showPreferencesBtn: 'Zarządzaj preferencjami',
              },
              preferencesModal: {
                title: 'Preferencje cookies',
                acceptAllBtn: 'Akceptuj wszystkie',
                acceptNecessaryBtn: 'Odrzuć wszystkie',
                savePreferencesBtn: 'Zapisz preferencje',
                closeIconLabel: 'Zamknij',
                sections: [
                  { title: 'Niezbędne', linkedCategory: 'necessary' },
                  { title: 'Analityka', linkedCategory: 'analytics' },
                  { title: 'Marketing', linkedCategory: 'marketing' },
                ],
              },
            },
          },
        },
        onFirstConsent: () => {
          updateGtagConsent()
          logConsent()
        },
        onConsent: () => {
          updateGtagConsent()
        },
        onChange: () => {
          updateGtagConsent()
          logConsent()
        },
      })
    })().catch((err) => console.warn('[TrackingProvider] consent init failed:', err))

    return () => {
      cancelled = true
    }
  }, [config, cookie_consent_enabled, consent_logging_enabled, gtm_container_id, facebook_pixel_id, umami_website_id])

  if (!config || isAdminPath) return null

  // --- GOOGLE CONSENT MODE V2 DEFAULTS ---
  // Must run before GTM; only emit when consent is enabled (otherwise GTM runs unrestricted).
  const consentModeDefaults = `
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('consent', 'default', {
      'ad_storage': 'denied',
      'ad_user_data': 'denied',
      'ad_personalization': 'denied',
      'analytics_storage': 'denied',
      'wait_for_update': 500
    });
  `

  // Scripts use cookieconsent's `data-category` / `data-service` blocking convention.
  const managedType = cookie_consent_enabled ? 'text/plain' : 'text/javascript'

  return (
    <>
      {gtm_container_id && cookie_consent_enabled && (
        <script
          id="consent-mode-defaults"
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: consentModeDefaults }}
        />
      )}

      {/* GTM */}
      {gtm_container_id && (
        <script
          id="gtm-script"
          type={managedType}
          data-category={cookie_consent_enabled ? 'analytics' : undefined}
          data-service={cookie_consent_enabled ? 'gtm' : undefined}
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `(function(w,d,s,l,i,u){w[l]=w[l]||[];w[l].push({'gtm.start':
            new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
            j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
            u+'/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
            })(window,document,'script','dataLayer',${JSON.stringify(gtm_container_id)},${JSON.stringify(gtmBaseUrl)});`,
          }}
        />
      )}

      {/* Facebook Pixel */}
      {facebook_pixel_id && (
        <script
          id="fb-pixel"
          type={managedType}
          data-category={cookie_consent_enabled ? 'marketing' : undefined}
          data-service={cookie_consent_enabled ? 'pixel' : undefined}
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `!function(f,b,e,v,n,t,s)
            {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)}(window, document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');
            fbq('init', ${JSON.stringify(facebook_pixel_id)});
            fbq('track', 'PageView');`,
          }}
        />
      )}

      {/*
        Umami — cookieless analytics, runs unconditionally.
        No `type="text/plain"` blocking, no `data-category` tag: Umami
        does not store anything on the user's device (cookieless visitor
        hashing) and therefore falls under the ePrivacy Art. 5(3) /
        GDPR recital 30 exemption.
      */}
      {umami_website_id && (
        <Script
          id="umami-script"
          src={umami_script_url || 'https://cloud.umami.is/script.js'}
          strategy="afterInteractive"
          data-website-id={umami_website_id}
          nonce={nonce}
        />
      )}
    </>
  )
}
