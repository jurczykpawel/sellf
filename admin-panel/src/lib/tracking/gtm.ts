/**
 * GTM client-side loading helpers.
 */

/**
 * Base origin the web container's `gtm.js` is loaded from in the browser.
 * ALWAYS Google's CDN.
 *
 * `gtm_server_container_url` (e.g. a self-hosted sGTM such as
 * `t.techskills.academy`) is a server-side TRANSPORT endpoint — it answers the
 * GA4 Measurement Protocol (`/mp/collect`) and Meta CAPI and is wired into the
 * GTM container's tags. It is NOT a host that serves `gtm.js`; requesting
 * `gtm.js` from it returns HTTP 400 and breaks GTM entirely. The web container
 * therefore always loads from googletagmanager.com (matching the public
 * techskills.academy site, same container GTM-NJS284KN), while server-side
 * routing stays configured inside the GTM container itself.
 */
export function gtmLoaderBaseUrl(config?: { gtm_server_container_url?: string | null }): string {
  // Intentionally ignores config.gtm_server_container_url — see note above.
  void config
  return 'https://www.googletagmanager.com'
}
