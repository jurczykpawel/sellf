import { createRoot } from 'react-dom/client';
import { createTranslator, NextIntlClientProvider } from 'next-intl';
import Panel from '@/components/settings/SecurityAuditSettings';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';

const locale = new URLSearchParams(location.search).get('locale') === 'pl' ? 'pl' : 'en';
const messages = locale === 'pl' ? pl : en;
const t = createTranslator({ locale, messages: messages.securityAudit.checks });
Object.assign(globalThis, {
  panelCalls: [],
  panelResult: { success: true, timestamp: '2026-10-17T12:00:00Z', checks: [{
    id: 'count-header-leak', status: 'warn',
    name: t('productCountLeakName'),
    message: t('productCountLeakMessage', { value0: '0-12/13' }),
    steps: [t('productCountLeakSteps1'), t('productCountLeakSteps2'), t('productCountLeakSteps3'), t('productCountLeakSteps4')],
  }] },
});
createRoot(document.getElementById('root')!).render(<NextIntlClientProvider locale={locale} messages={messages}><Panel /></NextIntlClientProvider>);
