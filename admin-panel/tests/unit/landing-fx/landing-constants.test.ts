import { describe, it, expect } from 'vitest';
import { SELLF_GITHUB_URL } from '@/lib/constants';

describe('landing constants', () => {
  it('SELLF_GITHUB_URL points to the Sellf repo over https', () => {
    expect(SELLF_GITHUB_URL).toMatch(/^https:\/\/github\.com\/jurczykpawel\/sellf\/?$/);
  });
});
