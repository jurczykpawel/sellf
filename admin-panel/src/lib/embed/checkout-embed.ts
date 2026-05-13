import { NextResponse } from 'next/server';

const LOCALHOST_ORIGIN_PATTERN = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/;
const PRODUCT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,120}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PAID_CHECKOUT_KEYS = new Set(['productSlug', 'email']);
const FREE_ACCESS_KEYS = new Set(['productSlug', 'email', 'website', 'turnstileToken']);

export interface EmbedCheckoutBody {
  productSlug: string;
  email?: string;
}

export interface EmbedFreeAccessBody {
  productSlug: string;
  email: string;
  honeypot: string;
  turnstileToken?: string;
}

type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export function sanitizeAllowedEmbedOrigins(origins: unknown): string[] {
  if (!Array.isArray(origins)) return [];

  const normalized = origins
    .filter((origin): origin is string => typeof origin === 'string')
    .map((origin) => normalizeOrigin(origin))
    .filter((origin): origin is string => origin !== null);

  return [...new Set(normalized)];
}

export function getEnvAllowedEmbedOrigins(): string[] {
  const raw = process.env.SELLF_EMBED_ALLOWED_ORIGINS;
  if (!raw) return [];

  return sanitizeAllowedEmbedOrigins(
    raw
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

export function normalizeOrigin(origin: string): string | null {
  try {
    const url = new URL(origin.trim());
    if (url.pathname !== '/' || url.search || url.hash || !url.hostname) return null;
    if (url.protocol === 'https:' || LOCALHOST_ORIGIN_PATTERN.test(url.origin)) {
      return url.origin;
    }
  } catch {
    return null;
  }
  return null;
}

export function isAllowedEmbedOrigin(origin: string | null, allowedOrigins: string[]): boolean {
  if (!origin) return false;
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  return allowedOrigins.includes(normalized);
}

export function buildEmbedCorsHeaders(
  origin: string | null,
  allowedOrigins: string[],
): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Sellf-Embed-Version',
    'Access-Control-Max-Age': '600',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };

  if (origin && isAllowedEmbedOrigin(origin, allowedOrigins)) {
    const normalized = normalizeOrigin(origin);
    if (normalized) headers['Access-Control-Allow-Origin'] = normalized;
  }

  return headers;
}

export function embedJson(
  data: unknown,
  status: number,
  origin: string | null,
  allowedOrigins: string[],
): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: buildEmbedCorsHeaders(origin, allowedOrigins),
  });
}

export function parseEmbedCheckoutBody(body: unknown): ParseResult<EmbedCheckoutBody> {
  if (!isRecord(body)) return { ok: false, error: 'Invalid request' };
  if (!hasOnlyKeys(body, PAID_CHECKOUT_KEYS)) return { ok: false, error: 'Invalid request' };

  const productSlug = parseProductSlug(body.productSlug);
  if (!productSlug) return { ok: false, error: 'Invalid request' };

  const email = parseOptionalEmail(body.email);
  if (email === false) return { ok: false, error: 'Invalid request' };

  return {
    ok: true,
    value: {
      productSlug,
      ...(email ? { email } : {}),
    },
  };
}

export function parseEmbedFreeAccessBody(body: unknown): ParseResult<EmbedFreeAccessBody> {
  if (!isRecord(body)) return { ok: false, error: 'Invalid request' };
  if (!hasOnlyKeys(body, FREE_ACCESS_KEYS)) return { ok: false, error: 'Invalid request' };

  const productSlug = parseProductSlug(body.productSlug);
  if (!productSlug) return { ok: false, error: 'Invalid request' };

  const email = parseRequiredEmail(body.email);
  if (!email) return { ok: false, error: 'Invalid request' };

  const honeypot = typeof body.website === 'string' ? body.website.trim() : '';
  const turnstileToken = typeof body.turnstileToken === 'string' ? body.turnstileToken.trim() : undefined;

  return {
    ok: true,
    value: {
      productSlug,
      email,
      honeypot,
      ...(turnstileToken ? { turnstileToken } : {}),
    },
  };
}

export function getSellfBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.SITE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    'http://localhost:3000'
  ).replace(/\/+$/, '');
}

export function buildEmbedReturnUrl(productSlug: string): string {
  return `${getSellfBaseUrl()}/p/${encodeURIComponent(productSlug)}/payment-status?session_id={CHECKOUT_SESSION_ID}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: Set<string>): boolean {
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function parseProductSlug(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const slug = value.trim();
  if (!PRODUCT_SLUG_PATTERN.test(slug)) return null;
  return slug;
}

function parseOptionalEmail(value: unknown): string | false | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return parseRequiredEmail(value) || false;
}

function parseRequiredEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email) || email.length > 254) return null;
  return email;
}
