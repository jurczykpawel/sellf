/** Admin composition editor. @see lib/actions/storefront-templates.ts */
import { getTranslations } from 'next-intl/server';
import { storefrontTemplateAction } from '@/lib/actions/storefront-templates';
import OfferEditor from '@/components/storefront-editor/OfferEditor';
import StorefrontEditor from '@/components/storefront-editor/StorefrontEditor';

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ surface?: string; product?: string }> }) {
  const query = await searchParams;
  const offer = query.surface === 'offer' || !!query.product;
  const t = await getTranslations('offerEditor');
  const result = offer ? null : await storefrontTemplateAction({ operation: 'read' });
  const initial = result?.success && 'data' in result && 'revision' in result.data ? result.data : null;
  return <div className="space-y-6"><nav data-tour="templates-workspace" aria-label={t('workspace')} className="flex gap-2 border-b border-sf-border pb-4 text-sm font-medium"><a className={`rounded-lg px-4 py-2 ${!offer ? 'bg-sf-accent-soft text-sf-accent' : 'text-sf-muted'}`} href="?surface=storefront">{t('storefront')}</a><a className={`rounded-lg px-4 py-2 ${offer ? 'bg-sf-accent-soft text-sf-accent' : 'text-sf-muted'}`} href="?surface=offer">{t('offers')}</a></nav>{offer ? <OfferEditor key={query.product ?? 'choose'} initialProductId={query.product} /> : <StorefrontEditor initial={initial} />}</div>;
}
