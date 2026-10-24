/** Browser fixture using the shared API client and recovery notice. */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { Toaster } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useWebhooks } from '@/hooks/useWebhooks';
import SessionExpiryNotice from '@/components/SessionExpiryNotice';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';

const locale = new URLSearchParams(location.search).get('locale') === 'pl' ? 'pl' : 'en';
function Action() {
  const { deleteEndpoint } = useWebhooks();
  const [result, setResult] = useState('Ready');
  return <>
    <button onClick={async () => {
      setResult(await deleteEndpoint('endpoint') ? 'Deleted' : 'Retained');
    }}>Delete webhook</button><output>{result}</output>
  </>;
}
const token = `${btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=+$/, '')}.${btoa(JSON.stringify({ sub: 'admin', exp: 4102444800 })).replace(/=+$/, '')}.c2lnbmF0dXJl`;
const client = await createClient();
const { error } = await client.auth.setSession({ access_token: token, refresh_token: 'fixture-refresh' });
if (error) throw error;
createRoot(document.getElementById('root')!).render(<NextIntlClientProvider locale={locale} timeZone="UTC" messages={locale === 'pl' ? pl : en}><SessionExpiryNotice /><Toaster /><Action /></NextIntlClientProvider>);
