import { describe, it, expect, vi, beforeEach } from 'vitest';

import { requireCaptcha } from '@/lib/captcha/route-guard';
import * as verifyModule from '@/lib/captcha/verify';

describe('requireCaptcha', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when verifyCaptchaToken succeeds', async () => {
    vi.spyOn(verifyModule, 'verifyCaptchaToken').mockResolvedValue({ success: true });
    expect(await requireCaptcha('any-token')).toBeNull();
  });

  it('returns 400 with provided error message when verification fails', async () => {
    vi.spyOn(verifyModule, 'verifyCaptchaToken').mockResolvedValue({
      success: false,
      error: 'fake error',
    });
    const res = await requireCaptcha('bad-token');
    expect(res).not.toBeNull();
    expect(res!.status).toBe(400);
    const body = await res!.json();
    expect(body.error).toBe('fake error');
  });

  it('falls back to generic message when verifier returns no error', async () => {
    vi.spyOn(verifyModule, 'verifyCaptchaToken').mockResolvedValue({ success: false });
    const res = await requireCaptcha('bad-token');
    expect(res).not.toBeNull();
    const body = await res!.json();
    expect(body.error).toBe('Security verification failed');
  });

  it('passes provider override through to verifier', async () => {
    const spy = vi
      .spyOn(verifyModule, 'verifyCaptchaToken')
      .mockResolvedValue({ success: true });
    await requireCaptcha('token', 'altcha');
    expect(spy).toHaveBeenCalledWith('token', 'altcha');
  });
});
