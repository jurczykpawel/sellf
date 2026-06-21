import { describe, it, expect } from 'vitest';
import { wrapHtml } from '@/lib/legal/wrap-html';

describe('wrapHtml', () => {
  it('produces a standalone document with charset and title', () => {
    const out = wrapHtml('<h1>Regulamin</h1>', 'Regulamin');
    expect(out.startsWith('<!doctype html>')).toBe(true);
    expect(out).toContain('<meta charset="utf-8"');
    expect(out).toContain('<title>Regulamin</title>');
    expect(out).toContain('<h1>Regulamin</h1>');
  });
  it('does not double-wrap if fragment already a full document', () => {
    const full = '<!doctype html><html><body>x</body></html>';
    expect(wrapHtml(full, 'X')).toBe(full);
  });
});
