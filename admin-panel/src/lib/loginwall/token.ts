import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const DEFAULT_TTL_SECONDS = 30 * 60;

export interface SignOptions {
  productId: string;
  userId: string;
  secret: string;
  ttlSeconds?: number;
  now?: Date;
}

export interface SignResult {
  token: string;
  nonce: string;
  expiresAt: Date;
}

export type VerifyFailureReason =
  | 'malformed'
  | 'signature'
  | 'expired'
  | 'wrong_product';

interface TokenPayload {
  pid: string;
  uid: string;
  exp: number;
  nonce: string;
}

function hmac(secret: string, data: string): Buffer {
  return createHmac('sha256', secret).update(data).digest();
}

export function signLoginwallToken(opts: SignOptions): SignResult {
  const now = opts.now ?? new Date();
  const ttl = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const nonce = randomBytes(16).toString('hex');
  const expiresAt = new Date(now.getTime() + ttl * 1000);
  const payload: TokenPayload = {
    pid: opts.productId,
    uid: opts.userId,
    exp: Math.floor(expiresAt.getTime() / 1000),
    nonce,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sigB64 = hmac(opts.secret, payloadB64).toString('base64url');
  return {
    token: `${payloadB64}.${sigB64}`,
    nonce,
    expiresAt,
  };
}

export interface GatePayload {
  v: 2;
  uid: string;
  auth: boolean;
  req: string[];
  owned: string[];
  exp: number;
  nonce: string;
}

export interface SignGateOptions {
  userId: string;
  authenticated: boolean;
  requested: string[];
  owned: string[];
  secret: string;
  ttlSeconds?: number;
  now?: Date;
}

export type GateVerifyResult =
  | { valid: true; uid: string; auth: boolean; req: string[]; owned: string[] }
  | { valid: false; reason: VerifyFailureReason };

export function signGateToken(opts: SignGateOptions): { token: string; expiresAt: Date } {
  const now = opts.now ?? new Date();
  const ttl = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const expiresAt = new Date(now.getTime() + ttl * 1000);
  const payload: GatePayload = {
    v: 2,
    uid: opts.userId,
    auth: opts.authenticated,
    req: opts.requested,
    owned: opts.owned,
    exp: Math.floor(expiresAt.getTime() / 1000),
    nonce: randomBytes(8).toString('hex'),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sigB64 = hmac(opts.secret, payloadB64).toString('base64url');
  return { token: `${payloadB64}.${sigB64}`, expiresAt };
}

function isGatePayload(value: unknown): value is GatePayload {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    v.v === 2 &&
    typeof v.uid === 'string' &&
    typeof v.auth === 'boolean' &&
    Array.isArray(v.req) &&
    v.req.every((s) => typeof s === 'string') &&
    Array.isArray(v.owned) &&
    v.owned.every((s) => typeof s === 'string') &&
    typeof v.exp === 'number' &&
    typeof v.nonce === 'string'
  );
}

export function parseGatePayload(token: string): GatePayload | null {
  if (!token || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  try {
    const payload = JSON.parse(Buffer.from(token.slice(0, dot), 'base64url').toString('utf-8'));
    return isGatePayload(payload) ? payload : null;
  } catch {
    return null;
  }
}

export function verifyGateToken(token: string, opts: { secret: string; now?: Date }): GateVerifyResult {
  if (!token || typeof token !== 'string') {
    return { valid: false, reason: 'malformed' };
  }
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) {
    return { valid: false, reason: 'malformed' };
  }
  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);

  const expected = hmac(opts.secret, payloadB64);
  let provided: Buffer;
  try {
    provided = Buffer.from(sigB64, 'base64url');
  } catch {
    return { valid: false, reason: 'malformed' };
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return { valid: false, reason: 'signature' };
  }

  const payload = parseGatePayload(token);
  if (!payload) {
    return { valid: false, reason: 'malformed' };
  }

  const nowSec = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  if (payload.exp < nowSec) {
    return { valid: false, reason: 'expired' };
  }

  return { valid: true, uid: payload.uid, auth: payload.auth, req: payload.req, owned: payload.owned };
}
