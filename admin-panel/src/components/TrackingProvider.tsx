'use client'

import { useEffect } from 'react'
import Script from 'next/script'

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

/** Validate URL for script sources */
function isValidScriptUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:'
  } catch {
    return false
  }
}

interface CustomScript {
  id: string
  name: string
  location: 'head' | 'body'
  content: string
  category: 'essential' | 'analytics' | 'marketing'
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
  scripts?: CustomScript[]
}

interface TrackingProviderProps {
  config: PublicIntegrationsConfig | null
}

export default function TrackingProvider({ config }: TrackingProviderProps) {
  if (!config) return null

  const {
    gtm_container_id: rawGtmId,
    gtm_server_container_url: rawGtmServerUrl,
    facebook_pixel_id: rawFbPixelId,
    umami_website_id: rawUmamiId,
    umami_script_url: rawUmamiScriptUrl = 'https://cloud.umami.is/script.js',
    cookie_consent_enabled,
    consent_logging_enabled,
    scripts = []
  } = config

  // Validate integration IDs to prevent script injection via DB config
  const gtm_container_id = rawGtmId && isValidGtmId(rawGtmId) ? rawGtmId : null
  const facebook_pixel_id = rawFbPixelId && isValidFbPixelId(rawFbPixelId) ? rawFbPixelId : null
  const umami_website_id = rawUmamiId && isValidUmamiId(rawUmamiId) ? rawUmamiId : null
  const umami_script_url = rawUmamiScriptUrl && isValidScriptUrl(rawUmamiScriptUrl) ? rawUmamiScriptUrl : 'https://cloud.umami.is/script.js'

  // GTM base URL - use server container if configured, otherwise default Google URL
  const gtmBaseUrl = rawGtmServerUrl && isValidScriptUrl(rawGtmServerUrl)
    ? rawGtmServerUrl.replace(/\/$/, '')
    : 'https://www.googletagmanager.com'

  // --- GOOGLE CONSENT MODE V2 DEFAULTS ---
  // This script MUST run before GTM to set default consent state
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

  // --- KLARO CONFIG ---
  const klaroConfig = {
    version: 1,
    elementID: 'klaro',
    styling: { theme: 'default' },
    noAutoLoad: false,
    htmlTexts: true,
    embedded: false,
    groupByPurpose: true,
    storageMethod: 'cookie',
    cookieName: 'gateflow_consent',
    cookieExpiresAfterDays: 365,
    default: false,
    mustConsent: false,
    acceptAll: true,
    hideDeclineAll: false,
    hideLearnMore: false,
    translations: {
      en: {
        consentModal: {
          title: 'We use cookies',
          description: 'We use cookies to improve your experience and analyze traffic.',
        },
        purposes: {
          analytics: 'Analytics',
          marketing: 'Marketing',
        },
      },
    },
    services: [] as any[],
    // NOTE: callback is NOT included here because JSON.stringify drops functions.
    // It is appended as raw JS after serialization — see klaroCallbackJs below.
  }

  // 1. Add Managed Services
  if (gtm_container_id) {
    klaroConfig.services.push({
      name: 'google-tag-manager',
      title: 'Google Tag Manager',
      purposes: ['analytics'],
      required: false,
    })
  }
  if (facebook_pixel_id) {
    klaroConfig.services.push({
      name: 'facebook-pixel',
      title: 'Meta Pixel',
      purposes: ['marketing'],
      required: false,
    })
  }
  if (umami_website_id) {
    klaroConfig.services.push({
      name: 'umami-analytics',
      title: 'Umami Analytics',
      purposes: ['analytics'],
      required: false,
    })
  }

  // 2. Add Custom Scripts to Klaro (if consent required)
  scripts.forEach(script => {
    if (cookie_consent_enabled && script.category !== 'essential') {
        klaroConfig.services.push({
            name: `script-${script.id}`,
            title: script.name,
            purposes: [script.category],
            required: false
        })
    }
  })

  // --- KLARO CALLBACK (raw JS, appended after JSON.stringify) ---
  // JSON.stringify drops functions, so the callback must be a raw JS string.
  //
  // IMPORTANT: Klaro v0.7 calls config.callback(consent, service) once PER SERVICE,
  // where consent is a BOOLEAN (true/false) and service is the service config object.
  // It is NOT called once with an object of all consents.
  // We accumulate consent state in window.__gfConsents and debounce the logging POST.
  const klaroCallbackJs = `
klaroConfig.callback = function(consent, service) {
  // Accumulate per-service consent into a single object
  window.__gfConsents = window.__gfConsents || {};
  window.__gfConsents[service.name] = consent;

  // Google Consent Mode V2 update (safe to call on each service change)
  if (typeof window.gtag === 'function') {
    var analyticsGranted = window.__gfConsents['google-tag-manager'] === true;
    var marketingGranted = window.__gfConsents['facebook-pixel'] === true;
    window.gtag('consent', 'update', {
      'analytics_storage': analyticsGranted ? 'granted' : 'denied',
      'ad_storage': marketingGranted ? 'granted' : 'denied',
      'ad_user_data': marketingGranted ? 'granted' : 'denied',
      'ad_personalization': marketingGranted ? 'granted' : 'denied'
    });
  }

  // Debounced consent logging — fires once after all services are processed
  if (window.__gfConsentLogging) {
    clearTimeout(window.__gfConsentLogTimer);
    window.__gfConsentLogTimer = setTimeout(function() {
      try {
        var anonId = localStorage.getItem('gf_anonymous_id');
        if (!anonId) {
          anonId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
          });
          localStorage.setItem('gf_anonymous_id', anonId);
        }
        fetch('/api/consent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ anonymous_id: anonId, consents: window.__gfConsents, consent_version: '1' })
        }).catch(function() {});
      } catch (e) {}
    }, 100);
  }
};`

  // --- RENDER HELPERS ---

  const renderScript = (script: CustomScript) => {
    // Basic heuristics to detect if content is wrapped in <script> tags
    // If user pasted "<script>...</script>", we strip tags to use with Next/Script or DangerouslySet
    // If user pasted raw JS "console.log()", we wrap it.
    
    let content = script.content.trim()
    const hasScriptTag = content.startsWith('<script')
    
    // Extract inner content if wrapped
    if (hasScriptTag) {
        content = content.replace(/^<script[^>]*>|<\/script>$/g, '')
    }

    // Determine Logic
    const requiresConsent = cookie_consent_enabled && script.category !== 'essential'
    
    // Props for the script
    const scriptProps: any = {
        id: `script-${script.id}`,
        dangerouslySetInnerHTML: { __html: content }
    }

    if (requiresConsent) {
        scriptProps.type = 'text/plain'
        scriptProps['data-type'] = 'application/javascript'
        scriptProps['data-name'] = `script-${script.id}`
    }

    // Use Next Script for Head/Body injection
    // Note: strategy='afterInteractive' is default. 
    // For 'head', we can try 'beforeInteractive' or rely on Next.js placement.
    // Ideally we'd use portal to head for 'head' scripts, but Script handles it.
    
    return <Script key={script.id} {...scriptProps} />
  }

  return (
    <>
      {/* GOOGLE CONSENT MODE V2 DEFAULTS - Must be FIRST, before GTM */}
      {/* Only set denied defaults when cookie consent is enabled — Klaro callback will update to granted */}
      {/* When consent is disabled, GTM runs unrestricted (no consent mode needed) */}
      {gtm_container_id && cookie_consent_enabled && (
        <Script
          id="consent-mode-defaults"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: consentModeDefaults }}
        />
      )}

      {/* KLARO INIT */}
      {cookie_consent_enabled && (
        <>
          {/* Consent logging flag — must be set before klaroConfig callback runs */}
          {consent_logging_enabled && (
            <Script
              id="consent-logging-flag"
              strategy="beforeInteractive"
              dangerouslySetInnerHTML={{
                __html: `window.__gfConsentLogging = true;`
              }}
            />
          )}
          <Script
            id="klaro-config"
            strategy="beforeInteractive"
            dangerouslySetInnerHTML={{
              // Escape </script> sequences to prevent HTML parser from closing the tag early (XSS via DB)
              __html: `var klaroConfig = ${JSON.stringify(klaroConfig).replace(/<\//g, '<\\/')};\n${klaroCallbackJs}`
            }}
          />
          <Script
            id="klaro-script"
            src="https://cdn.kiprotect.com/klaro/v0.7/klaro.js"
            strategy="afterInteractive"
          />
        </>
      )}

      {/* MANAGED SCRIPTS */}
      {gtm_container_id && (
        <Script
          id="gtm-script"
          type={cookie_consent_enabled ? "text/plain" : "text/javascript"}
          data-type={cookie_consent_enabled ? "application/javascript" : undefined}
          data-name={cookie_consent_enabled ? "google-tag-manager" : undefined}
          dangerouslySetInnerHTML={{
            __html: `(function(w,d,s,l,i,u){w[l]=w[l]||[];w[l].push({'gtm.start':
            new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
            j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
            u+'/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
            })(window,document,'script','dataLayer','${gtm_container_id}','${gtmBaseUrl}');`
          }}
        />
      )}

      {facebook_pixel_id && (
        <Script
          id="fb-pixel"
          type={cookie_consent_enabled ? "text/plain" : "text/javascript"}
          data-type={cookie_consent_enabled ? "application/javascript" : undefined}
          data-name={cookie_consent_enabled ? "facebook-pixel" : undefined}
          dangerouslySetInnerHTML={{
            __html: `!function(f,b,e,v,n,t,s)
            {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)}(window, document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');
            fbq('init', '${facebook_pixel_id}');
            fbq('track', 'PageView');`
          }}
        />
      )}

      {umami_website_id && (
        <Script
          id="umami-script"
          src={umami_script_url || 'https://cloud.umami.is/script.js'}
          strategy="afterInteractive"
          data-website-id={umami_website_id}
          type={cookie_consent_enabled ? "text/plain" : "text/javascript"}
          data-type={cookie_consent_enabled ? "application/javascript" : undefined}
          data-name={cookie_consent_enabled ? "umami-analytics" : undefined}
        />
      )}

      {/* CUSTOM SCRIPTS */}
      {scripts.map(script => renderScript(script))}
    </>
  )
}