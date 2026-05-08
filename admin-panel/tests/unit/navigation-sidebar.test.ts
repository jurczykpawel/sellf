import { describe, expect, it } from 'vitest';
import {
  formatSidebarBadgeCount,
  isSidebarLinkActive,
  normalizeSidebarPath,
} from '@/lib/navigation/sidebar';

describe('sidebar navigation helpers', () => {
  it('normalizes locale-prefixed paths', () => {
    expect(normalizeSidebarPath('/pl/dashboard/refund-requests/')).toBe('/dashboard/refund-requests');
    expect(normalizeSidebarPath('/en')).toBe('/');
  });

  it('does not mark the store root link active on every route', () => {
    expect(isSidebarLinkActive('/pl/dashboard/refund-requests', '/')).toBe(false);
    expect(isSidebarLinkActive('/pl/my-purchases', '/')).toBe(false);
    expect(isSidebarLinkActive('/pl', '/')).toBe(true);
  });

  it('matches non-root links on path boundaries only', () => {
    expect(isSidebarLinkActive('/pl/dashboard/refund-requests', '/dashboard/refund-requests')).toBe(true);
    expect(isSidebarLinkActive('/pl/dashboard/refund-requests/123', '/dashboard/refund-requests')).toBe(true);
    expect(isSidebarLinkActive('/pl/dashboard/refund-requests-extra', '/dashboard/refund-requests')).toBe(false);
  });

  it('formats sidebar badge counts', () => {
    expect(formatSidebarBadgeCount(0)).toBeNull();
    expect(formatSidebarBadgeCount(7)).toBe('7');
    expect(formatSidebarBadgeCount(100)).toBe('99+');
  });
});
