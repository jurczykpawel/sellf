/**
 * /legal/terms and /legal/privacy — the generated legal document itself.
 *
 * `/terms` and `/privacy` are the seller-facing entry points (they redirect
 * to a manual URL, or to `/legal/<type>` once a document has been generated).
 * This route reads the stored object with the SERVICE-ROLE client (fixes the
 * Coolify-style internal `SUPABASE_URL`), then renders it through a
 * sanitizing pipeline — see `@/components/legal/LegalDocument` — instead of
 * linking straight to Supabase Storage (which serves `text/html` as
 * `text/plain`, so buyers would see raw markup).
 *
 * @see /lib/legal/storage.ts — publishSnapshot writes the object this reads
 * @see /components/legal/LegalDocument.tsx — sanitize + render
 */

import { notFound } from 'next/navigation';
import { unstable_noStore as noStore } from 'next/cache';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { createPublicClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { BUCKET } from '@/lib/legal/storage';
import LegalDocument from '@/components/legal/LegalDocument';

export const dynamic = 'force-dynamic';

const LEGAL_TYPES = ['terms', 'privacy'] as const;
type LegalType = (typeof LEGAL_TYPES)[number];

function isLegalType(value: string): value is LegalType {
  return (LEGAL_TYPES as readonly string[]).includes(value);
}

type Props = {
  params: Promise<{ type: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { type } = await params;
  if (!isLegalType(type)) return {};

  const t = await getTranslations(`legalPages.${type}`);
  return {
    title: `${t('title')} - Sellf`,
    robots: 'index, follow',
  };
}

export default async function LegalDocumentPage({ params }: Props) {
  const { type } = await params;
  if (!isLegalType(type)) notFound();

  // This page reads a stored document straight from Storage — never cache it.
  noStore();

  const t = await getTranslations(`legalPages.${type}`);

  const supabase = createPublicClient();
  const { data: config } = await supabase.from('shop_config').select('id').single();

  if (!config?.id) notFound();

  const adminClient = createAdminClient();
  const { data: file, error } = await adminClient.storage
    .from(BUCKET)
    .download(`${config.id}/${type}.html`);

  if (error || !file) notFound();

  const html = await file.text();

  return (
    <div className="min-h-screen bg-sf-deep py-12">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-sf-raised/80 backdrop-blur-sm rounded-2xl p-8 shadow-[var(--sf-shadow-accent)] border border-sf-border">
          <h1 className="text-3xl font-bold text-sf-heading mb-8 text-center">{t('title')}</h1>
          <LegalDocument html={html} />
        </div>
      </div>
    </div>
  );
}
