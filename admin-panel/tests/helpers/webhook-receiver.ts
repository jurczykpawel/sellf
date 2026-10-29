/** Owned HTTP receiver for consumer-contract tests. */
import { createServer } from 'node:http';
import { verifyWebhookSignature } from '@/lib/services/webhook-queue/signature';

export interface ReceivedWebhook {
  event: string;
  id: string;
  timestamp: string;
  data: Record<string, any>;
}
export async function webhookReceiver(secret: string): Promise<{ url: string; received: ReceivedWebhook[]; close: () => Promise<void> }> {
  const received: ReceivedWebhook[] = [];
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    if (!verifyWebhookSignature(secret, raw, String(request.headers['x-sellf-signature']))) { response.writeHead(401).end(); return; }
    const message = JSON.parse(raw) as ReceivedWebhook;
    if (!received.some(existing => existing.id === message.id)) received.push(message);
    response.writeHead(200).end('ok');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Receiver address unavailable');
  return { url: `http://127.0.0.1:${address.port}`, received, close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}
