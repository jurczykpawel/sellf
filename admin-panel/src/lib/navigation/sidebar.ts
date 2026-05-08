export function normalizeSidebarPath(pathname: string): string {
  const withoutTrailingSlash = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const withoutLocale = withoutTrailingSlash.replace(/^\/[a-z]{2}(?=\/|$)/i, '');
  return withoutLocale || '/';
}

export function isSidebarLinkActive(pathname: string, href: string, exact = false): boolean {
  const currentPath = normalizeSidebarPath(pathname);
  const targetPath = normalizeSidebarPath(href);

  if (targetPath === '/') {
    return currentPath === '/';
  }

  if (exact) {
    return currentPath === targetPath;
  }

  return currentPath === targetPath || currentPath.startsWith(`${targetPath}/`);
}

export function formatSidebarBadgeCount(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count > 99 ? '99+' : String(count);
}
