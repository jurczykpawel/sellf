export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertTrustedProxyConfig } = await import('@/lib/security/startup-assertions');
    assertTrustedProxyConfig();
  }
}
