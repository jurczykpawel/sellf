import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { Toaster } from 'sonner';
import { useWebhooks } from '@/hooks/useWebhooks';
import WebhookLogsDrawer from '@/components/WebhookLogsDrawer';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
import type { WebhookEndpoint } from '@/types/webhooks';

const endpoint = { id: 'endpoint', url: 'https://example.com/hook' } as WebhookEndpoint;
function Feedback() {
  const { testEndpoint } = useWebhooks();
  const [open, setOpen] = useState(false);
  return <>
    <button onClick={() => testEndpoint(endpoint.id, 'purchase.completed')}>Test</button>
    <button onClick={() => setOpen(true)}>Logs</button>
    <WebhookLogsDrawer endpoint={endpoint} isOpen={open} onClose={() => setOpen(false)} />
    <Toaster />
  </>;
}
const locale = new URLSearchParams(location.search).get('locale') === 'pl' ? 'pl' : 'en';
createRoot(document.getElementById('root')!).render(
  <NextIntlClientProvider locale={locale} timeZone="UTC" messages={locale === 'pl' ? pl : en}><Feedback /></NextIntlClientProvider>,
);
