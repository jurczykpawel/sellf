'use client';

import { useLocale, useTranslations } from 'next-intl';
import { SLOT_IDS, SLOT_SECTIONS, editorButton } from '@/components/storefront-editor/SlotEditor';
import type { ValidationIssue } from '@/lib/storefront-templates/json';

interface ValidationIssuesProps {
  issues: ValidationIssue[];
  productId?: string;
  blocking?: boolean;
  onSelect?: (section: string) => void;
}
export default function ValidationIssues({ issues, blocking = false, onSelect, productId }: ValidationIssuesProps) {
  const t = useTranslations('storefrontEditor');
  const locale = useLocale();
  const appearance = useTranslations('storefrontAppearance');
  const preview = useTranslations('templatePreview');
  const unique = issues.filter((issue, index) => issues.findIndex(other => other.code === issue.code && other.path === issue.path && other.message === issue.message) === index);
  if (!unique.length) return null;
  return <section role={blocking ? 'alert' : 'region'} aria-label={t('beforePublishing')} className={`space-y-3 rounded-xl border p-4 text-sm ${blocking ? 'border-sf-danger bg-sf-danger-soft' : 'border-sf-border bg-sf-warning-soft'}`}>
    <h2 className="font-semibold">{t('beforePublishing')}</h2>
    {!blocking && <p>{t('incompleteDraft')}</p>}
    <ul className="space-y-3">{unique.map(issue => {
      const slot = SLOT_IDS.find(id => issue.path.includes(id));
      const section = slot ? SLOT_SECTIONS[slot] : issue.path.startsWith('/tokens') || issue.code === 'CONTRAST' ? 'appearance'
        : issue.path.includes('closingProduct') ? 'closing' : issue.path.includes('starterProducts') ? 'start' : issue.path.includes('taskCategories') ? 'tasks' : issue.path.includes('heroProduct') ? 'hero' : null;
      const name = section === 'appearance' ? appearance('title') : section ? t(`sectionNames.${section}`) : t('template');
      const productUnavailable = productId && issue.code === 'BINDING' && issue.path === '/productId';
      const message = productUnavailable ? t('offerUnavailable') : issue.code === 'BINDING' ? t(issue.message === 'Required publication binding is missing' ? 'missingOffer' : 'unavailableBinding') : issue.code === 'CONTRAST' ? appearance('contrastBad') : issue.code === 'ENTITLEMENT' ? preview('FORBIDDEN') : preview('INVALID');
      const action = productUnavailable ? t('productSalesSettings') : t('fixSection', { section: name });
      return <li key={`${issue.code}:${issue.path}:${issue.message}`} className="space-y-2">
        <p><strong>{name}</strong> — {message}</p>
        {productUnavailable ? <a className={editorButton} href={`${locale === 'pl' ? '/pl' : ''}/dashboard/products?open=${encodeURIComponent(productId)}&section=sales`}>{action}</a> : onSelect ? <button type="button" className={editorButton} onClick={() => onSelect(section ?? 'hero')}>{action}</button>
          : <a className={`${editorButton} inline-flex items-center`} href={`${locale === 'pl' ? '/pl' : ''}/dashboard/templates${section ? `#${section}` : ''}`}>{action}</a>}
      </li>;
    })}</ul>
  </section>;
}
