'use client';

/** Navigation for a saved draft. @see StorefrontEditor.tsx */
import { useLocale, useTranslations } from 'next-intl';
import { Eye, History } from 'lucide-react';
import { editorButton } from '@/components/storefront-editor/SlotEditor';

interface DraftActionsProps { revision: number | null; enabled: boolean }
export default function DraftActions({ revision, enabled }: DraftActionsProps) {
  const locale = useLocale();
  const t = useTranslations('storefrontEditor');
  const prefix = locale === 'en' ? '' : `/${locale}`;
  const actions = [
    { label: t('preview'), href: `/template-preview/${revision}?locale=${locale}&fixture=published-products`, icon: Eye, external: true },
    { label: t('historyPublishing'), href: `${prefix}/admin/templates/history`, icon: History, external: false },
  ];
  return <div data-draft-actions className="space-y-3 rounded-xl border border-sf-border bg-sf-base p-4">
    <p className="text-sm leading-relaxed text-sf-muted">{t(enabled ? 'draftActionsHelp' : 'saveBeforePreview')}</p>
    <div className="flex flex-wrap gap-2">{actions.map(({ label, href, icon: Icon, external }) => enabled
      ? <a key={label} aria-label={label} title={external ? `${label}${t('newTab')}` : label} className={`${editorButton} inline-flex items-center gap-2`} href={href} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}><Icon size={17} aria-hidden="true" />{label}{external && <span className="sr-only">{t('newTab')}</span>}</a>
      : <button key={label} type="button" className={`${editorButton} inline-flex items-center gap-2`} disabled><Icon size={17} aria-hidden="true" />{label}</button>)}</div>
  </div>;
}
