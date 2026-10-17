/** Shared setup guidance for private affiliate screens. @see lib/affiliates/program-defaults.ts */
import Link from 'next/link';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';

export default function ProgramSetupNotice({ locale }: { locale: 'en' | 'pl' }) {
  const t = (locale === 'pl' ? pl : en).affiliates;
  return <div role="status" className="space-y-2 rounded-xl border border-sf-border bg-sf-base p-5 text-sm">
    <p>{t.programNotConfigured}</p>
    <Link className="inline-block font-medium text-sf-accent underline" href={`${locale === 'pl' ? '/pl' : ''}/dashboard/affiliates`}>{t.programSettings}</Link>
  </div>;
}
