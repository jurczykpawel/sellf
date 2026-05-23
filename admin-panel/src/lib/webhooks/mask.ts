export function maskWebhookSecret(secret: string | null | undefined): string {
  if (!secret) return '••••••••••••••••';
  const match = secret.match(/^([a-z]+_)/i);
  return (match?.[1] ?? '') + '••••••••••••••••';
}
