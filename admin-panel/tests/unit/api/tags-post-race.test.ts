import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
}));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, authenticate: mocks.authenticate };
});

import { POST } from '@/app/api/v1/tags/route';

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/v1/tags', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeSupabaseInsertError(code: string) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        })),
      })),
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: null, error: { code, message: 'simulated' } }),
        })),
      })),
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/v1/tags slug race mapping', () => {
  it('maps Postgres 23505 from insert to 409 CONFLICT', async () => {
    mocks.authenticate.mockResolvedValue({ supabase: makeSupabaseInsertError('23505'), user: { id: 'u1' } });

    const response = await POST(makeRequest({ name: 'X', slug: 'x' }) as never);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error?.code).toBe('CONFLICT');
  });

  it('maps other insert errors to 500 INTERNAL_ERROR', async () => {
    mocks.authenticate.mockResolvedValue({ supabase: makeSupabaseInsertError('XX000'), user: { id: 'u1' } });

    const response = await POST(makeRequest({ name: 'X', slug: 'x' }) as never);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error?.code).toBe('INTERNAL_ERROR');
  });
});
