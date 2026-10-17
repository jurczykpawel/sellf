/** Manual payout screen. @see components/affiliates/PayoutScreen.tsx */
import { getLocale } from 'next-intl/server';
import PayoutScreen from '@/components/affiliates/PayoutScreen';
export default async function Page() { return <PayoutScreen locale={await getLocale() === 'pl' ? 'pl' : 'en'} />; }
