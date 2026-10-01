/**
 * saveActiveTheme/removeActiveTheme write to a single file shared by every
 * visitor of the instance (data/active-theme.json — no per-user scoping).
 * Outside demo mode they already require an admin session via
 * withAdminClient. In demo mode they must behave like every other mutating
 * admin action (see admin-auth.ts's `mutating` doc, demo-guard.ts): reject
 * the call before touching auth or disk, instead of writing on behalf of an
 * anonymous caller. An anonymous visitor must never be able to persist a
 * change that every other visitor (and the admin) then sees.
 * @see lib/actions/theme.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { getUserMock, mockMkdir, mockWriteFile, mockUnlink } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  mockMkdir: vi.fn().mockResolvedValue(undefined),
  mockWriteFile: vi.fn().mockResolvedValue(undefined),
  mockUnlink: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: getUserMock },
    from: () => ({
      select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
    }),
  })),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: () => ({
      select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
    }),
  })),
}));

vi.mock('@/lib/license/resolve', () => ({
  checkFeature: vi.fn().mockResolvedValue(true),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    promises: {
      ...actual.promises,
      mkdir: mockMkdir,
      writeFile: mockWriteFile,
      unlink: mockUnlink,
    },
  };
});

import { saveActiveTheme, removeActiveTheme } from '@/lib/actions/theme';

const VALID_THEME = {
  name: 'Anonymous Caller Theme',
  version: '1.0',
  colors: {
    accent: '#FF0000',
    'accent-hover': '#CC0000',
    'accent-soft': 'rgba(255,0,0,0.08)',
    'bg-deep': '#0A0A0A',
    'text-heading': '#FFFFFF',
  },
};

describe('theme actions reject an anonymous caller', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('demo mode (DEMO_MODE=true)', () => {
    beforeEach(() => {
      process.env.DEMO_MODE = 'true';
    });

    it('saveActiveTheme does not persist a theme for an anonymous caller', async () => {
      const result = await saveActiveTheme(VALID_THEME as any);

      expect(result.success).toBe(false);
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it('removeActiveTheme does not delete the theme for an anonymous caller', async () => {
      const result = await removeActiveTheme();

      expect(result.success).toBe(false);
      expect(mockUnlink).not.toHaveBeenCalled();
    });
  });

  describe('outside demo mode (DEMO_MODE unset)', () => {
    it('saveActiveTheme rejects an anonymous caller', async () => {
      const result = await saveActiveTheme(VALID_THEME as any);

      expect(result.success).toBe(false);
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it('removeActiveTheme rejects an anonymous caller', async () => {
      const result = await removeActiveTheme();

      expect(result.success).toBe(false);
      expect(mockUnlink).not.toHaveBeenCalled();
    });
  });
});
