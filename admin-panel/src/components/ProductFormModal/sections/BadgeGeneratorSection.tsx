'use client';

import React, { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { ProductFormData } from '../types';
import { useConfig } from '@/components/providers/config-provider';
import { BADGE_PRESETS, type BadgePreset } from '@/lib/checkout-templates/badge-presets';
import { generateBadgeHtml } from '@/lib/checkout-templates/generate-badge-html';

interface BadgeGeneratorSectionProps {
  formData: ProductFormData;
}

// Phase 6.5 — admin-side embed snippet generator. Renders ONLY when the
// selected checkout template is `tip-jar`. Zero DB writes; UTM params and
// preset selection live in component state only. Output is plain HTML +
// inline CSS — verified by unit tests in tests/unit/checkout-templates/.
export default function BadgeGeneratorSection({ formData }: BadgeGeneratorSectionProps) {
  const t = useTranslations('productForm.badgeGenerator');
  const { siteUrl } = useConfig();

  const [presetSlug, setPresetSlug] = useState<BadgePreset['slug']>('classic-yellow');
  const [utm, setUtm] = useState({
    source: 'sellf-badge',
    medium: 'website',
    campaign: 'tip-jar',
    content: '',
  });
  const [copied, setCopied] = useState(false);

  const html = useMemo(() => {
    if (!formData.slug || !siteUrl) return '';
    try {
      return generateBadgeHtml({
        presetSlug,
        siteUrl,
        productSlug: formData.slug,
        productName: formData.name || formData.slug,
        productIcon: formData.icon,
        utm: {
          source: utm.source || undefined,
          medium: utm.medium || undefined,
          campaign: utm.campaign || undefined,
          content: utm.content || undefined,
        },
      });
    } catch {
      return '';
    }
  }, [formData.slug, formData.name, formData.icon, siteUrl, presetSlug, utm]);

  if (formData.checkout_template !== 'tip-jar') return null;
  if (!formData.slug) {
    return (
      <section className="bg-sf-raised border border-sf-border rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-sf-heading mb-1">{t('label')}</h3>
        <p className="text-xs text-sf-muted">{t('saveFirst')}</p>
      </section>
    );
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(html);
      setCopied(true);
      toast.success(t('copiedToast'));
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('[BadgeGeneratorSection] clipboard error:', err);
    }
  };

  return (
    <section className="bg-sf-raised border border-sf-border rounded-2xl p-5 space-y-4">
      <header className="space-y-1">
        <h3 className="text-sm font-semibold text-sf-heading">{t('label')}</h3>
        <p className="text-xs text-sf-muted">{t('helpText')}</p>
      </header>

      <div>
        <label className="block text-xs font-medium text-sf-body mb-2">{t('presetLabel')}</label>
        <div className="flex flex-wrap gap-2">
          {BADGE_PRESETS.map((p) => (
            <button
              key={p.slug}
              type="button"
              onClick={() => setPresetSlug(p.slug)}
              className={`px-3 py-1.5 text-xs rounded-full border ${
                p.slug === presetSlug
                  ? 'bg-sf-accent-bg text-white border-sf-accent'
                  : 'bg-sf-base text-sf-body border-sf-border hover:border-sf-accent/50'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <input
          aria-label={t('utmSource')}
          placeholder={t('utmSource')}
          value={utm.source}
          onChange={(e) => setUtm((u) => ({ ...u, source: e.target.value }))}
          className="p-2 text-sm border border-sf-border rounded bg-sf-input text-sf-heading"
        />
        <input
          aria-label={t('utmMedium')}
          placeholder={t('utmMedium')}
          value={utm.medium}
          onChange={(e) => setUtm((u) => ({ ...u, medium: e.target.value }))}
          className="p-2 text-sm border border-sf-border rounded bg-sf-input text-sf-heading"
        />
        <input
          aria-label={t('utmCampaign')}
          placeholder={t('utmCampaign')}
          value={utm.campaign}
          onChange={(e) => setUtm((u) => ({ ...u, campaign: e.target.value }))}
          className="p-2 text-sm border border-sf-border rounded bg-sf-input text-sf-heading"
        />
        <input
          aria-label={t('utmContent')}
          placeholder={t('utmContent')}
          value={utm.content}
          onChange={(e) => setUtm((u) => ({ ...u, content: e.target.value }))}
          className="p-2 text-sm border border-sf-border rounded bg-sf-input text-sf-heading"
        />
      </div>

      <div>
        <p className="text-xs text-sf-muted mb-2">{t('previewLabel')}</p>
        <div
          className="p-4 bg-sf-base border border-sf-border rounded-lg"
          // Admin-only UI rendering admin-author content — escaped by
          // generateBadgeHtml at the source. Reviewed unit-test side.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>

      <div>
        <textarea
          readOnly
          rows={4}
          value={html}
          className="w-full p-2 text-xs font-mono border border-sf-border rounded bg-sf-input text-sf-heading"
        />
      </div>

      <button
        type="button"
        onClick={handleCopy}
        className="px-4 py-2 text-sm font-semibold bg-sf-accent-bg hover:bg-sf-accent-hover text-white rounded-full"
      >
        {copied ? t('copiedToast') : t('copyButton')}
      </button>
    </section>
  );
}
