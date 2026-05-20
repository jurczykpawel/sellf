export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertProductionStartupConfig } = await import('@/lib/security/startup-assertions');
    assertProductionStartupConfig();
  }
}
