export const AUTOSTART_COOKIE = 'sellf_tutorial_autostart';

/** Automated test servers (E2E_MODE) keep first-visit tutorials from covering pages unless a test opts in with the cookie. */
export function tutorialAutostartEnabled(cookieValue: string | undefined): boolean {
  return process.env.E2E_MODE !== 'true' || cookieValue === 'on';
}
