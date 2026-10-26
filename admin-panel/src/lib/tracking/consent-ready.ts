/** Readiness shared by consent initialization and footer controls. @see components/TrackingProvider.tsx */
let resolveReady: () => void;

export const cookieConsentReady = new Promise<void>((resolve) => {
  resolveReady = resolve;
});

export function markCookieConsentReady(): void {
  resolveReady();
}
