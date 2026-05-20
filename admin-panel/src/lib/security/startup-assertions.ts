export function assertTrustedProxyConfig(): void {
  if (process.env.NODE_ENV !== 'production') return;
  if (process.env.TRUSTED_PROXY === 'true') return;

  throw new Error(
    'Refusing to start: NODE_ENV=production but TRUSTED_PROXY is not "true". ' +
      'Set TRUSTED_PROXY=true and ensure a reverse proxy (Caddy/nginx) sits in front of Node, ' +
      'or expose Node directly to the public internet at your own risk. See .env.example.',
  );
}
