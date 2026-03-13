'use server';

/**
 * Security audit server action.
 * Checks Supabase configuration for common production security issues.
 * All checks are read-only and non-destructive.
 *
 * @see priv/pentest-2026-03-06.md — Supabase Production Configuration Checklist
 */

import { createClient } from '@/lib/supabase/server';

export interface SecurityCheckResult {
  id: string;
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  fix?: string;
  steps?: string[];
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
let cachedResult: SecurityAuditResult | null = null;
let cachedAt = 0;

function getCacheTtl(result: SecurityAuditResult): number {
  const hasIssues = result.checks.some(c => c.status !== 'pass');
  return hasIssues ? CACHE_TTL_ISSUES_MS : CACHE_TTL_CLEAN_MS;
}

async function isAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.rpc('is_admin');
  return data === true;
}

/**
 * Returns cached audit result if fresh, otherwise runs a fresh audit.
 * TTL: 1h when issues exist (re-check after fix), 24h when all pass.
 */
export async function getSecurityAudit(): Promise<SecurityAuditResult> {
  if (!(await isAdmin())) {
    return { success: false, checks: [], timestamp: new Date().toISOString(), error: 'Unauthorized' };
  }

  if (cachedResult && (Date.now() - cachedAt) < getCacheTtl(cachedResult)) {
    return cachedResult;
  }

  return executeAudit();
}

/**
 * Forces a fresh audit run, bypassing cache. Called via "Run again" button.
 */
export async function runSecurityAudit(): Promise<SecurityAuditResult> {
  if (!(await isAdmin())) {
    return { success: false, checks: [], timestamp: new Date().toISOString(), error: 'Unauthorized' };
  }

  return executeAudit();
}

async function executeAudit(): Promise<SecurityAuditResult> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    return { success: false, checks: [], timestamp: new Date().toISOString(), error: 'Missing Supabase configuration' };
  }

  const checks: SecurityCheckResult[] = [];

  const siteUrl = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || '';

  const results = await Promise.allSettled([
    // Supabase configuration checks
    checkGraphQLIntrospection(supabaseUrl, anonKey),
    checkMCPEndpoint(supabaseUrl, anonKey),
    checkServerHeaders(supabaseUrl, anonKey),
    checkEmailAutoconfirm(supabaseUrl, anonKey),
    checkProductCountLeak(supabaseUrl, anonKey),
    checkRPCFunctionHints(supabaseUrl, anonKey),
    // Sellf app configuration checks
    checkHttpsRedirect(siteUrl),
    checkHstsHeader(siteUrl),
    checkAppUrl(),
    checkAllowedOrigins(),
    checkCookieSecure(siteUrl),
    // Environment variable checks
    checkAppEncryptionKey(),
    checkCaptcha(),
    checkCronSecret(),
    checkStripeWebhookSecret(),
  ]);

  for (const result of results) {
    if (result.status === 'fulfilled') {
      checks.push(result.value);
    }
  }

  const audit: SecurityAuditResult = { success: true, checks, timestamp: new Date().toISOString() };

  // Update cache
  cachedResult = audit;
  cachedAt = Date.now();

  return audit;
}

async function checkGraphQLIntrospection(url: string, key: string): Promise<SecurityCheckResult> {
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
      name: 'GraphQL introspection',
      status: exposed ? 'warn' : 'pass',
      message: exposed
        ? 'GraphQL introspection is enabled. Exposes full schema (table names, columns) to anyone with the anon key.'
        : 'GraphQL introspection is disabled or blocked.',
      fix: exposed
        ? 'Block /graphql/v1 in your reverse proxy (nginx/Cloudflare), or disable introspection in Supabase dashboard under API settings.'
        : undefined,
      steps: exposed ? [
        'Log into Cloudflare Dashboard (dash.cloudflare.com) and select your domain.',
        'Go to Security → WAF → Custom rules.',
        'Create a rule: URI Path equals "/graphql/v1" → Block.',
        'Alternatively, in your nginx config: location /graphql/v1 { deny all; }',
        'Verify by running the audit again — status should change to PASS.',
      ] : undefined,
    };
  } catch {
    return { id: 'graphql-introspection', name: 'GraphQL introspection', status: 'pass', message: 'GraphQL endpoint not reachable (likely blocked).' };
  }
}

async function checkMCPEndpoint(url: string, key: string): Promise<SecurityCheckResult> {
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
      name: 'MCP endpoint',
      status: accessible ? 'warn' : 'pass',
      message: accessible
        ? `MCP endpoint is accessible (HTTP ${res.status}). In local dev this grants superadmin access with anon key.`
        : 'MCP endpoint is blocked.',
      fix: accessible
        ? 'Block /mcp in your reverse proxy. In production Supabase, this is disabled by default.'
        : undefined,
      steps: accessible ? [
        'In Cloudflare Dashboard: Security → WAF → Custom rules.',
        'Create a rule: URI Path equals "/mcp" → Block.',
        'In nginx: location /mcp { deny all; }',
        'Note: on Supabase Cloud this endpoint is disabled by default — only affects self-hosted Supabase.',
      ] : undefined,
    };
  } catch {
    return { id: 'mcp-endpoint', name: 'MCP endpoint', status: 'pass', message: 'MCP endpoint not reachable.' };
  }
}

async function checkServerHeaders(url: string, key: string): Promise<SecurityCheckResult> {
  try {
    const res = await fetch(`${url}/rest/v1/`, { headers: { 'apikey': key } });
    const server = res.headers.get('server');
    const via = res.headers.get('via');
    const exposed = !!(server || via);

    const parts: string[] = [];
    if (server) parts.push(`Server: ${server}`);
    if (via) parts.push(`Via: ${via}`);

    return {
      id: 'version-headers',
      name: 'Server version headers',
      status: exposed ? 'warn' : 'pass',
      message: exposed
        ? `Version info exposed in response headers: ${parts.join(', ')}. Helps attackers target known vulnerabilities.`
        : 'Server version headers are stripped.',
      fix: exposed
        ? 'Configure your reverse proxy (nginx/Cloudflare) to strip Server and Via headers: proxy_hide_header Server; proxy_hide_header Via;'
        : undefined,
      steps: exposed ? (
        (server || '').includes('cloudflare') ? [
          'Note: "Server: cloudflare" means your backend is already hidden behind Cloudflare — good.',
          'To remove the Cloudflare header too: go to Cloudflare Dashboard → your domain → Rules → Transform Rules.',
          'Click "Create transform rule" → "Modify response header".',
          'Add action: Remove header named "Server". Save and deploy.',
          'This is low-priority — the header only reveals you use Cloudflare, not your backend.',
        ] : [
          'In nginx config, add to your server block: proxy_hide_header Server; and proxy_hide_header Via;',
          'Reload nginx: sudo nginx -s reload',
          'In Cloudflare: Rules → Transform Rules → Modify response header → Remove "Server" and "Via".',
        ]
      ) : undefined,
    };
  } catch {
    return { id: 'version-headers', name: 'Server version headers', status: 'pass', message: 'Could not check headers.' };
  }
}

async function checkEmailAutoconfirm(url: string, key: string): Promise<SecurityCheckResult> {
  try {
    const res = await fetch(`${url}/auth/v1/settings`, { headers: { 'apikey': key } });
    if (!res.ok) {
      return { id: 'email-autoconfirm', name: 'Email confirmation', status: 'pass', message: 'Auth settings not accessible (good).' };
    }
    const data = await res.json();
    const autoconfirm = data.mailer_autoconfirm === true;

    return {
      id: 'email-autoconfirm',
      name: 'Email confirmation',
      status: autoconfirm ? 'fail' : 'pass',
      message: autoconfirm
        ? 'Email autoconfirm is ON. Users can sign up without verifying their email, enabling account enumeration and impersonation.'
        : 'Email confirmation is required. Users must verify their email before accessing the account.',
      fix: autoconfirm
        ? 'In supabase/config.toml set [auth] enable_confirmations = true. In Supabase dashboard: Authentication > Settings > Enable email confirmations.'
        : undefined,
      steps: autoconfirm ? [
        'Log into your Supabase dashboard (supabase.com/dashboard).',
        'Select your project → Authentication → Settings.',
        'Find "Email confirmations" and toggle it ON.',
        'Save changes.',
        'For self-hosted: in supabase/config.toml, set [auth] enable_confirmations = true, then run: npx supabase db push',
      ] : undefined,
    };
  } catch {
    return { id: 'email-autoconfirm', name: 'Email confirmation', status: 'pass', message: 'Could not check auth settings.' };
  }
}

async function checkProductCountLeak(url: string, key: string): Promise<SecurityCheckResult> {
  try {
    const res = await fetch(`${url}/rest/v1/products?select=id&limit=0`, {
      headers: { 'apikey': key, 'Prefer': 'count=exact' },
    });
    const contentRange = res.headers.get('content-range');
    const leaks = contentRange !== null && contentRange !== '*/0' && contentRange !== '*/*';

    return {
      id: 'count-header-leak',
      name: 'Row count via Prefer header',
      status: leaks ? 'warn' : 'pass',
      message: leaks
        ? `Anonymous users can learn exact row counts via Prefer: count=exact header (${contentRange}). Low risk but leaks business data.`
        : 'Row count is not exposed via Prefer header.',
      fix: leaks
        ? 'Configure PostgREST max-rows or use a reverse proxy to strip the Prefer header from incoming requests.'
        : undefined,
      steps: leaks ? [
        'This is low-risk (count leak, not data leak). Fix only if you want to minimize information exposure.',
        'In Cloudflare: Rules → Transform Rules → Modify request header → Remove "Prefer" header.',
        'Or in nginx: proxy_set_header Prefer "";',
        'Note: this disables counting in Supabase API responses globally — check if any part of your app uses it.',
      ] : undefined,
    };
  } catch {
    return { id: 'count-header-leak', name: 'Row count via Prefer header', status: 'pass', message: 'Could not check.' };
  }
}

async function checkRPCFunctionHints(url: string, key: string): Promise<SecurityCheckResult> {
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
      name: 'RPC function name hints',
      status: hasHint ? 'warn' : 'pass',
      message: hasHint
        ? `PostgREST suggests real function names when a nonexistent function is called: "${body.hint}". Reveals internal API surface.`
        : 'PostgREST does not suggest function names.',
      fix: hasHint
        ? 'Set db-plan-enabled = false in PostgREST config, or restrict the exposed schema search path.'
        : undefined,
      steps: hasHint ? [
        'In Supabase Cloud this cannot be directly configured — contact support or use a WAF rule.',
        'In Cloudflare WAF: block or sanitize responses that contain "Perhaps you meant" in the body.',
        'For self-hosted PostgREST: in postgrest.conf set db-plan-enabled = false.',
        'This is low-risk — only affects naming hints, not data access.',
      ] : undefined,
    };
  } catch {
    return { id: 'rpc-function-hints', name: 'RPC function name hints', status: 'pass', message: 'Could not check.' };
  }
}

// ===== Sellf App Configuration Checks =====

async function checkHttpsRedirect(siteUrl: string): Promise<SecurityCheckResult> {
  if (!siteUrl || !siteUrl.startsWith('https://')) {
    return { id: 'https-redirect', name: 'HTTPS redirect', status: 'warn', message: 'SITE_URL is not HTTPS. Cannot verify redirect.', fix: 'Set SITE_URL to your https:// production URL.' };
  }
  try {
    const httpUrl = siteUrl.replace('https://', 'http://');
    const res = await fetch(httpUrl, { redirect: 'manual' });
    const location = res.headers.get('location');
    const redirectsToHttps = (res.status === 301 || res.status === 308) && location?.startsWith('https://');

    return {
      id: 'https-redirect',
      name: 'HTTPS redirect',
      status: redirectsToHttps ? 'pass' : 'warn',
      message: redirectsToHttps
        ? 'HTTP requests are permanently redirected to HTTPS.'
        : `HTTP requests are not redirected to HTTPS (HTTP ${res.status}). Users accessing via HTTP get unencrypted content.`,
      fix: redirectsToHttps ? undefined
        : 'Enable "Always Use HTTPS" in Cloudflare: SSL/TLS > Edge Certificates. Or configure your reverse proxy to redirect HTTP to HTTPS.',
      steps: redirectsToHttps ? undefined : [
        'In Cloudflare Dashboard: select your domain → SSL/TLS → Edge Certificates.',
        'Enable "Always Use HTTPS" toggle.',
        'Without Cloudflare: add to nginx: return 301 https://$host$request_uri; in the HTTP server block.',
      ],
    };
  } catch {
    return { id: 'https-redirect', name: 'HTTPS redirect', status: 'pass', message: 'HTTP not reachable (likely blocked — good).' };
  }
}

async function checkHstsHeader(siteUrl: string): Promise<SecurityCheckResult> {
  if (!siteUrl) {
    return { id: 'hsts', name: 'HSTS header', status: 'warn', message: 'SITE_URL not set. Cannot check HSTS.', fix: 'Set SITE_URL to your production URL.' };
  }
  try {
    const res = await fetch(siteUrl, { redirect: 'manual' });
    const hsts = res.headers.get('strict-transport-security');

    return {
      id: 'hsts',
      name: 'HSTS header',
      status: hsts ? 'pass' : 'warn',
      message: hsts
        ? `HSTS is enabled: ${hsts}`
        : 'Strict-Transport-Security header is missing. First-time visitors can be intercepted via HTTP before redirect.',
      fix: hsts ? undefined
        : 'Enable HSTS in Cloudflare: SSL/TLS > Edge Certificates > Enable HSTS. Or ensure DISABLE_HSTS is not set to "true" in your environment.',
      steps: hsts ? undefined : [
        'In Cloudflare Dashboard: select your domain → SSL/TLS → Edge Certificates.',
        'Scroll to "HTTP Strict Transport Security (HSTS)" and click "Enable HSTS".',
        'Set max-age to at least 6 months (recommended: 1 year = 31536000 seconds).',
        'Optionally enable "Include subdomains" and "Preload".',
        'Click "Save". HSTS takes effect immediately for new visitors.',
        'Without Cloudflare: add to nginx: add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;',
      ],
    };
  } catch {
    return { id: 'hsts', name: 'HSTS header', status: 'warn', message: 'Could not reach site to check HSTS.' };
  }
}

async function checkAppUrl(): Promise<SecurityCheckResult> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || '';
  const isLocalhost = !appUrl || appUrl.includes('localhost') || appUrl.includes('127.0.0.1');

  return {
    id: 'app-url',
    name: 'App URL configuration',
    status: isLocalhost ? 'fail' : 'pass',
    message: isLocalhost
      ? `NEXT_PUBLIC_APP_URL is ${appUrl || 'not set'}. Open Graph meta tags (og:url, og:image) will reference localhost, breaking social media sharing previews.`
      : `App URL is set to ${appUrl}.`,
    fix: isLocalhost
      ? 'Set NEXT_PUBLIC_APP_URL to your production URL (e.g., https://yourdomain.com) in .env.local and restart the app.'
      : undefined,
  };
}

async function checkAllowedOrigins(): Promise<SecurityCheckResult> {
  const allowedOrigins = process.env.ALLOWED_ORIGINS;
  const hasOrigins = !!allowedOrigins && allowedOrigins.trim().length > 0;

  return {
    id: 'allowed-origins',
    name: 'CORS allowed origins',
    status: hasOrigins ? 'pass' : 'warn',
    message: hasOrigins
      ? `Cross-domain origins are restricted to: ${allowedOrigins}`
      : 'ALLOWED_ORIGINS is not set. Cross-domain API access (/api/access) is limited to your own domain. If you embed Sellf on external sites, add their origins.',
    fix: hasOrigins ? undefined
      : 'If you use Sellf cross-domain (sellf.js on external sites), set ALLOWED_ORIGINS in .env.local to a comma-separated list of customer domains: ALLOWED_ORIGINS=https://site1.com,https://site2.com',
    steps: hasOrigins ? undefined : [
      'First, decide: do you embed sellf.js on any external domains (outside your Sellf domain)?',
      'If NO — you can safely ignore this warning. CORS is not needed for single-domain use.',
      'If YES — identify all external domains where sellf.js is embedded (e.g., https://yourshop.com).',
      'SSH into your server and edit: /opt/stacks/sellf-tsa/admin-panel/.env.local',
      'Add: ALLOWED_ORIGINS=https://yourshop.com,https://another-site.com',
      'Restart: pm2 restart sellf-tsa',
    ],
  };
}

// ===== Environment Variable Checks =====

async function checkAppEncryptionKey(): Promise<SecurityCheckResult> {
  const key = process.env.APP_ENCRYPTION_KEY || process.env.STRIPE_ENCRYPTION_KEY;

  if (!key) {
    return {
      id: 'app-encryption-key',
      name: 'App encryption key',
      status: 'fail',
      message: 'APP_ENCRYPTION_KEY is not set. Stripe keys and webhook secrets stored in the database cannot be decrypted — payments and webhooks will fail.',
      fix: 'Generate a key with: openssl rand -base64 32, then add APP_ENCRYPTION_KEY=<value> to .env.local and restart.',
    };
  }

  try {
    const buf = Buffer.from(key, 'base64');
    if (buf.length !== 32) {
      return {
        id: 'app-encryption-key',
        name: 'App encryption key',
        status: 'fail',
        message: `APP_ENCRYPTION_KEY is set but invalid: decoded length is ${buf.length} bytes, expected 32. Database-stored secrets cannot be decrypted.`,
        fix: 'Generate a valid key with: openssl rand -base64 32',
      };
    }
  } catch {
    return {
      id: 'app-encryption-key',
      name: 'App encryption key',
      status: 'fail',
      message: 'APP_ENCRYPTION_KEY is not valid base64.',
      fix: 'Generate a valid key with: openssl rand -base64 32',
    };
  }

  return {
    id: 'app-encryption-key',
    name: 'App encryption key',
    status: 'pass',
    message: 'APP_ENCRYPTION_KEY is set and valid.',
  };
}

async function checkCaptcha(): Promise<SecurityCheckResult> {
  const turnstileSiteKey = process.env.CLOUDFLARE_TURNSTILE_SITE_KEY || process.env.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY;
  const turnstileSecretKey = process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;
  const altchaKey = process.env.ALTCHA_HMAC_KEY;

  // Turnstile fully configured — best option
  if (turnstileSiteKey && turnstileSecretKey) {
    return {
      id: 'captcha',
      name: 'Captcha (bot protection)',
      status: 'pass',
      message: 'Cloudflare Turnstile is configured (site key + secret key).',
    };
  }

  // Turnstile site key without secret — broken config
  if (turnstileSiteKey && !turnstileSecretKey) {
    return {
      id: 'captcha',
      name: 'Captcha (bot protection)',
      status: 'fail',
      message: 'CLOUDFLARE_TURNSTILE_SITE_KEY is set but CLOUDFLARE_TURNSTILE_SECRET_KEY is missing. The widget appears but server-side verification is skipped.',
      fix: 'Add CLOUDFLARE_TURNSTILE_SECRET_KEY to .env.local, or remove the site key and use ALTCHA instead (set ALTCHA_HMAC_KEY).',
    };
  }

  // ALTCHA configured — self-hosted fallback
  if (altchaKey) {
    return {
      id: 'captcha',
      name: 'Captcha (bot protection)',
      status: 'pass',
      message: 'ALTCHA (self-hosted proof-of-work) is configured via ALTCHA_HMAC_KEY.',
    };
  }

  // Nothing configured
  return {
    id: 'captcha',
    name: 'Captcha (bot protection)',
    status: 'warn',
    message: 'No captcha provider is configured. Bot protection on signup and free product claim endpoints is disabled.',
    fix: 'Set ALTCHA_HMAC_KEY (self-hosted, zero dependencies) or configure Cloudflare Turnstile (CLOUDFLARE_TURNSTILE_SITE_KEY + CLOUDFLARE_TURNSTILE_SECRET_KEY).',
  };
}

async function checkCronSecret(): Promise<SecurityCheckResult> {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return {
      id: 'cron-secret',
      name: 'Cron job secret',
      status: 'warn',
      message: 'CRON_SECRET is not set. All requests to /api/cron are rejected, so scheduled jobs (access-expired webhooks, webhook log cleanup) are not running.',
      fix: 'Generate a secret with: openssl rand -base64 32, add CRON_SECRET=<value> to .env.local, restart the app, and configure your cron scheduler to call /api/cron with Authorization: Bearer <secret>.',
      steps: [
        'Generate a random secret — run in terminal: openssl rand -base64 32',
        'Copy the output (e.g., "abc123..."). Keep it safe.',
        'SSH into your server: ssh mikrus',
        'Edit: nano /opt/stacks/sellf-tsa/admin-panel/.env.local',
        'Add a new line: CRON_SECRET=<paste-your-secret-here>',
        'Restart: pm2 restart sellf-tsa',
        'Set up an hourly cron job — option A: free service at cron-job.org, URL: https://yourdomain.com/api/cron, method: GET, header: Authorization: Bearer <your-secret>',
        'Option B: on your server — crontab -e → add: 0 * * * * curl -s -H "Authorization: Bearer <secret>" https://yourdomain.com/api/cron',
      ],
    };
  }

  return {
    id: 'cron-secret',
    name: 'Cron job secret',
    status: 'pass',
    message: 'CRON_SECRET is configured. Scheduled jobs are protected and callable.',
  };
}

async function checkStripeWebhookSecret(): Promise<SecurityCheckResult> {
  const envSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (envSecret) {
    return {
      id: 'stripe-webhook-secret',
      name: 'Stripe webhook secret',
      status: 'pass',
      message: 'STRIPE_WEBHOOK_SECRET is set in environment variables.',
    };
  }

  // Not in env — may still work via DB (which has priority anyway)
  return {
    id: 'stripe-webhook-secret',
    name: 'Stripe webhook secret',
    status: 'warn',
    message: 'STRIPE_WEBHOOK_SECRET is not set in environment variables. The app uses the encrypted value from the database (Settings → Integrations) as the primary source. If neither is configured, Stripe webhooks will fail signature verification and purchases will not be confirmed.',
    fix: 'Configure the webhook secret in Settings → Integrations → Stripe (preferred), or set STRIPE_WEBHOOK_SECRET in .env.local as a fallback. Ensure APP_ENCRYPTION_KEY is valid for DB-stored secrets to work.',
    steps: [
      'Preferred method (stored encrypted in database):',
      '1. Go to Stripe Dashboard → Developers → Webhooks → select your endpoint.',
      '2. Copy the "Signing secret" (starts with whsec_...).',
      '3. In Sellf admin panel: Settings → Integrations → Stripe → paste the webhook secret and save.',
      'Alternative (environment variable):',
      '4. SSH into your server and edit .env.local.',
      '5. Add: STRIPE_WEBHOOK_SECRET=whsec_... and restart: pm2 restart sellf-tsa',
      'Make sure APP_ENCRYPTION_KEY is set — it is required to decrypt the DB-stored secret.',
    ],
  };
}

async function checkCookieSecure(siteUrl: string): Promise<SecurityCheckResult> {
  if (!siteUrl) {
    return { id: 'cookie-secure', name: 'Cookie security', status: 'warn', message: 'SITE_URL not set. Cannot check cookies.', fix: 'Set SITE_URL to your production URL.' };
  }
  try {
    const res = await fetch(siteUrl, { redirect: 'follow' });
    const setCookies = res.headers.getSetCookie?.() || [];
    const insecureCookies = setCookies.filter(c => !c.toLowerCase().includes('secure'));

    if (setCookies.length === 0) {
      return { id: 'cookie-secure', name: 'Cookie security', status: 'pass', message: 'No cookies set on initial page load.' };
    }

    const allSecure = insecureCookies.length === 0;

    return {
      id: 'cookie-secure',
      name: 'Cookie security',
      status: allSecure ? 'pass' : 'warn',
      message: allSecure
        ? `All ${setCookies.length} cookies have the Secure flag.`
        : `${insecureCookies.length} of ${setCookies.length} cookies are missing the Secure flag. These cookies will be sent over unencrypted HTTP connections.`,
      fix: allSecure ? undefined
        : 'Ensure all cookies are set with the Secure flag. For NEXT_LOCALE, this requires next-intl configuration. For auth cookies, check Supabase cookie settings.',
      steps: allSecure ? undefined : [
        'The NEXT_LOCALE cookie (from next-intl) is typically the cause — it lacks the Secure flag by default.',
        'If your site enforces HTTPS everywhere (recommended), this is low-risk in practice.',
        'To fix: in your Next.js middleware, manually override the NEXT_LOCALE cookie with the Secure flag after next-intl sets it.',
        'Auth cookies from Supabase use HttpOnly + Secure in production by default — verify in browser DevTools → Application → Cookies.',
      ],
    };
  } catch {
    return { id: 'cookie-secure', name: 'Cookie security', status: 'warn', message: 'Could not reach site to check cookies.' };
  }
}
