/**
 * Sellf - Professional Content Access Control System
 * Version 1.0.0 - Complete Refactor
 * 
 * 🎯 FEATURES:
 * • Domain-based licensing with watermark system
 * • Multi-mode content protection (page/element/toggle)
 * • Supabase integration for user authentication
 * • Advanced caching and performance optimization
 * • Comprehensive analytics and event tracking
 * • Robust error handling and security measures
 * 
 * 📋 USAGE:
 * Served dynamically via /api/sellf endpoint
 * Configuration automatically injected by GatekeeperGenerator
 * 
 * 📄 LICENSE: Freemium - Free with watermark, $49/domain/year for removal
 * 🌐 Website: https://sellf.app | 📧 Support: support@sellf.app
 */

// ============================================================================
// CORE CONSTANTS & CONFIGURATION
// ============================================================================

const CONSTANTS = {
    VERSION: '1.0.0',
    CACHE_TTL: 300000, // 5 minutes
    // License expiry value for unlimited licenses
    LICENSE_UNLIMITED: 'UNLIMITED',
    QUERY_TIMEOUT: 3000,
    MAX_RETRIES: 3,
    PROCESSING_DELAY: 100,
    
    // Database errors
    DUPLICATE_KEY_ERROR: '23505',
    
    // License public key for offline verification (ECDSA P-256)
    // Only the private key holder (Sellf) can generate valid licenses
    LICENSE_PUBLIC_KEY: `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE8K2XLvuxHQsCMSvBLemkdpMZqXpy
LeS3pFS7JyEEyi9Kew8TADDYBKh7mVLJSxqfXfy4H0qsCwy2S+zMdoCiIg==
-----END PUBLIC KEY-----`,
    
    // Event names
    EVENTS: {
        ACCESS_GRANTED: 'sellf_access_granted',
        ACCESS_DENIED: 'sellf_access_denied',
        LOGIN_SHOWN: 'sellf_login_shown',
        MAGIC_LINK_SENT: 'sellf_magic_link_sent',
        FREE_ACCESS_GRANTED: 'sellf_free_access_granted',
        ELEMENT_PROTECTED: 'sellf_element_protected',
        ELEMENT_ACCESSED: 'sellf_element_accessed',
        BATCH_CHECK: 'sellf_batch_check',
        ERROR: 'sellf_error',
        PERFORMANCE: 'sellf_performance',
        LICENSE_VALID: 'sellf_license_valid',
        LICENSE_INVALID: 'sellf_license_invalid'
    },
    
    // Fallback modes
    FALLBACK_MODES: {
        SHOW_ALL: 'show_all',
        HIDE_ALL: 'hide_all',
        SHOW_FREE: 'show_free'
    }
};

// ============================================================================
// INTERNATIONALIZATION (i18n)
// ============================================================================

/**
 * Built-in translations - auto-detected from <html lang="..."> or navigator.language
 */
const TRANSLATIONS = {
    en: {
        // Loading & status
        checking_access: 'Checking access...',
        please_wait: 'Please wait while we verify your access',
        powered_by: 'Powered by Sellf',
        secured_by: 'Secured by',

        // Errors
        something_wrong: 'Something went wrong',
        temporary_issue: 'We encountered a temporary issue. Please try again.',
        debug_info: 'Debug Info',
        try_again: 'Try Again',
        product_page: 'Product Page',
        error_at: 'Error at',

        // Login form
        access_required: 'Access Required',
        sign_in_to_access: 'Sign in to access this content',
        email_address: 'Email address',
        email_placeholder: 'name@example.com',
        send_access_link: 'Send Access Link',
        no_access_yet: "Don't have access yet?",
        get_access_now: 'Get Access Now',

        // Watermark
        get_license: 'Get license to remove this notice',

        // Magic link
        magic_link_sent: 'Access link sent!',
        check_inbox: 'Check your inbox and click the link to access this content.',
        sending: 'Sending...',
        error_sending: 'Error sending link. Please try again.'
    },
    pl: {
        // Loading & status
        checking_access: 'Sprawdzanie dostępu...',
        please_wait: 'Proszę czekać, weryfikujemy Twój dostęp',
        powered_by: 'Powered by Sellf',
        secured_by: 'Zabezpieczone przez',

        // Errors
        something_wrong: 'Coś poszło nie tak',
        temporary_issue: 'Wystąpił tymczasowy problem. Spróbuj ponownie.',
        debug_info: 'Informacje debugowania',
        try_again: 'Spróbuj ponownie',
        product_page: 'Strona produktu',
        error_at: 'Błąd o',

        // Login form
        access_required: 'Wymagany dostęp',
        sign_in_to_access: 'Zaloguj się, aby uzyskać dostęp',
        email_address: 'Adres email',
        email_placeholder: 'nazwa@example.com',
        send_access_link: 'Wyślij link dostępu',
        no_access_yet: 'Nie masz jeszcze dostępu?',
        get_access_now: 'Uzyskaj dostęp',

        // Watermark
        get_license: 'Kup licencję, aby usunąć tę informację',

        // Magic link
        magic_link_sent: 'Link dostępu wysłany!',
        check_inbox: 'Sprawdź skrzynkę i kliknij link, aby uzyskać dostęp.',
        sending: 'Wysyłanie...',
        error_sending: 'Błąd wysyłania. Spróbuj ponownie.'
    },
    de: {
        checking_access: 'Zugriff wird überprüft...',
        please_wait: 'Bitte warten Sie, während wir Ihren Zugriff überprüfen',
        powered_by: 'Powered by Sellf',
        secured_by: 'Gesichert durch',
        something_wrong: 'Etwas ist schief gelaufen',
        temporary_issue: 'Ein vorübergehendes Problem ist aufgetreten. Bitte versuchen Sie es erneut.',
        debug_info: 'Debug-Info',
        try_again: 'Erneut versuchen',
        product_page: 'Produktseite',
        error_at: 'Fehler um',
        access_required: 'Zugriff erforderlich',
        sign_in_to_access: 'Melden Sie sich an, um auf diesen Inhalt zuzugreifen',
        email_address: 'E-Mail-Adresse',
        email_placeholder: 'name@beispiel.de',
        send_access_link: 'Zugangslink senden',
        no_access_yet: 'Noch keinen Zugang?',
        get_access_now: 'Jetzt Zugang erhalten',
        get_license: 'Lizenz erwerben, um diesen Hinweis zu entfernen',
        magic_link_sent: 'Zugangslink gesendet!',
        check_inbox: 'Überprüfen Sie Ihren Posteingang und klicken Sie auf den Link.',
        sending: 'Wird gesendet...',
        error_sending: 'Fehler beim Senden. Bitte erneut versuchen.'
    },
    fr: {
        checking_access: 'Vérification de l\'accès...',
        please_wait: 'Veuillez patienter pendant la vérification de votre accès',
        powered_by: 'Powered by Sellf',
        secured_by: 'Sécurisé par',
        something_wrong: 'Une erreur s\'est produite',
        temporary_issue: 'Un problème temporaire s\'est produit. Veuillez réessayer.',
        debug_info: 'Info de débogage',
        try_again: 'Réessayer',
        product_page: 'Page produit',
        error_at: 'Erreur à',
        access_required: 'Accès requis',
        sign_in_to_access: 'Connectez-vous pour accéder à ce contenu',
        email_address: 'Adresse e-mail',
        email_placeholder: 'nom@exemple.fr',
        send_access_link: 'Envoyer le lien d\'accès',
        no_access_yet: 'Pas encore d\'accès?',
        get_access_now: 'Obtenir l\'accès',
        get_license: 'Obtenez une licence pour supprimer cet avis',
        magic_link_sent: 'Lien d\'accès envoyé!',
        check_inbox: 'Vérifiez votre boîte de réception et cliquez sur le lien.',
        sending: 'Envoi en cours...',
        error_sending: 'Erreur d\'envoi. Veuillez réessayer.'
    },
    es: {
        checking_access: 'Verificando acceso...',
        please_wait: 'Por favor espere mientras verificamos su acceso',
        powered_by: 'Powered by Sellf',
        secured_by: 'Protegido por',
        something_wrong: 'Algo salió mal',
        temporary_issue: 'Ocurrió un problema temporal. Por favor, inténtelo de nuevo.',
        debug_info: 'Info de depuración',
        try_again: 'Intentar de nuevo',
        product_page: 'Página del producto',
        error_at: 'Error a las',
        access_required: 'Acceso requerido',
        sign_in_to_access: 'Inicie sesión para acceder a este contenido',
        email_address: 'Correo electrónico',
        email_placeholder: 'nombre@ejemplo.es',
        send_access_link: 'Enviar enlace de acceso',
        no_access_yet: '¿Aún no tiene acceso?',
        get_access_now: 'Obtener acceso',
        get_license: 'Obtenga una licencia para eliminar este aviso',
        magic_link_sent: '¡Enlace de acceso enviado!',
        check_inbox: 'Revise su bandeja de entrada y haga clic en el enlace.',
        sending: 'Enviando...',
        error_sending: 'Error al enviar. Por favor, inténtelo de nuevo.'
    }
};

/**
 * Internationalization helper - auto-detects language
 */
class I18n {
    static _lang = null;

    /**
     * Detect language from <html lang="..."> or navigator.language
     */
    static detectLanguage() {
        if (this._lang) return this._lang;

        // Priority: <html lang> > navigator.language > 'en'
        const htmlLang = document.documentElement.lang?.split('-')[0]?.toLowerCase();
        const navLang = navigator.language?.split('-')[0]?.toLowerCase();

        const detected = htmlLang || navLang || 'en';
        this._lang = TRANSLATIONS[detected] ? detected : 'en';

        return this._lang;
    }

    /**
     * Get translation for key
     * @param {string} key - Translation key
     * @param {Object} params - Optional parameters for interpolation
     */
    static t(key, params = {}) {
        const lang = this.detectLanguage();
        let text = TRANSLATIONS[lang]?.[key] || TRANSLATIONS['en']?.[key] || key;

        // Simple parameter interpolation: {name} -> value
        Object.entries(params).forEach(([k, v]) => {
            text = text.split(`{${k}}`).join(String(v));
        });

        return text;
    }

    /**
     * Get current language code
     */
    static getLang() {
        return this.detectLanguage();
    }

    /**
     * Force a specific language (useful for testing)
     */
    static setLang(lang) {
        this._lang = TRANSLATIONS[lang] ? lang : 'en';
    }
}

// ============================================================================
// CRITICAL CSS INJECTION (CSS-first content hiding)
// ============================================================================

/**
 * Inject critical CSS immediately to hide protected content before JS executes
 * This prevents content flash and doesn't require data-original-content storage
 */
(function injectCriticalCSS() {
    if (document.getElementById('sellf-critical-css')) return;

    const style = document.createElement('style');
    style.id = 'sellf-critical-css';
    style.textContent = `
        /* Hide protected content until processed */
        [data-sellf-product] {
            visibility: hidden !important;
            opacity: 0 !important;
        }
        [data-sellf-product].sellf-processed {
            visibility: visible !important;
            opacity: 1 !important;
            transition: opacity 0.3s ease;
        }
        /* Hide has-access content by default (show only after check) */
        [data-sellf-product] [data-has-access] {
            display: none !important;
        }
        /* Show no-access content by default */
        [data-sellf-product] [data-no-access] {
            display: block !important;
        }
        /* After processing - flip visibility for users WITH access */
        [data-sellf-product].sellf-has-access [data-has-access] {
            display: block !important;
        }
        [data-sellf-product].sellf-has-access [data-no-access] {
            display: none !important;
        }
        /* After processing - keep no-access visible for users WITHOUT access */
        [data-sellf-product].sellf-no-access [data-has-access] {
            display: none !important;
        }
        [data-sellf-product].sellf-no-access [data-no-access] {
            display: block !important;
        }
    `;

    // Insert at the very beginning of head for highest priority
    const head = document.head || document.getElementsByTagName('head')[0];
    if (head) {
        head.insertBefore(style, head.firstChild);
    }
})();

// ============================================================================
// CORE CLASSES
// ============================================================================

/**
 * Logger class for environment-aware error handling
 * In development: logs to console
 * In production: silent (graceful degradation)
 */
class Logger {
    static isDev() {
        const config = typeof GATEKEEPER_CONFIG !== 'undefined' ? GATEKEEPER_CONFIG : {};
        return config.ENVIRONMENT === 'development' ||
               window.location.hostname === 'localhost' ||
               window.location.hostname === '127.0.0.1';
    }

    static error(context, error) {
        if (this.isDev()) {
            console.error(`[Sellf] ${context}:`, error);
        }
        // Always track errors for analytics (even in production)
        Analytics.track(CONSTANTS.EVENTS.ERROR, {
            context,
            error: error?.message || String(error)
        });
    }

    static warn(message) {
        if (this.isDev()) {
            console.warn(`[Sellf] ${message}`);
        }
    }

    static info(message) {
        if (this.isDev()) {
            console.log(`[Sellf] ${message}`);
        }
    }

    static debug(message, data = null) {
        if (this.isDev()) {
            if (data) {
                console.log(`[Sellf] ${message}`, data);
            } else {
                console.log(`[Sellf] ${message}`);
            }
        }
    }
}

/**
 * Advanced caching system with TTL and on-demand cleanup (no setInterval)
 */
class CacheManager {
    constructor() {
        this.cache = new Map();
        this.lastCleanup = Date.now();
    }

    generateKey(type, ...args) {
        return `${type}_${args.join('_')}`;
    }

    get(key) {
        // On-demand cleanup every 60 seconds
        if (Date.now() - this.lastCleanup > 60000) {
            this.cleanup();
        }

        const cached = this.cache.get(key);
        if (!cached) return null;

        if (Date.now() - cached.timestamp > cached.ttl) {
            this.cache.delete(key);
            return null;
        }

        Analytics.track(CONSTANTS.EVENTS.PERFORMANCE, {
            action: 'cache_hit',
            key: key.split('_')[0]
        });
        return cached.data;
    }

    set(key, data, ttl = CONSTANTS.CACHE_TTL) {
        this.cache.set(key, {
            data,
            timestamp: Date.now(),
            ttl
        });
    }

    delete(key) {
        this.cache.delete(key);
    }

    clear() {
        this.cache.clear();
    }

    cleanup() {
        const now = Date.now();
        for (const [key, entry] of this.cache.entries()) {
            if (now - entry.timestamp > entry.ttl) {
                this.cache.delete(key);
            }
        }
        this.lastCleanup = now;
    }

    destroy() {
        this.clear();
    }
}

/**
 * Comprehensive analytics and event tracking system
 */
class Analytics {
    static track(event, data = {}) {
        try {
            const eventData = {
                ...data,
                timestamp: new Date().toISOString(),
                url: window.location.href,
                userAgent: navigator.userAgent,
                sellf_version: CONSTANTS.VERSION,
                license_status: LicenseManager.getStatus().valid ? 'licensed' : 'unlicensed',
                viewport: {
                    width: window.innerWidth,
                    height: window.innerHeight
                },
                user_id: SessionManager.getCurrentUserId(),
                session_duration: SessionManager.getSessionDuration(),
                performance: {
                    memory: performance.memory ? {
                        used: performance.memory.usedJSHeapSize,
                        total: performance.memory.totalJSHeapSize
                    } : null,
                    timing: performance.timing ? {
                        load: performance.timing.loadEventEnd - performance.timing.navigationStart
                    } : null
                }
            };
            
            // Add device info
            if (navigator.userAgentData?.platform) {
                eventData.platform = navigator.userAgentData.platform;
            }
            
            // Send to analytics providers
            this.sendToProviders(event, eventData);
            
        } catch (error) {
            // Silent error handling
        }
    }
    
    static sendToProviders(event, data) {
        // Google Analytics
        if (window.gtag) {
            window.gtag('event', event, data);
        }
        
        // Segment
        if (window.analytics) {
            window.analytics.track(event, data);
        }
        
        // Facebook Pixel
        if (window.fbq) {
            window.fbq('trackCustom', event, data);
        }
        
        // Custom analytics endpoint
        const config = this.getConfig();
        if (config.analyticsEndpoint) {
            try {
                fetch(config.analyticsEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ event, data })
                });
            } catch (e) {
                // Silent error handling
            }
        }
    }
    
    static getConfig() {
        return window.sellfConfig || {};
    }
}

/**
 * License verification using ECDSA digital signatures
 *
 * License format: SF-{domain}-{expiry}-{base64_signature}
 * - domain: hostname the license is valid for
 * - expiry: YYYYMMDD or "UNLIMITED" for perpetual licenses
 * - signature: ECDSA-SHA256 signature (base64url encoded)
 *
 * Only Sellf (holder of private key) can generate valid licenses.
 * Public key verification is completely offline - no server needed.
 */
class LicenseManager {
    static status = { valid: false, domain: null, expires: null, showWatermark: true };

    /**
     * Verify license and update status
     */
    static async checkLicense() {
        const config = window.sellfConfig || {};
        const licenseKey = config.sellfLicense;

        if (!licenseKey) {
            this.status = { valid: false, showWatermark: true, reason: 'no_license' };
            return false;
        }

        try {
            const result = await this.verifyLicenseOffline(licenseKey);

            if (result.valid) {
                this.status = {
                    valid: true,
                    domain: result.domain,
                    expires: result.expires,
                    showWatermark: false
                };

                Analytics.track(CONSTANTS.EVENTS.LICENSE_VALID, {
                    domain: result.domain,
                    expires: result.expires
                });

                return true;
            } else {
                this.status = {
                    valid: false,
                    showWatermark: true,
                    reason: result.reason
                };

                Analytics.track(CONSTANTS.EVENTS.LICENSE_INVALID, {
                    domain: window.location.hostname,
                    reason: result.reason
                });

                return false;
            }
        } catch (error) {
            this.status = { valid: false, showWatermark: true, reason: 'verification_error' };
            return false;
        }
    }

    /**
     * Verify license offline using ECDSA public key
     */
    static async verifyLicenseOffline(licenseKey) {
        // Parse license: SF-domain.com-20261231-base64signature
        // or: SF-domain.com-UNLIMITED-base64signature
        const parts = licenseKey.split('-');

        if (parts.length < 4 || parts[0] !== 'SF') {
            return { valid: false, reason: 'invalid_format' };
        }

        const domain = parts[1];
        const expiry = parts[2];
        // Signature is everything after third dash (base64 may contain dashes)
        const signature = parts.slice(3).join('-');

        // Check domain matches current hostname
        const currentDomain = window.location.hostname;
        if (domain !== currentDomain && domain !== `*.${currentDomain.split('.').slice(-2).join('.')}`) {
            return { valid: false, reason: 'domain_mismatch' };
        }

        // Check expiry date (skip for UNLIMITED)
        if (expiry !== CONSTANTS.LICENSE_UNLIMITED) {
            const expiryDate = this.parseExpiryDate(expiry);
            if (!expiryDate || expiryDate < new Date()) {
                return { valid: false, reason: 'license_expired' };
            }
        }

        // Verify cryptographic signature
        const dataToVerify = `${domain}-${expiry}`;
        const isValidSignature = await this.verifySignature(dataToVerify, signature);

        if (!isValidSignature) {
            return { valid: false, reason: 'invalid_signature' };
        }

        return {
            valid: true,
            domain: domain,
            expires: expiry === CONSTANTS.LICENSE_UNLIMITED ? null : this.parseExpiryDate(expiry)
        };
    }

    /**
     * Parse expiry date from YYYYMMDD format
     */
    static parseExpiryDate(expiry) {
        if (!/^\d{8}$/.test(expiry)) return null;
        const year = parseInt(expiry.slice(0, 4));
        const month = parseInt(expiry.slice(4, 6)) - 1;
        const day = parseInt(expiry.slice(6, 8));
        return new Date(year, month, day, 23, 59, 59);
    }

    /**
     * Verify ECDSA signature using public key
     */
    static async verifySignature(data, signatureBase64) {
        try {
            // Import public key
            const publicKey = await crypto.subtle.importKey(
                'spki',
                this.pemToArrayBuffer(CONSTANTS.LICENSE_PUBLIC_KEY),
                { name: 'ECDSA', namedCurve: 'P-256' },
                false,
                ['verify']
            );

            // Decode signature from base64url
            const signature = this.base64urlToArrayBuffer(signatureBase64);

            // Encode data to verify
            const dataBuffer = new TextEncoder().encode(data);

            // Verify signature
            return await crypto.subtle.verify(
                { name: 'ECDSA', hash: 'SHA-256' },
                publicKey,
                signature,
                dataBuffer
            );
        } catch (error) {
            console.error('[Sellf] Signature verification error:', error);
            return false;
        }
    }

    /**
     * Convert PEM to ArrayBuffer
     */
    static pemToArrayBuffer(pem) {
        const base64 = pem
            .replace(/-----BEGIN PUBLIC KEY-----/, '')
            .replace(/-----END PUBLIC KEY-----/, '')
            .replace(/[\r\n\s]/g, '');
        return this.base64ToArrayBuffer(base64);
    }

    /**
     * Convert base64 to ArrayBuffer
     */
    static base64ToArrayBuffer(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }

    /**
     * Convert base64url to ArrayBuffer
     */
    static base64urlToArrayBuffer(base64url) {
        // Convert base64url to base64
        let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
        // Add padding if needed
        while (base64.length % 4) base64 += '=';
        return this.base64ToArrayBuffer(base64);
    }

    static getStatus() {
        return this.status;
    }

    /**
     * Create watermark badge for unlicensed installations
     */
    static createWatermark() {
        // Check server-side license validation first (set by generator)
        if (typeof GATEKEEPER_CONFIG !== 'undefined' && GATEKEEPER_CONFIG.LICENSE_VALID === true) {
            return;
        }
        // Fallback to client-side status (for backwards compatibility)
        if (this.status.valid) return;
        if (document.getElementById('sellf-watermark')) return;

        const watermark = document.createElement('div');
        watermark.id = 'sellf-watermark';
        watermark.innerHTML = `
            <div style="
                position: fixed;
                bottom: 20px;
                right: 20px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 12px 20px;
                border-radius: 25px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 13px;
                font-weight: 600;
                box-shadow: 0 4px 20px rgba(0,0,0,0.15);
                backdrop-filter: blur(10px);
                border: 1px solid rgba(255,255,255,0.2);
                z-index: 999999;
                cursor: pointer;
                transition: transform 0.3s ease;
                user-select: none;
            " onmouseover="this.style.transform='scale(1.05)'"
               onmouseout="this.style.transform='scale(1)'"
               onclick="window.open('https://sellf.app/pricing', '_blank')">
                <span style="margin-right: 8px;">🔐</span>
                ${I18n.t('secured_by')} <strong>Sellf</strong> v${CONSTANTS.VERSION}
                <div style="font-size: 10px; opacity: 0.8; margin-top: 2px;">
                    ${I18n.t('get_license')}
                </div>
            </div>
        `;
        document.body.appendChild(watermark);
    }
}

/**
 * User session and authentication management
 */
class SessionManager {
    static currentUserId = null;
    static sessionStartTime = null;
    static accessGrantedTime = null;
    static supabaseClient = null;
    
    static initialize(supabaseClient) {
        this.supabaseClient = supabaseClient;
        this.sessionStartTime = Date.now();
        
        // Handle session from URL hash (magic link callback)
        this.handleSessionFromUrl();
        
        // Check for existing session
        this.initializeCurrentSession();
        
        // Listen for auth state changes
        this.supabaseClient.auth.onAuthStateChange((event, session) => {
            if (session?.user) {
                this.currentUserId = session.user.id;
                this.accessGrantedTime = Date.now();
                
                Analytics.track(CONSTANTS.EVENTS.ACCESS_GRANTED, {
                    user_id: this.currentUserId,
                    event_type: event
                });
                
                // Clean up URL after successful login
                if (event === 'SIGNED_IN' && window.location.hash) {
                    window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
                }
            } else {
                this.currentUserId = null;
                this.accessGrantedTime = null;
                
                Analytics.track(CONSTANTS.EVENTS.ACCESS_DENIED, {
                    event_type: event
                });
            }
        });
    }
    
    static async initializeCurrentSession() {
        try {
            const { data: { session } } = await this.supabaseClient.auth.getSession();
            if (session?.user) {
                this.currentUserId = session.user.id;
                this.accessGrantedTime = Date.now();
            }
        } catch (error) {
            Logger.error('initializeCurrentSession', error);
        }
    }
    
    static handleSessionFromUrl() {
        // Check if we have session tokens in URL hash
        const hash = window.location.hash;
        if (hash && hash.includes('access_token=')) {
            try {
                // Clean up the hash (remove any duplicate # characters)
                const cleanHash = hash.replace(/^#+/, '#');
                
                // Parse the hash parameters
                const params = new URLSearchParams(cleanHash.substring(1));
                const accessToken = params.get('access_token');
                const refreshToken = params.get('refresh_token');
                const tokenType = params.get('token_type');
                const expiresIn = params.get('expires_in');
                

                if (accessToken) {
                    // Manually set the session using Supabase's setSession
                    this.supabaseClient.auth.setSession({
                        access_token: accessToken,
                        refresh_token: refreshToken || null
                    }).then(({ data: { session }, error }) => {
                        if (error) {
                            return;
                        }
                        
                        if (session) {
                            this.currentUserId = session.user.id;
                            this.accessGrantedTime = Date.now();
                            
                            // Clean up URL
                            window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
                            
                            // Refresh page to apply new session state
                            window.location.reload();
                        }
                    });
                }
            } catch (error) {
                Logger.error('handleSessionFromUrl', error);
            }
        }
    }

    static getCurrentUserId() {
        return this.currentUserId;
    }
    
    static getSessionDuration() {
        return this.sessionStartTime ? Date.now() - this.sessionStartTime : 0;
    }
}

/**
 * Unified access control system
 */
class AccessControl {
    static async batchCheckAccess(productSlugs, userId = null) {
        const results = {};

        // Check cache first
        for (const slug of productSlugs) {
            const cacheKey = cache.generateKey('access', slug, 'current');
            const cached = cache.get(cacheKey);
            if (cached !== null) {
                results[slug] = cached;
            }
        }

        // Get uncached slugs
        const uncachedSlugs = productSlugs.filter(slug => !(slug in results));

        if (uncachedSlugs.length === 0) {
            return results;
        }

        try {
            // Check if we're on a different domain than the main domain
            const mainDomain = window.GATEKEEPER_CONFIG?.MAIN_DOMAIN || 'localhost:3000';

            // Always use cross-domain API for access checking
            const batchResults = await this.getCrossDomainBatchAccess(mainDomain, uncachedSlugs);
            
            // Cache results
            for (const slug of uncachedSlugs) {
                const hasAccess = batchResults[slug] || false;
                results[slug] = hasAccess;
                cache.set(cache.generateKey('access', slug, 'current'), hasAccess);
            }
            
            Analytics.track(CONSTANTS.EVENTS.BATCH_CHECK, {
                slugs_count: uncachedSlugs.length
            });
            
            return results;
        } catch (error) {
            // Return cached results only, mark uncached as no access
            for (const slug of uncachedSlugs) {
                results[slug] = false;
                cache.set(cache.generateKey('access', slug, 'current'), false, 30000); // Short cache for failed requests
            }
            return results;
        }
    }
    
    static async getCrossDomainAccess(mainDomain, productSlug) {
        try {
            let protocol = window.location.protocol;
            if (protocol === 'file:') {
                protocol = 'http:';
            }
            const accessUrl = `${protocol}//${mainDomain}/api/access`;

            const response = await fetch(accessUrl, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                    'X-Sellf-Origin': window.location.origin,
                    'X-Sellf-Version': CONSTANTS.VERSION
                },
                body: JSON.stringify({ productSlug })
            });

            if (!response.ok) return false;

            const data = await response.json();
            return data.hasAccess || false;
        } catch (error) {
            Logger.error('getCrossDomainAccess', error);
            return false;
        }
    }
    
    static async getCrossDomainBatchAccess(mainDomain, productSlugs) {
        try {
            let protocol = window.location.protocol;
            if (protocol === 'file:') {
                protocol = 'http:';
            }
            const accessUrl = `${protocol}//${mainDomain}/api/access`;

            const response = await fetch(accessUrl, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                    'X-Sellf-Origin': window.location.origin,
                    'X-Sellf-Version': CONSTANTS.VERSION
                },
                body: JSON.stringify({ productSlugs })
            });

            if (!response.ok) return {};

            const data = await response.json();
            return data.accessResults || {};
        } catch (error) {
            Logger.error('getCrossDomainBatchAccess', error);
            return {};
        }
    }
}

/**
 * Modern UI template system
 */
class UITemplates {
    /** Escape HTML special characters to prevent XSS in template interpolation */
    static escapeHtml(str) {
        if (typeof str !== 'string') return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    static getTheme() {
        return window.sellfConfig?.theme || 'default';
    }
    
    static getThemeColors(theme = 'default') {
        const themes = {
            default: {
                background: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.2)',
                textColor: '#e0e0e0',
                accentColor: '#00aaff'
            },
            dark: {
                background: 'rgba(0,0,0,0.8)',
                border: '1px solid rgba(255,255,255,0.1)',
                textColor: '#ffffff',
                accentColor: '#4facfe'
            },
            light: {
                background: 'rgba(255,255,255,0.95)',
                border: '1px solid rgba(0,0,0,0.1)',
                textColor: '#333333',
                accentColor: '#007bff'
            }
        };
        
        return themes[theme] || themes.default;
    }
    
    static getLoadingTemplate(message = null) {
        const theme = this.getThemeColors(this.getTheme());
        const displayMessage = message || I18n.t('checking_access');

        return `
        <div style="display: flex; justify-content: center; align-items: center; height: 100vh; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
            <div style="text-align: center; padding: 40px; background: ${theme.background}; border-radius: 16px; border: ${theme.border}; backdrop-filter: blur(10px); box-shadow: 0 8px 32px rgba(0,0,0,0.3);">
                <div style="font-size: 48px; margin-bottom: 24px; animation: pulse 2s ease-in-out infinite;">🔐</div>
                <div style="font-size: 20px; color: ${theme.textColor}; margin-bottom: 12px; font-weight: 600;">${displayMessage}</div>
                <div style="font-size: 14px; color: ${theme.textColor}; opacity: 0.7; margin-bottom: 24px;">${I18n.t('please_wait')}</div>
                <div style="width: 240px; height: 6px; background: rgba(255,255,255,0.2); border-radius: 3px; margin: 0 auto; overflow: hidden;">
                    <div style="width: 100%; height: 100%; background: linear-gradient(90deg, ${theme.accentColor}, ${theme.accentColor}dd); border-radius: 3px; animation: loading-bar 2s ease-in-out infinite;"></div>
                </div>
                <div style="margin-top: 20px; font-size: 12px; color: ${theme.textColor}; opacity: 0.5;">
                    ${I18n.t('powered_by')} v${CONSTANTS.VERSION}
                </div>
            </div>
            <style>
                @keyframes loading-bar {
                    0% { transform: translateX(-100%); }
                    50% { transform: translateX(0%); }
                    100% { transform: translateX(100%); }
                }
                @keyframes pulse {
                    0%, 100% { transform: scale(1); }
                    50% { transform: scale(1.1); }
                }
                @media (prefers-reduced-motion: reduce) {
                    * { animation: none !important; }
                }
            </style>
        </div>
        `;
    }
    
    static getErrorTemplate(error, productSlug = '') {
        const theme = this.getThemeColors(this.getTheme());
        const config = window.sellfConfig || {};
        const isDev = config.development || window.location.hostname === 'localhost';

        return `
        <div style="display: flex; justify-content: center; align-items: center; min-height: 100vh; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%); padding: 20px;">
            <div style="text-align: center; padding: 40px; background: ${theme.background}; border-radius: 20px; border: ${theme.border}; backdrop-filter: blur(10px); box-shadow: 0 8px 32px rgba(0,0,0,0.3); max-width: 500px; width: 100%;">
                <div style="font-size: 72px; margin-bottom: 24px; animation: shake 0.5s ease-in-out;">⚠️</div>
                <div style="font-size: 24px; color: #ff6b6b; margin-bottom: 16px; font-weight: 600;">${I18n.t('something_wrong')}</div>
                <div style="font-size: 16px; color: ${theme.textColor}; opacity: 0.8; margin-bottom: 24px; line-height: 1.5;">
                    ${isDev ? this.escapeHtml(error) : I18n.t('temporary_issue')}
                </div>
                ${isDev ? `
                <div style="font-size: 12px; color: #666; margin-bottom: 24px; padding: 16px; background: rgba(0,0,0,0.3); border-radius: 8px; font-family: monospace; text-align: left; word-break: break-word;">
                    <strong>${I18n.t('debug_info')}:</strong><br>${this.escapeHtml(error)}
                </div>
                ` : ''}
                <div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; margin-bottom: 24px;">
                    <button onclick="location.reload()" style="background: #00aaff; color: white; border: none; padding: 12px 24px; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 600; transition: all 0.3s ease;">
                        🔄 ${I18n.t('try_again')}
                    </button>
                    ${productSlug ? `
                    <a href="/?product=${encodeURIComponent(productSlug)}" style="background: #28a745; color: white; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 600; display: inline-block; transition: all 0.3s ease;">
                        🛒 ${I18n.t('product_page')}
                    </a>
                    ` : ''}
                </div>
                <div style="font-size: 12px; color: ${theme.textColor}; opacity: 0.4;">
                    ${I18n.t('error_at')} ${new Date().toLocaleString()} • Sellf v${CONSTANTS.VERSION}
                </div>
            </div>
            <style>
                @keyframes shake {
                    0%, 100% { transform: translateX(0); }
                    25% { transform: translateX(-5px); }
                    75% { transform: translateX(5px); }
                }
            </style>
        </div>
        `;
    }
    
    static getLoginTemplate(productSlug) {
        const theme = this.getThemeColors(this.getTheme());

        return `
        <div style="display: flex; justify-content: center; align-items: center; min-height: 100vh; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px;">
            <div style="width: 100%; max-width: 400px; background: ${theme.background}; border-radius: 20px; border: ${theme.border}; backdrop-filter: blur(10px); box-shadow: 0 8px 32px rgba(0,0,0,0.3); overflow: hidden;">
                <div style="padding: 40px;">
                    <div id="sellf-message-area" style="margin-bottom: 20px;"></div>

                    <div style="text-align: center; margin-bottom: 32px;">
                        <div style="font-size: 64px; margin-bottom: 16px;">🔐</div>
                        <h2 style="color: ${theme.textColor}; margin: 0 0 8px 0; font-size: 24px; font-weight: 600;">${I18n.t('access_required')}</h2>
                        <p style="color: ${theme.textColor}; opacity: 0.7; margin: 0; font-size: 16px;">${I18n.t('sign_in_to_access')}</p>
                    </div>

                    <form id="sellf-magic-link-form" style="margin-bottom: 24px;">
                        <div style="margin-bottom: 20px;">
                            <label for="sellf-email" style="display: block; color: ${theme.textColor}; font-weight: 500; margin-bottom: 8px; font-size: 14px;">${I18n.t('email_address')}</label>
                            <input type="email" id="sellf-email" placeholder="${I18n.t('email_placeholder')}" required
                                   style="width: 100%; padding: 12px 16px; border: 2px solid rgba(255,255,255,0.2); border-radius: 8px; background: rgba(255,255,255,0.1); color: ${theme.textColor}; font-size: 16px; transition: all 0.3s ease; box-sizing: border-box;">
                        </div>
                        <button type="submit" style="width: 100%; padding: 14px; background: linear-gradient(135deg, ${theme.accentColor}, ${theme.accentColor}dd); color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; transition: all 0.3s ease;">
                            ✨ ${I18n.t('send_access_link')}
                        </button>
                    </form>

                    <div style="text-align: center; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1);">
                        <p style="color: ${theme.textColor}; opacity: 0.6; margin: 0 0 16px 0; font-size: 14px;">
                            ${I18n.t('no_access_yet')}
                        </p>
                        <a href="/?product=${encodeURIComponent(productSlug)}" style="display: inline-block; padding: 10px 20px; background: rgba(255,255,255,0.1); color: ${theme.textColor}; text-decoration: none; border-radius: 6px; font-size: 14px; transition: all 0.3s ease; border: 1px solid rgba(255,255,255,0.2);">
                            🛒 ${I18n.t('get_access_now')}
                        </a>
                    </div>

                    <div style="margin-top: 24px; text-align: center; font-size: 12px; color: ${theme.textColor}; opacity: 0.4;">
                        ${I18n.t('secured_by')} Sellf v${CONSTANTS.VERSION}
                    </div>
                </div>
            </div>
        </div>
        `;
    }
}

/**
 * Enhanced error handling and fallback system
 */
class ErrorHandler {
    static handleError(error, context, productSlug = '') {
        const config = window.sellfConfig || {};
        const fallbackMode = config.fallbackMode || CONSTANTS.FALLBACK_MODES.HIDE_ALL;
        const isDev = config.development || window.location.hostname === 'localhost';
        
        Analytics.track(CONSTANTS.EVENTS.ERROR, {
            error: error.message,
            context,
            product_slug: productSlug,
            fallback_mode: fallbackMode,
            stack: error.stack
        });
        
        if (isDev) {
            document.body.innerHTML = UITemplates.getErrorTemplate(error.message, productSlug);
            return false;
        }
        
        switch (fallbackMode) {
            case CONSTANTS.FALLBACK_MODES.SHOW_ALL:
                return true;
            case CONSTANTS.FALLBACK_MODES.SHOW_FREE:
                this.showFreeContentOnly();
                return false;
            case CONSTANTS.FALLBACK_MODES.HIDE_ALL:
            default:
                this.hideAllContent();
                return false;
        }
    }
    
    static showFreeContentOnly() {
        // Remove protected elements but keep data-no-access content
        document.querySelectorAll('[data-sellf-product]').forEach(el => {
            const noAccessElements = el.querySelectorAll('[data-no-access]');
            
            if (noAccessElements.length > 0) {
                // Keep only the no-access elements
                el.innerHTML = '';
                noAccessElements.forEach(noAccessEl => {
                    noAccessEl.removeAttribute('data-no-access');
                    el.appendChild(noAccessEl);
                });
                el.removeAttribute('data-sellf-product');
            } else {
                // No data-no-access elements found - remove the entire element
                el.remove();
            }
        });
    }
    
    static hideAllContent() {
        // Remove all protected content completely
        document.querySelectorAll('[data-sellf-product]').forEach(el => {
            el.remove();
        });
    }
}

/**
 * Performance monitoring with method decoration
 */
class PerformanceMonitor {
    static measure(label, fn) {
        return async (...args) => {
            const startTime = performance.now();
            try {
                const result = await fn(...args);
                const duration = performance.now() - startTime;
                
                Analytics.track(CONSTANTS.EVENTS.PERFORMANCE, {
                    label,
                    duration,
                    success: true
                });
                
                return result;
            } catch (error) {
                const duration = performance.now() - startTime;
                
                Analytics.track(CONSTANTS.EVENTS.PERFORMANCE, {
                    label,
                    duration,
                    success: false,
                    error: error.message
                });
                
                throw error;
            }
        };
    }
}

// ============================================================================
// MAIN GATEKEEPER CLASS
// ============================================================================

/**
 * Main Sellf system orchestrator
 */
class Sellf {
    constructor() {
        this.initialized = false;
        this.config = null;
        this.protectionMode = null;
    }
    
    async initialize() {
        if (this.initialized) return;

        try {
            // Determine protection mode FIRST (before any DOM changes)
            this.protectionMode = this.detectProtectionMode();

            // Show loading overlay only for page protection (not element protection)
            if (this.protectionMode === 'page') {
                this.showLoadingOverlay();
            }

            // Initialize components
            await this.initializeComponents();

            // Apply protection based on mode
            await this.applyProtection();

            // Hide loading overlay if it was shown
            this.hideLoadingOverlay();

            this.initialized = true;

            // Mark as initialized globally
            window.GATEKEEPER_INITIALIZED = true;

            Analytics.track(CONSTANTS.EVENTS.PERFORMANCE, {
                action: 'initialization_complete',
                mode: this.protectionMode,
                duration: performance.now()
            });

        } catch (error) {
            this.hideLoadingOverlay();
            ErrorHandler.handleError(error, 'initialization');
        }
    }

    showLoadingOverlay() {
        if (document.getElementById('sellf-loading-overlay')) return;

        const overlay = document.createElement('div');
        overlay.id = 'sellf-loading-overlay';
        overlay.innerHTML = UITemplates.getLoadingTemplate();
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 999998;
            background: rgba(255,255,255,0.95);
        `;
        document.body.appendChild(overlay);
    }

    hideLoadingOverlay() {
        const overlay = document.getElementById('sellf-loading-overlay');
        if (overlay) {
            overlay.style.opacity = '0';
            overlay.style.transition = 'opacity 0.3s ease';
            setTimeout(() => overlay.remove(), 300);
        }
    }
    
    async initializeComponents() {
        // Load configuration
        this.config = window.sellfConfig || {};
        
        // Load Supabase
        await this.loadSupabase();
        
        // Initialize license system
        await LicenseManager.checkLicense();
        
        // Create watermark if needed
        LicenseManager.createWatermark();
        
        // Initialize session management
        SessionManager.initialize(SessionManager.supabaseClient);
        
    }
    
    async loadSupabase() {
        if (window.supabase) {
            this.createSupabaseClient();
            return;
        }
        
        try {
            return new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
                script.onload = () => {
                    this.createSupabaseClient();
                    resolve();
                };
                script.onerror = () => {
                    // Create mock client for development
                    SessionManager.supabaseClient = {
                        auth: {
                            getSession: () => Promise.resolve({ data: { session: null } }),
                            onAuthStateChange: () => ({ data: { subscription: null } }),
                            signInWithOtp: () => Promise.resolve({ error: null })
                        },
                        rpc: () => Promise.resolve({ data: false, error: null })
                    };
                    resolve();
                };
                document.head.appendChild(script);
            });
        } catch (error) {
            // Fallback to mock client
            SessionManager.supabaseClient = {
                auth: {
                    getSession: () => Promise.resolve({ data: { session: null } }),
                    onAuthStateChange: () => ({ data: { subscription: null } }),
                    signInWithOtp: () => Promise.resolve({ error: null })
                },
                rpc: () => Promise.resolve({ data: false, error: null })
            };
        }
    }
    
    createSupabaseClient() {
        // Try to get config from injected GATEKEEPER_CONFIG or fallback to window.sellfConfig
        const injectedConfig = typeof GATEKEEPER_CONFIG !== 'undefined' ? GATEKEEPER_CONFIG : {};
        const windowConfig = window.sellfConfig || {};
        const config = { ...windowConfig, ...injectedConfig };
        
        // Check for Supabase configuration (injected by generator)
        const supabaseUrl = config.SUPABASE_URL || config.supabaseUrl;
        const supabaseAnonKey = config.SUPABASE_ANON_KEY || config.supabaseAnonKey;

        if (!supabaseUrl || !supabaseAnonKey) {
            console.warn('[Sellf] Missing Supabase configuration - using mock client');
            // Create a mock client when config is missing
            // Create a mock client for development
            SessionManager.supabaseClient = {
                auth: {
                    getSession: () => Promise.resolve({ data: { session: null } }),
                    onAuthStateChange: () => ({ data: { subscription: null } }),
                    signInWithOtp: () => Promise.resolve({ error: null })
                },
                rpc: () => Promise.resolve({ data: false, error: null })
            };
            return;
        }
        
        SessionManager.supabaseClient = window.supabase.createClient(supabaseUrl, supabaseAnonKey);
    }
    
    detectProtectionMode() {
        const params = new URLSearchParams(window.location.search);

        // Check for productSlug parameter in script URL or configuration
        const currentScript = document.currentScript;
        let scriptProductSlug = null;

        // First check GATEKEEPER_CONFIG for productSlug
        if (window.GATEKEEPER_CONFIG && window.GATEKEEPER_CONFIG.PRODUCT_SLUG) {
            scriptProductSlug = window.GATEKEEPER_CONFIG.PRODUCT_SLUG;
        }

        // Then check script URL parameters
        if (!scriptProductSlug && currentScript) {
            try {
                const scriptUrl = new URL(currentScript.src);
                scriptProductSlug = scriptUrl.searchParams.get('productSlug');
            } catch (error) {
                // If URL parsing fails, continue without script parameter
            }
        }

        // Check DOM for protected elements (CSS already hides them)
        const protectedElements = document.querySelectorAll('[data-sellf-product]');

        // Always use element protection if protected elements exist
        if (protectedElements.length > 0) {
            // Store product slug for page-level redirect check
            if (scriptProductSlug) {
                this.fullPageProductSlug = scriptProductSlug;
            } else if (params.has('product')) {
                this.fullPageProductSlug = params.get('product');
            }

            return 'element';
        }

        // Only use page protection if no elements but have productSlug
        if (scriptProductSlug) {
            this.fullPageProductSlug = scriptProductSlug;
            return 'page';
        } else if (params.has('product')) {
            return 'page';
        }

        return 'none';
    }
    
    async applyProtection() {
        switch (this.protectionMode) {
            case 'page':
                await this.protectPage();
                break;
            case 'element':
                // For element mode, first check if we need page-level redirect
                if (this.fullPageProductSlug) {
                    const pageAccessGranted = await this.checkPageAccess();
                    if (!pageAccessGranted) {
                        // Page access denied - redirect instead of processing elements
                        return;
                    }
                }
                // Always process elements if we reach here
                await this.protectElements();
                break;
            default:
                // No protection needed - CSS will handle visibility
                break;
        }
    }
    
    async protectPage() {
        const params = new URLSearchParams(window.location.search);
        let productSlug = params.get('product');
        
        // Use script parameter if available (higher priority)
        if (this.fullPageProductSlug) {
            productSlug = this.fullPageProductSlug;
        }
        
        if (!productSlug) {
            ErrorHandler.handleError(new Error('No product slug provided'), 'page_protection');
            return;
        }

        // Check access directly - server determines user from cookies
        const accessResults = await AccessControl.batchCheckAccess([productSlug]);
        const hasAccess = accessResults[productSlug] || false;

        if (hasAccess) {
            // User has access - show page content
            document.body.style.visibility = 'visible';
            document.body.classList.add('sellf-ready');

            Analytics.track(CONSTANTS.EVENTS.ACCESS_GRANTED, {
                product_slug: productSlug
            });
            return;
        }

        Analytics.track(CONSTANTS.EVENTS.ACCESS_DENIED, {
            product_slug: productSlug,
            redirect_to: `/p/${productSlug}`
        });
        
        // Build redirect URL with return_url parameter
        const returnUrl = encodeURIComponent(window.location.href);
        const mainDomain = window.GATEKEEPER_CONFIG?.MAIN_DOMAIN || 'localhost:3000';
        // Use http/https, never file://
        let protocol = window.location.protocol;
        if (protocol === 'file:') {
            protocol = 'http:';
        }

        // Always redirect to main domain for authentication
        window.location.href = `${protocol}//${mainDomain}/p/${productSlug}?return_url=${returnUrl}`;
    }

    async protectElements() {
        const protectedElements = document.querySelectorAll('[data-sellf-product]');

        if (protectedElements.length === 0) {
            return;
        }

        // Get unique product slugs
        const productSlugs = [...new Set(
            Array.from(protectedElements).map(el => el.dataset.sellfProduct)
        )];

        // Check access directly - server determines user from cookies
        const accessResults = await AccessControl.batchCheckAccess(productSlugs);

        // Log summary: "Elements: product-a ✓, product-b ✗"
        const summary = productSlugs
            .map(slug => `${slug} ${accessResults[slug] ? '✓' : '✗'}`)
            .join(', ');
        Logger.info(`Elements: ${summary}`);

        // Process each element - CSS hides initially, then we remove wrong content from DOM
        protectedElements.forEach(element => {
            const productSlug = element.dataset.sellfProduct;
            const hasAccess = accessResults[productSlug] || false;

            if (hasAccess) {
                // User has access - remove no-access content from DOM entirely
                element.querySelectorAll('[data-no-access]').forEach(el => el.remove());
                element.classList.add('sellf-has-access', 'sellf-processed');
                Analytics.track(CONSTANTS.EVENTS.ELEMENT_ACCESSED, {
                    product_slug: productSlug,
                    element_tag: element.tagName.toLowerCase()
                });
            } else {
                // User doesn't have access - remove has-access content from DOM entirely
                element.querySelectorAll('[data-has-access]').forEach(el => el.remove());
                element.classList.add('sellf-no-access', 'sellf-processed');
                Analytics.track(CONSTANTS.EVENTS.ELEMENT_PROTECTED, {
                    product_slug: productSlug,
                    element_tag: element.tagName.toLowerCase()
                });
            }
        });
    }
    
    async checkPageAccess() {
        if (!this.fullPageProductSlug) {
            return true; // No page-level product specified
        }

        // Check access directly - server determines user from cookies
        const accessResults = await AccessControl.batchCheckAccess([this.fullPageProductSlug]);
        const hasAccess = accessResults[this.fullPageProductSlug] || false;

        // Log page access result
        Logger.info(`Page: ${this.fullPageProductSlug} ${hasAccess ? '✓' : '✗'}`);

        if (hasAccess) {
            Analytics.track(CONSTANTS.EVENTS.ACCESS_GRANTED, {
                product_slug: this.fullPageProductSlug,
                context: 'page_access_check'
            });
            return true;
        }

        Analytics.track(CONSTANTS.EVENTS.ACCESS_DENIED, {
            product_slug: this.fullPageProductSlug,
            redirect_to: `/p/${this.fullPageProductSlug}`,
            context: 'page_access_check'
        });
        
        // Build redirect URL with return_url parameter
        const returnUrl = encodeURIComponent(window.location.href);
        const mainDomain = window.GATEKEEPER_CONFIG?.MAIN_DOMAIN || 'localhost:3000';
        // Use http/https, never file://
        let protocol = window.location.protocol;
        if (protocol === 'file:') {
            protocol = 'http:';
        }

        // Always redirect to main domain for authentication
        window.location.href = `${protocol}//${mainDomain}/p/${this.fullPageProductSlug}?return_url=${returnUrl}`;

        return false;
    }

    // Public API methods
    static async checkProductAccess(productSlug) {
        const results = await AccessControl.batchCheckAccess([productSlug]);
        return results[productSlug] || false;
    }
    
    static getCurrentUser() {
        return SessionManager.getCurrentUserId();
    }
    
    static trackEvent(eventName, data = {}) {
        Analytics.track(eventName, data);
    }
    
    // Instance methods for convenience
    async checkProductAccess(productSlug, userId = null) {
        const results = await AccessControl.batchCheckAccess([productSlug], userId);
        return results[productSlug] || false;
    }
    
    getCurrentUser() {
        return SessionManager.getCurrentUserId();
    }
    
    trackEvent(eventName, data = {}) {
        Analytics.track(eventName, data);
    }
    
    get supabaseClient() {
        return SessionManager.supabaseClient;
    }
}

// ============================================================================
// GLOBAL INITIALIZATION
// ============================================================================

// Global instances
const cache = new CacheManager();
const sellf = new Sellf();

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        sellf.initialize().catch(error => {
            // Fallback: show all protected elements with no-access state
            document.querySelectorAll('[data-sellf-product]').forEach(el => {
                el.classList.add('sellf-no-access', 'sellf-processed');
            });
        });
    });
} else {
    sellf.initialize().catch(error => {
        // Fallback: show all protected elements with no-access state
        document.querySelectorAll('[data-sellf-product]').forEach(el => {
            el.classList.add('sellf-no-access', 'sellf-processed');
        });
    });
}

// Expose public API
window.Sellf = Sellf;
window.sellf = sellf;
window.cache = cache;

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    cache.destroy();
});

// Enhanced error handling for uncaught errors
window.addEventListener('error', (event) => {
    if (event.error?.stack?.includes('sellf') || event.error?.stack?.includes('sellf')) {
        Analytics.track(CONSTANTS.EVENTS.ERROR, {
            error: event.error.message,
            context: 'global_error_handler',
            stack: event.error.stack
        });
    }
});

// Performance monitoring
window.addEventListener('load', () => {
    Analytics.track(CONSTANTS.EVENTS.PERFORMANCE, {
        action: 'page_load_complete',
        load_time: performance.now(),
        memory_usage: performance.memory ? performance.memory.usedJSHeapSize : null
    });
});

// Export classes to window for debugging and external access
window.SessionManager = SessionManager;
window.AccessControl = AccessControl;
window.CacheManager = CacheManager;
window.Analytics = Analytics;
window.ErrorHandler = ErrorHandler;
window.UITemplates = UITemplates;
window.Sellf = Sellf;

