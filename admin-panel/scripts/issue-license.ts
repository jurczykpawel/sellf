#!/usr/bin/env bun
/**
 * Issue a seller product license (this is also how Sellf's own licenses are issued:
 * the TSA Sellf instance sells the "sellf" product and its tokens unlock Pro features).
 *
 * Default — through API v1 (recorded in issued_licenses: panel, CRL, license.issued, buyer mail):
 *   SELLF_URL=https://shop.example SELLF_API_KEY=sf_live_... \
 *     bun scripts/issue-license.ts --product-id <uuid> --email <email> [--domain <host>] [--no-email] [--locale pl|en]
 *
 * Emergency — offline signing (NOT recorded: cannot be revoked in Sellf, no webhook, no mail):
 *   SELLF_LICENSE_PRIVATE_KEY_FILE=key.pem \
 *     bun scripts/issue-license.ts --offline --kid <kid> --product <slug> --email <email> [--domain <host>] [--tier <tier>] [--days <n>]
 *   (or SELLF_LICENSE_PRIVATE_KEY=<PEM>). Use --days to bound an unrevocable license.
 *
 * Signing uses src/lib/license-keys/format.ts, the same code Sellf uses on purchase.
 * @see docs-site/src/content/docs/guides/license-keys.md
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { signLicense, type LicenseClaims } from '@/lib/license-keys/format';
import { normalizeLicenseDomain } from '@/lib/license-keys/domain';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FLAGS = new Set(['offline', 'no-email']);

export type CliArgs =
  | { mode: 'api'; productId: string; email: string; domain?: string; sendEmail: boolean; locale?: 'pl' | 'en' }
  | { mode: 'offline'; kid: string; product: string; email: string; domain?: string; tier: string | null; days: number | null };

export function parseCliArgs(argv: string[]): CliArgs {
  const values: Record<string, string> = {};
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].replace(/^--/, '');
    if (!argv[i].startsWith('--')) throw new Error(`Unexpected argument: ${argv[i]}`);
    if (FLAGS.has(name)) { flags.add(name); continue; }
    const value = argv[++i];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for --${name}`);
    values[name] = value;
  }
  if (!values.email || !EMAIL.test(values.email)) throw new Error('Missing or invalid --email');
  let domain: string | undefined;
  if (values.domain !== undefined) {
    domain = normalizeLicenseDomain(values.domain);
    if (!domain) throw new Error('Invalid --domain');
  }
  if (flags.has('offline')) {
    if (!values.kid || !values.product) throw new Error('Offline mode needs --kid and --product <slug>');
    const days = values.days === undefined ? null : Number(values.days);
    if (days !== null && (!Number.isSafeInteger(days) || days <= 0)) throw new Error('Invalid --days');
    return { mode: 'offline', kid: values.kid, product: values.product, email: values.email, domain, tier: values.tier ?? null, days };
  }
  if (!values['product-id'] || !UUID.test(values['product-id'])) throw new Error('Missing or invalid --product-id <uuid>');
  if (values.locale !== undefined && values.locale !== 'pl' && values.locale !== 'en') throw new Error('Invalid --locale');
  return { mode: 'api', productId: values['product-id'], email: values.email, domain, sendEmail: !flags.has('no-email'), locale: values.locale as 'pl' | 'en' | undefined };
}

interface CliContext {
  env: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  warn: (message: string) => void;
}

export async function runIssueLicense(args: CliArgs, ctx: CliContext): Promise<string> {
  if (args.mode === 'offline') {
    const pem = ctx.env.SELLF_LICENSE_PRIVATE_KEY
      ?? (ctx.env.SELLF_LICENSE_PRIVATE_KEY_FILE ? readFileSync(ctx.env.SELLF_LICENSE_PRIVATE_KEY_FILE, 'utf8') : undefined);
    if (!pem) throw new Error('Set SELLF_LICENSE_PRIVATE_KEY or SELLF_LICENSE_PRIVATE_KEY_FILE');
    ctx.warn('WARNING: offline license is not recorded in Sellf: it cannot be revoked there, sends no license.issued webhook and no buyer mail. Prefer the API mode.');
    const iat = Math.floor(Date.now() / 1000);
    const claims: LicenseClaims = {
      v: 1, kid: args.kid, product: args.product, email: args.email, order: `offline_${randomUUID()}`,
      tier: args.tier, iat, exp: args.days === null ? null : iat + args.days * 86400,
      ...(args.domain && { domain: args.domain }),
    };
    return signLicense(claims, pem);
  }
  const base = ctx.env.SELLF_URL?.replace(/\/+$/, '');
  if (!base || !ctx.env.SELLF_API_KEY) throw new Error('Set SELLF_URL and SELLF_API_KEY (scope licenses:write), or use --offline');
  const response = await ctx.fetchImpl(`${base}/api/v1/licenses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': ctx.env.SELLF_API_KEY },
    body: JSON.stringify({
      productId: args.productId, email: args.email, ...(args.domain && { domain: args.domain }),
      sendEmail: args.sendEmail, ...(args.locale && { locale: args.locale }),
    }),
    redirect: 'error',
  });
  const body = await response.json().catch(() => ({})) as { data?: { token?: string }; error?: { message?: string } | string };
  if (!response.ok || !body.data?.token) {
    const message = typeof body.error === 'string' ? body.error : body.error?.message;
    throw new Error(`Sellf API refused the license (HTTP ${response.status}): ${message ?? 'unknown error'}`);
  }
  return body.data.token;
}

if (import.meta.main) {
  try {
    const token = await runIssueLicense(parseCliArgs(process.argv.slice(2)), { env: process.env, fetchImpl: fetch, warn: m => console.error(m) });
    process.stdout.write(`${token}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}
