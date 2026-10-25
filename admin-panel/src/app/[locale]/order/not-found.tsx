/** Public 404 for order pages; the same page for everyone, admins included. @see ../not-found.tsx */
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Lock } from 'lucide-react';

export default async function OrderNotFound() {
  const t = await getTranslations('notFound');
  return <div className="min-h-screen bg-sf-deep flex items-center justify-center px-4">
    <div className="text-center max-w-lg mx-auto">
      <div className="mb-8 flex justify-center"><div className="w-20 h-20 bg-sf-accent/15 border border-sf-border-accent rounded-2xl flex items-center justify-center"><Lock className="h-10 w-10 text-sf-accent" /></div></div>
      <h1 className="text-7xl font-bold text-sf-accent mb-4">404</h1>
      <h2 className="text-2xl font-bold text-sf-heading mb-3">{t('guestTitle')}</h2>
      <p className="text-sf-body mb-8">{t('guestDescription')}</p>
      <Link href="/" className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold text-white bg-sf-accent-bg hover:bg-sf-accent-hover transition-[background-color] duration-200">{t('linkHome')}</Link>
    </div>
  </div>;
}
