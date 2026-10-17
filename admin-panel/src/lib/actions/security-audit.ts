'use server';

/**
 * Security audit server action.
 * Checks Supabase configuration for common production security issues.
 * All checks are read-only and non-destructive.
 *
 * @see priv/pentest-2026-03-06.md — Supabase Production Configuration Checklist
 */

import { createTranslator } from 'next-intl';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
import { getRuntimeSupabaseUrl, getRuntimeSupabaseAnonKey } from '@/lib/config/runtime-env';
import { withAdminClient } from '@/lib/actions/admin-auth';
import { getCanonicalOriginOrNull } from '@/lib/utils/canonical-url';

export interface SecurityCheckResult {
  id: string;
  name: string;
  status: 'pass' | 'warn' | 'fail' | 'info';
  message: string;
  fix?: string;
  steps?: string[];
  scope?: 'platform' | 'shop';
}

export interface SecurityAuditResult {
  success: boolean;
  checks: SecurityCheckResult[];
  timestamp: string;
  error?: string;
}

// ===== In-memory cache =====
// TTL depends on results: 1h if any issues found (re-check sooner), 24h if all pass
const CACHE_TTL_ISSUES_MS = 1 * 60 * 60 * 1000;  // 1 hour
const CACHE_TTL_CLEAN_MS = 24 * 60 * 60 * 1000;   // 24 hours
type AuditTranslator = (key: string, values?: Record<string, string | number>) => string;
type AuditMessageKey = keyof typeof en.securityAudit.checks;
interface AuditMessage {
  key: AuditMessageKey;
  values?: Record<string, string | number | AuditMessage>;
}
type AuditMessageFactory = (key: AuditMessageKey, values?: AuditMessage['values']) => AuditMessage;
interface RawSecurityCheckResult extends Omit<SecurityCheckResult, 'name' | 'message' | 'fix' | 'steps'> {
  name: AuditMessage;
  message: AuditMessage;
  fix?: AuditMessage;
  steps?: AuditMessage[];
}
interface RawSecurityAuditResult extends Omit<SecurityAuditResult, 'checks' | 'error'> {
  checks: RawSecurityCheckResult[];
  error?: AuditMessage;
}
let cachedAudit: { result: RawSecurityAuditResult; cachedAt: number } | undefined;

function getAuditTranslator(locale: string): AuditTranslator {
  return createTranslator({ locale, messages: (locale === 'pl' ? pl : en).securityAudit.checks as Record<string, string> });
}

function translateAudit(result: RawSecurityAuditResult, locale: string): SecurityAuditResult {
  const t = getAuditTranslator(locale);
  const translate = (message: AuditMessage): string => t(message.key, message.values && Object.fromEntries(
    Object.entries(message.values).map(([key, value]) => [key, typeof value === 'object' ? translate(value) : value]),
  ));
  return {
    ...result,
    checks: result.checks.map(check => ({
      ...check,
      name: translate(check.name),
      message: translate(check.message),
      fix: check.fix && translate(check.fix),
      steps: check.steps?.map(translate),
    })),
    error: result.error && translate(result.error),
  };
}

function getCacheTtl(result: RawSecurityAuditResult): number {
  // Info entries are read-only summaries (e.g., active license tier, Stripe mode);
  // they should not shorten the cache window. Only real warnings / failures do.
  const hasIssues = result.checks.some((c) => c.status === 'warn' || c.status === 'fail');
  return hasIssues ? CACHE_TTL_ISSUES_MS : CACHE_TTL_CLEAN_MS;
}

/**
 * Returns cached audit result if fresh, otherwise runs a fresh audit.
 * TTL: 1h when issues exist (re-check after fix), 24h when all pass.
 */
export async function getSecurityAudit(locale = 'en'): Promise<SecurityAuditResult> {
  locale = locale === 'pl' ? 'pl' : 'en';
  const result = await withAdminClient(async () => {
    const cached = cachedAudit;
    if (cached && (Date.now() - cached.cachedAt) < getCacheTtl(cached.result)) {
      return { success: true as const, data: cached.result };
    }

    const audit = await executeAudit();
    return { success: true as const, data: audit };
  });

  if (!result.success) {
    return { success: false, checks: [], timestamp: new Date().toISOString(), error: getAuditTranslator(locale)(result.errorCode === 'FORBIDDEN' ? 'forbidden' : result.errorCode === 'UNAUTHORIZED' ? 'unauthorized' : 'requestFailed') };
  }

  return translateAudit(result.data!, locale);
}

/**
 * Forces a fresh audit run, bypassing cache. Called via "Run again" button.
 */
export async function runSecurityAudit(locale = 'en'): Promise<SecurityAuditResult> {
  locale = locale === 'pl' ? 'pl' : 'en';
  const result = await withAdminClient(async () => {
    const audit = await executeAudit();
    return { success: true as const, data: audit };
  });

  if (!result.success) {
    return { success: false, checks: [], timestamp: new Date().toISOString(), error: getAuditTranslator(locale)(result.errorCode === 'FORBIDDEN' ? 'forbidden' : result.errorCode === 'UNAUTHORIZED' ? 'unauthorized' : 'requestFailed') };
  }

  return translateAudit(result.data!, locale);
}

async function executeAudit(): Promise<RawSecurityAuditResult> {
  const t: AuditMessageFactory = (key, values) => ({ key, values });
  const supabaseUrl = getRuntimeSupabaseUrl();
  const anonKey = getRuntimeSupabaseAnonKey();

  if (!supabaseUrl || !anonKey) {
    return { success: false, checks: [], timestamp: new Date().toISOString(), error: t('missingConfiguration') };
  }

  const siteUrl = getCanonicalOriginOrNull() ?? '';

  // Define all checks with scope
  interface ScopedCheck {
    scope: 'platform' | 'shop';
    check: () => Promise<RawSecurityCheckResult>;
  }

  const allChecks: ScopedCheck[] = [
    // Platform-only checks
    { scope: 'platform', check: () => checkGraphQLIntrospection(supabaseUrl, anonKey, t) },
    { scope: 'platform', check: () => checkMCPEndpoint(supabaseUrl, anonKey, t) },
    { scope: 'platform', check: () => checkServerHeaders(supabaseUrl, anonKey, t) },
    { scope: 'platform', check: () => checkEmailAutoconfirm(supabaseUrl, anonKey, t) },
    { scope: 'platform', check: () => checkProductCountLeak(supabaseUrl, anonKey, t) },
    { scope: 'platform', check: () => checkRPCFunctionHints(supabaseUrl, anonKey, t) },
    { scope: 'platform', check: () => checkAppEncryptionKey(t) },
    { scope: 'platform', check: () => checkCaptcha(t) },
    { scope: 'platform', check: () => checkCronSecret(t) },
    { scope: 'platform', check: () => checkTrustedProxy(t) },
    { scope: 'platform', check: () => checkTrustedDownloadDomains(t) },
    { scope: 'platform', check: () => checkAllowedEmbedOrigins(t) },
    { scope: 'shop', check: () => checkStripeMode(t) },
    // Shop-relevant checks
    { scope: 'shop', check: () => checkHttpsRedirect(siteUrl, t) },
    { scope: 'shop', check: () => checkHstsHeader(siteUrl, t) },
    { scope: 'shop', check: () => checkAppUrl(t) },
    { scope: 'shop', check: () => checkStripeWebhookSecret(t) },
    { scope: 'shop', check: () => checkCookieSecure(siteUrl, t) },
  ];

  const checksToRun = allChecks;

  const results = await Promise.allSettled(checksToRun.map(c => c.check()));

  const checks: RawSecurityCheckResult[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      checks.push({ ...result.value, scope: checksToRun[i].scope });
    }
  }

  const audit: RawSecurityAuditResult = { success: true, checks, timestamp: new Date().toISOString() };

  cachedAudit = { result: audit, cachedAt: Date.now() };

  return audit;
}

async function checkGraphQLIntrospection(url: string, key: string, t: AuditMessageFactory): Promise<RawSecurityCheckResult> {
  try {
    const res = await fetch(`${url}/graphql/v1`, {
      method: 'POST',
      headers: { 'apikey': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{__schema{queryType{name}}}' }),
    });
    const body = await res.json();
    const exposed = res.ok && body?.data?.__schema;

    return {
      id: 'graphql-introspection',
      name: t('graphQLIntrospectionName'),
      status: exposed ? 'warn' : 'pass',
      message: exposed
        ? t('graphQLIntrospectionMessage')
        : t('graphQLIntrospectionMessage2'),
      fix: exposed
        ? t('graphQLIntrospectionFix')
        : undefined,
      steps: exposed ? [
        t('graphQLIntrospectionSteps1'),
        t('graphQLIntrospectionSteps2'),
        t('graphQLIntrospectionSteps3'),
        t('graphQLIntrospectionSteps4'),
        t('graphQLIntrospectionSteps5'),
      ] : undefined,
    };
  } catch {
    return { id: 'graphql-introspection', name: t('graphQLIntrospectionName'), status: 'pass', message: t('graphQLIntrospectionMessage3') };
  }
}

async function checkMCPEndpoint(url: string, key: string, t: AuditMessageFactory): Promise<RawSecurityCheckResult> {
  try {
    const res = await fetch(`${url}/mcp`, {
      method: 'POST',
      headers: { 'apikey': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
    });
    // 404 = blocked, anything else = accessible
    const accessible = res.status !== 404;

    return {
      id: 'mcp-endpoint',
      name: t('mCPEndpointName'),
      status: accessible ? 'warn' : 'pass',
      message: accessible
        ? t('mCPEndpointMessage', { value0: res.status })
        : t('mCPEndpointMessage2'),
      fix: accessible
        ? t('mCPEndpointFix')
        : undefined,
      steps: accessible ? [
        t('mCPEndpointSteps1'),
        t('mCPEndpointSteps2'),
        t('mCPEndpointSteps3'),
        t('mCPEndpointSteps4'),
      ] : undefined,
    };
  } catch {
    return { id: 'mcp-endpoint', name: t('mCPEndpointName'), status: 'pass', message: t('mCPEndpointMessage3') };
  }
}

async function checkServerHeaders(url: string, key: string, t: AuditMessageFactory): Promise<RawSecurityCheckResult> {
  try {
    const res = await fetch(`${url}/rest/v1/`, { headers: { 'apikey': key } });
    const server = res.headers.get('server');
    const via = res.headers.get('via');

    // A "Server" header is only useful to an attacker when it leaks a software
    // name+version they can map to known CVEs (e.g., "nginx/1.18.0", "Apache/2.4.49").
    // Bare CDN identifiers like "cloudflare", "cloudfront", "Fastly", or "AkamaiGHost"
    // reveal only that traffic terminates at a hardened edge — that's defense, not
    // exposure. Same for "Via" with no version. Treat those as PASS.
    const cdnOnly = /^(cloudflare|cloudfront|fastly|akamai\w*|envoy|caddy)$/i;
    const hasVersionLeak = (h: string | null) => !!h && /\d+\.\d+/.test(h);
    const serverLeaksVersion = hasVersionLeak(server) || (server !== null && !cdnOnly.test(server.trim()));
    const viaLeaksVersion = hasVersionLeak(via);
    const exposed = serverLeaksVersion || viaLeaksVersion;

    const parts: string[] = [];
    if (server) parts.push(`Server: ${server}`);
    if (via) parts.push(`Via: ${via}`);

    if (!exposed && (server || via)) {
      return {
        id: 'version-headers',
        name: t('serverHeadersName'),
        status: 'pass',
        message: t('serverHeadersMessage', { value0: parts.join(', ') }),
      };
    }

    return {
      id: 'version-headers',
      name: t('serverHeadersName'),
      status: exposed ? 'warn' : 'pass',
      message: exposed
        ? t('serverHeadersMessage2', { value0: parts.join(', ') })
        : t('serverHeadersMessage3'),
      fix: exposed
        ? t('serverHeadersFix')
        : undefined,
      steps: exposed ? [
        t('serverHeadersSteps1'),
        t('serverHeadersSteps2'),
        t('serverHeadersSteps3'),
      ] : undefined,
    };
  } catch {
    return { id: 'version-headers', name: t('serverHeadersName'), status: 'pass', message: t('serverHeadersMessage4') };
  }
}

async function checkEmailAutoconfirm(url: string, key: string, t: AuditMessageFactory): Promise<RawSecurityCheckResult> {
  try {
    const res = await fetch(`${url}/auth/v1/settings`, { headers: { 'apikey': key } });
    if (!res.ok) {
      return { id: 'email-autoconfirm', name: t('emailAutoconfirmName'), status: 'pass', message: t('emailAutoconfirmMessage') };
    }
    const data = await res.json();
    const autoconfirm = data.mailer_autoconfirm === true;

    return {
      id: 'email-autoconfirm',
      name: t('emailAutoconfirmName'),
      status: autoconfirm ? 'fail' : 'pass',
      message: autoconfirm
        ? t('emailAutoconfirmMessage2')
        : t('emailAutoconfirmMessage3'),
      fix: autoconfirm
        ? t('emailAutoconfirmFix')
        : undefined,
      steps: autoconfirm ? [
        t('emailAutoconfirmSteps1'),
        t('emailAutoconfirmSteps2'),
        t('emailAutoconfirmSteps3'),
        t('emailAutoconfirmSteps4'),
        t('emailAutoconfirmSteps5'),
        t('emailAutoconfirmSteps6'),
        t('emailAutoconfirmSteps7'),
        t('emailAutoconfirmSteps8'),
      ] : undefined,
    };
  } catch {
    return { id: 'email-autoconfirm', name: t('emailAutoconfirmName'), status: 'pass', message: t('emailAutoconfirmMessage4') };
  }
}

async function checkProductCountLeak(url: string, key: string, t: AuditMessageFactory): Promise<RawSecurityCheckResult> {
  try {
    const res = await fetch(`${url}/rest/v1/products?select=id&limit=0`, {
      headers: { 'apikey': key, 'Prefer': 'count=exact' },
    });
    const contentRange = res.headers.get('content-range');
    const leaks = contentRange !== null && contentRange !== '*/0' && contentRange !== '*/*';

    return {
      id: 'count-header-leak',
      name: t('productCountLeakName'),
      status: leaks ? 'warn' : 'pass',
      message: leaks
        ? t('productCountLeakMessage', { value0: contentRange })
        : t('productCountLeakMessage2'),
      fix: leaks
        ? t('productCountLeakFix')
        : undefined,
      steps: leaks ? [
        t('productCountLeakSteps1'),
        t('productCountLeakSteps2'),
        t('productCountLeakSteps3'),
        t('productCountLeakSteps4'),
      ] : undefined,
    };
  } catch {
    return { id: 'count-header-leak', name: t('productCountLeakName'), status: 'pass', message: t('productCountLeakMessage3') };
  }
}

async function checkRPCFunctionHints(url: string, key: string, t: AuditMessageFactory): Promise<RawSecurityCheckResult> {
  try {
    const res = await fetch(`${url}/rest/v1/rpc/nonexistent_function_xyz`, {
      method: 'POST',
      headers: { 'apikey': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const body = await res.json();
    const hasHint = body?.hint && body.hint.includes('Perhaps you meant');

    return {
      id: 'rpc-function-hints',
      name: t('rPCFunctionHintsName'),
      status: hasHint ? 'warn' : 'pass',
      message: hasHint
        ? t('rPCFunctionHintsMessage', { value0: body.hint })
        : t('rPCFunctionHintsMessage2'),
      fix: hasHint
        ? t('rPCFunctionHintsFix')
        : undefined,
      steps: hasHint ? [
        t('rPCFunctionHintsSteps1'),
        t('rPCFunctionHintsSteps2'),
        t('rPCFunctionHintsSteps3'),
        t('rPCFunctionHintsSteps4'),
      ] : undefined,
    };
  } catch {
    return { id: 'rpc-function-hints', name: t('rPCFunctionHintsName'), status: 'pass', message: t('rPCFunctionHintsMessage3') };
  }
}

// ===== Sellf App Configuration Checks =====

async function checkHttpsRedirect(siteUrl: string, t: AuditMessageFactory): Promise<RawSecurityCheckResult> {
  if (!siteUrl || !siteUrl.startsWith('https://')) {
    return { id: 'https-redirect', name: t('httpsRedirectName'), status: 'warn', message: t('httpsRedirectMessage'), fix: t('httpsRedirectFix') };
  }
  try {
    const httpUrl = siteUrl.replace('https://', 'http://');
    const res = await fetch(httpUrl, { redirect: 'manual' });
    const location = res.headers.get('location');
    const redirectsToHttps = (res.status === 301 || res.status === 308) && location?.startsWith('https://');

    return {
      id: 'https-redirect',
      name: t('httpsRedirectName'),
      status: redirectsToHttps ? 'pass' : 'warn',
      message: redirectsToHttps
        ? t('httpsRedirectMessage2')
        : t('httpsRedirectMessage3', { value0: res.status }),
      fix: redirectsToHttps ? undefined
        : t('httpsRedirectFix2'),
      steps: redirectsToHttps ? undefined : [
        t('httpsRedirectSteps1'),
        t('httpsRedirectSteps2'),
        t('httpsRedirectSteps3'),
      ],
    };
  } catch {
    return { id: 'https-redirect', name: t('httpsRedirectName'), status: 'pass', message: t('httpsRedirectMessage4') };
  }
}

async function checkHstsHeader(siteUrl: string, t: AuditMessageFactory): Promise<RawSecurityCheckResult> {
  if (!siteUrl) {
    return { id: 'hsts', name: t('hstsHeaderName'), status: 'warn', message: t('hstsHeaderMessage'), fix: t('hstsHeaderFix') };
  }
  try {
    const res = await fetch(siteUrl, { redirect: 'manual' });
    const hsts = res.headers.get('strict-transport-security');

    return {
      id: 'hsts',
      name: t('hstsHeaderName'),
      status: hsts ? 'pass' : 'warn',
      message: hsts
        ? t('hstsHeaderMessage2', { value0: hsts })
        : t('hstsHeaderMessage3'),
      fix: hsts ? undefined
        : t('hstsHeaderFix2'),
      steps: hsts ? undefined : [
        t('hstsHeaderSteps1'),
        t('hstsHeaderSteps2'),
        t('hstsHeaderSteps3'),
        t('hstsHeaderSteps4'),
        t('hstsHeaderSteps5'),
        t('hstsHeaderSteps6'),
      ],
    };
  } catch {
    return { id: 'hsts', name: t('hstsHeaderName'), status: 'warn', message: t('hstsHeaderMessage4') };
  }
}

async function checkAppUrl(t: AuditMessageFactory): Promise<RawSecurityCheckResult> {
  const siteUrl = getCanonicalOriginOrNull() || '';
  const sourceVar = 'SITE_URL';
  const isLocalhost = !siteUrl || siteUrl.includes('localhost') || siteUrl.includes('127.0.0.1');

  return {
    id: 'app-url',
    name: t('appUrlName'),
    status: isLocalhost ? 'fail' : 'pass',
    message: isLocalhost
      ? t('appUrlMessage', { value0: sourceVar, value1: siteUrl || t('notSet') })
      : t('appUrlMessage2', { value0: siteUrl }),
    fix: isLocalhost
      ? t('appUrlFix')
      : undefined,
  };
}

// ===== Environment Variable Checks =====

async function checkAppEncryptionKey(t: AuditMessageFactory): Promise<RawSecurityCheckResult> {
  const key = process.env.APP_ENCRYPTION_KEY || process.env.STRIPE_ENCRYPTION_KEY;

  if (!key) {
    return {
      id: 'app-encryption-key',
      name: t('appEncryptionKeyName'),
      status: 'fail',
      message: t('appEncryptionKeyMessage'),
      fix: t('appEncryptionKeyFix'),
    };
  }

  try {
    const buf = Buffer.from(key, 'base64');
    if (buf.length !== 32) {
      return {
        id: 'app-encryption-key',
        name: t('appEncryptionKeyName'),
        status: 'fail',
        message: t('appEncryptionKeyMessage2', { value0: buf.length }),
        fix: t('appEncryptionKeyFix2'),
      };
    }
  } catch {
    return {
      id: 'app-encryption-key',
      name: t('appEncryptionKeyName'),
      status: 'fail',
      message: t('appEncryptionKeyMessage3'),
      fix: t('appEncryptionKeyFix2'),
    };
  }

  return {
    id: 'app-encryption-key',
    name: t('appEncryptionKeyName'),
    status: 'pass',
    message: t('appEncryptionKeyMessage4'),
  };
}

async function checkCaptcha(t: AuditMessageFactory): Promise<RawSecurityCheckResult> {
  const turnstileSiteKey = process.env.CLOUDFLARE_TURNSTILE_SITE_KEY || process.env.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY;
  const turnstileSecretKey = process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;
  const altchaKey = process.env.ALTCHA_HMAC_KEY;

  // Turnstile fully configured — best option
  if (turnstileSiteKey && turnstileSecretKey) {
    return {
      id: 'captcha',
      name: t('captchaName'),
      status: 'pass',
      message: t('captchaMessage'),
    };
  }

  // ALTCHA remains active, but a stale Turnstile site key can still be exposed
  // in runtime config and confuse operators.
  if (turnstileSiteKey && !turnstileSecretKey && altchaKey) {
    return {
      id: 'captcha',
      name: t('captchaName'),
      status: 'warn',
      message: t('captchaMessage2'),
      fix: t('captchaFix'),
    };
  }

  // Turnstile site key without secret — broken config
  if (turnstileSiteKey && !turnstileSecretKey) {
    return {
      id: 'captcha',
      name: t('captchaName'),
      status: 'fail',
      message: t('captchaMessage3'),
      fix: t('captchaFix2'),
    };
  }

  // ALTCHA configured — self-hosted fallback
  if (altchaKey) {
    return {
      id: 'captcha',
      name: t('captchaName'),
      status: 'pass',
      message: t('captchaMessage4'),
    };
  }

  // Nothing configured
  return {
    id: 'captcha',
    name: t('captchaName'),
    status: 'warn',
    message: t('captchaMessage5'),
    fix: t('captchaFix3'),
  };
}

async function checkTrustedProxy(t: AuditMessageFactory): Promise<RawSecurityCheckResult> {
  const inProduction = process.env.NODE_ENV === 'production';
  const trusted = process.env.TRUSTED_PROXY === 'true';

  if (!inProduction) {
    return {
      id: 'trusted-proxy',
      name: t('trustedProxyName'),
      status: 'pass',
      message: t('trustedProxyMessage'),
    };
  }

  if (trusted) {
    return {
      id: 'trusted-proxy',
      name: t('trustedProxyName'),
      status: 'pass',
      message: t('trustedProxyMessage2'),
    };
  }

  return {
    id: 'trusted-proxy',
    name: t('trustedProxyName'),
    status: 'warn',
    message: t('trustedProxyMessage3'),
    fix: t('trustedProxyFix'),
    steps: [
      t('trustedProxySteps1'),
      t('trustedProxySteps2'),
      t('trustedProxySteps3'),
      t('trustedProxySteps4'),
      t('trustedProxySteps5'),
    ],
  };
}

function parseDomainList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean);
}

async function checkTrustedDownloadDomains(t: AuditMessageFactory): Promise<RawSecurityCheckResult> {
  const domains = parseDomainList(process.env.NEXT_PUBLIC_SELLF_ALLOWED_DOWNLOAD_DOMAINS);

  if (domains.length === 0) {
    return {
      id: 'trusted-download-domains',
      name: t('trustedDownloadDomainsName'),
      status: 'info',
      message: t('trustedDownloadDomainsMessage'),
    };
  }

  return {
    id: 'trusted-download-domains',
    name: t('trustedDownloadDomainsName'),
    status: 'info',
    message: t('trustedDownloadDomainsMessage2', { value0: domains.length, value1: t('hostCount', { count: domains.length }), value2: domains.join(', ') }),
  };
}

async function checkAllowedEmbedOrigins(t: AuditMessageFactory): Promise<RawSecurityCheckResult> {
  const origins = parseDomainList(process.env.SELLF_EMBED_ALLOWED_ORIGINS);

  if (origins.length === 0) {
    return {
      id: 'allowed-embed-origins',
      name: t('allowedEmbedOriginsName'),
      status: 'info',
      message: t('allowedEmbedOriginsMessage'),
    };
  }

  return {
    id: 'allowed-embed-origins',
    name: t('allowedEmbedOriginsName'),
    status: 'info',
    message: t('allowedEmbedOriginsMessage2', { value0: origins.length, value1: t('originCount', { count: origins.length }), value2: origins.join(', ') }),
  };
}

async function checkStripeMode(t: AuditMessageFactory): Promise<RawSecurityCheckResult> {
  const envKey = process.env.STRIPE_SECRET_KEY;
  const inProduction = process.env.NODE_ENV === 'production';

  if (envKey) {
    const mode = envKey.startsWith('sk_live_') ? 'live' : 'test';
    const source = t('environmentSource');
    // Production with test keys = sandbox / staging — note but don't alarm.
    // Non-production with live keys = highly unusual, surface as a warning.
    if (mode === 'live' && !inProduction) {
      return {
        id: 'stripe-mode',
        name: t('stripeModeName'),
        status: 'warn',
        message: t('stripeModeMessage', { value0: source, value1: process.env.NODE_ENV || t('notSet') }),
        fix: t('stripeModeFix'),
      };
    }
    return {
      id: 'stripe-mode',
      name: t('stripeModeName'),
      status: 'info',
      message: t('stripeModeMessage2', { value0: mode.toUpperCase(), value1: source, value2: mode === 'test' && inProduction ? t('stripeSandbox') : '' }),
    };
  }

  // No env key — the DB config decides mode. Try to resolve which one is active.
  try {
    const adminClient = (await import('@/lib/supabase/admin')).createAdminClient();
    const dbTimeout = new Promise<{ data: null }>((resolve) =>
      setTimeout(() => resolve({ data: null }), 2500),
    );
    const { data } = await Promise.race([
      adminClient
        .from('stripe_configurations')
        .select('mode')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .single(),
      dbTimeout,
    ]);
    const dbMode = (data as { mode?: string } | null)?.mode;
    if (!dbMode) {
      return {
        id: 'stripe-mode',
        name: t('stripeModeName'),
        status: 'info',
        message: t('stripeModeMessage3'),
      };
    }
    return {
      id: 'stripe-mode',
      name: t('stripeModeName'),
      status: 'info',
      message: t('stripeModeMessage4', { value0: dbMode.toUpperCase(), value1: dbMode === 'test' && inProduction ? t('stripeSandbox') : '' }),
    };
  } catch {
    return {
      id: 'stripe-mode',
      name: t('stripeModeName'),
      status: 'info',
      message: t('stripeModeMessage5'),
    };
  }
}

async function checkCronSecret(t: AuditMessageFactory): Promise<RawSecurityCheckResult> {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return {
      id: 'cron-secret',
      name: t('cronSecretName'),
      status: 'warn',
      message: t('cronSecretMessage'),
      fix: t('cronSecretFix'),
      steps: [
        t('cronSecretSteps1'),
        t('cronSecretSteps2'),
        t('cronSecretSteps3'),
        t('cronSecretSteps4'),
        t('cronSecretSteps5'),
        t('cronSecretSteps6'),
        t('cronSecretSteps7'),
        t('cronSecretSteps8'),
      ],
    };
  }

  return {
    id: 'cron-secret',
    name: t('cronSecretName'),
    status: 'pass',
    message: t('cronSecretMessage2'),
  };
}

async function checkStripeWebhookSecret(t: AuditMessageFactory): Promise<RawSecurityCheckResult> {
  const { getStripeWebhookSecretStatus } = await import('@/lib/stripe/internal-config');
  const status = await getStripeWebhookSecretStatus();

  if (status.envConfigured) {
    return {
      id: 'stripe-webhook-secret',
      name: t('stripeWebhookSecretName'),
      status: 'pass',
      message: t('stripeWebhookSecretMessage'),
    };
  }

  if (status.dbPresent && status.dbDecryptable) {
    return {
      id: 'stripe-webhook-secret',
      name: t('stripeWebhookSecretName'),
      status: 'pass',
      message: t('stripeWebhookSecretMessage2'),
    };
  }

  if (status.dbPresent && !status.dbDecryptable) {
    return {
      id: 'stripe-webhook-secret',
      name: t('stripeWebhookSecretName'),
      status: 'fail',
      message: t('stripeWebhookSecretMessage3'),
      fix: t('stripeWebhookSecretFix'),
      steps: [
        t('stripeWebhookSecretSteps1'),
        t('stripeWebhookSecretSteps2'),
        t('stripeWebhookSecretSteps3'),
      ],
    };
  }

  return {
    id: 'stripe-webhook-secret',
    name: t('stripeWebhookSecretName'),
    status: 'fail',
    message: t('stripeWebhookSecretMessage4'),
    fix: t('stripeWebhookSecretFix2'),
    steps: [
      t('stripeWebhookSecretSteps12'),
      t('stripeWebhookSecretSteps22'),
      t('stripeWebhookSecretSteps32'),
      t('stripeWebhookSecretSteps4'),
      t('stripeWebhookSecretSteps5'),
      t('stripeWebhookSecretSteps6'),
      t('stripeWebhookSecretSteps7'),
      t('stripeWebhookSecretSteps8'),
      t('stripeWebhookSecretSteps9'),
    ],
  };
}

async function checkCookieSecure(siteUrl: string, t: AuditMessageFactory): Promise<RawSecurityCheckResult> {
  if (!siteUrl) {
    return { id: 'cookie-secure', name: t('cookieSecureName'), status: 'warn', message: t('cookieSecureMessage'), fix: t('cookieSecureFix') };
  }
  try {
    const res = await fetch(siteUrl, { redirect: 'follow' });
    const setCookies = res.headers.getSetCookie?.() || [];
    const insecureCookies = setCookies.filter(c => !c.toLowerCase().includes('secure'));

    if (setCookies.length === 0) {
      return { id: 'cookie-secure', name: t('cookieSecureName'), status: 'pass', message: t('cookieSecureMessage2') };
    }

    const allSecure = insecureCookies.length === 0;

    return {
      id: 'cookie-secure',
      name: t('cookieSecureName'),
      status: allSecure ? 'pass' : 'warn',
      message: allSecure
        ? t('cookieSecureMessage3', { value0: setCookies.length })
        : t('cookieSecureMessage4', { value0: insecureCookies.length, value1: setCookies.length }),
      fix: allSecure ? undefined
        : t('cookieSecureFix2'),
      steps: allSecure ? undefined : [
        t('cookieSecureSteps1'),
        t('cookieSecureSteps2'),
        t('cookieSecureSteps3'),
        t('cookieSecureSteps4'),
      ],
    };
  } catch {
    return { id: 'cookie-secure', name: t('cookieSecureName'), status: 'warn', message: t('cookieSecureMessage5') };
  }
}
