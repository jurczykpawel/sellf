/**
 * True between `pagehide` and `pageshow`: requests dropped in that window are caused by
 * leaving the page, not by a failing server.
 * @see src/lib/api/client.ts
 */
let leavingPage = false;
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('pagehide', () => { leavingPage = true; });
  window.addEventListener('pageshow', () => { leavingPage = false; });
}

export function isLeavingPage(): boolean {
  return leavingPage;
}
