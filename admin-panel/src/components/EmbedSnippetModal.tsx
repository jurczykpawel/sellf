'use client';

/**
 * Embed checkout snippet generator.
 *
 * Generates a 2-line HTML snippet the seller pastes onto a third-party page.
 * The SDK at /embed/v1/checkout.js auto-detects paid vs free from the
 * product (no data-sellf-mode needed). Free products render an email-gate
 * form with Turnstile; paid render Stripe Embedded Checkout.
 *
 * NOT to be confused with the content protection snippet (ProtectionCodeModal),
 * which gates DOM on the seller's own page.
 */
import { useState } from 'react';
import BaseModal from './ui/BaseModal';
import { Product } from '@/types';
import { useTranslations } from 'next-intl';

interface EmbedSnippetModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: Product;
}

export default function EmbedSnippetModal({ isOpen, onClose, product }: EmbedSnippetModalProps) {
  const t = useTranslations('embedSnippet');
  const [copied, setCopied] = useState(false);

  const isPaid = product.price > 0;
  const enabled = product.embed_enabled === true;

  const generateSnippet = () => {
    const domain = window.location.origin;
    return `<div data-sellf-embed data-product-slug="${product.slug}"></div>
<script src="${domain}/embed/v1/checkout.js"></script>`;
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(generateSnippet());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignored
    }
  };

  const snippet = generateSnippet();

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} size="lg" closeOnBackdropClick={false}>
      <div className="p-6">
        <h2 className="text-2xl font-bold text-sf-heading mb-1">{t('title')}</h2>
        <p className="text-sm text-sf-muted mb-6">{t('subtitle')}</p>

        <div className="space-y-6">
          <div className="bg-sf-raised p-4 flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-sf-heading">{product.name}</h3>
              <p className="text-sm text-sf-body">{t('slug')}: {product.slug}</p>
            </div>
            <span className={`px-3 py-1 text-xs font-medium rounded ${
              isPaid
                ? 'bg-sf-accent-soft text-sf-accent'
                : 'bg-sf-success-soft text-sf-success'
            }`}>
              {isPaid ? t('paidBadge') : t('freeBadge')}
            </span>
          </div>

          {!enabled && (
            <div className="bg-sf-warning-soft border border-sf-warning/30 p-4 rounded">
              <div className="flex items-start gap-3">
                <svg className="h-5 w-5 text-sf-warning flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <div className="text-sm text-sf-warning">
                  <p className="font-medium">{t('disabledTitle')}</p>
                  <p className="mt-1">{t('disabledBody')}</p>
                </div>
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-sf-body">{t('snippetLabel')}</label>
              <button
                onClick={handleCopy}
                className={`px-3 py-1 text-sm transition ${
                  copied
                    ? 'bg-sf-success-soft text-sf-success'
                    : 'bg-sf-accent-soft text-sf-accent hover:bg-sf-accent-soft/80'
                }`}
              >
                {copied ? t('copied') : t('copyCode')}
              </button>
            </div>
            <pre className="bg-gray-900 text-gray-100 p-4 text-sm whitespace-pre-wrap break-all">
              <code>{snippet}</code>
            </pre>
          </div>

          <div className="bg-sf-accent-soft p-4">
            <h4 className="font-semibold text-sf-accent mb-2">📋 {t('instructions')}</h4>
            <ol className="text-sm text-sf-accent space-y-1 list-decimal list-inside">
              <li>{t('step1')}</li>
              <li>{t('step2')}</li>
              <li>{t('step3')}</li>
            </ol>
          </div>

          <div className="bg-sf-info-soft p-4">
            <h4 className="font-semibold text-sf-info mb-2">
              {isPaid ? `💳 ${t('paidInfoTitle')}` : `🎁 ${t('freeInfoTitle')}`}
            </h4>
            <p className="text-sm text-sf-info">
              {isPaid ? t('paidInfoBody') : t('freeInfoBody')}
            </p>
          </div>

          <div className="bg-sf-warning-soft p-4">
            <h4 className="font-semibold text-sf-warning mb-2">🔒 {t('originsTitle')}</h4>
            <p className="text-sm text-sf-warning">{t('originsBody')}</p>
          </div>
        </div>

        <div className="flex justify-end space-x-3 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sf-body hover:bg-sf-hover transition">
            {t('close')}
          </button>
          <button
            onClick={handleCopy}
            className="px-4 py-2 bg-sf-accent-bg text-white hover:bg-sf-accent-hover transition"
          >
            {t('copyCode')}
          </button>
        </div>
      </div>
    </BaseModal>
  );
}
