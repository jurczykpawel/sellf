'use client';

/**
 * Content protection snippet generator.
 *
 * Generates a sellf.js loader snippet that locks/unlocks DOM on the
 * seller's own page based on whether the visitor has product access.
 * Two flavors:
 *   - 'page': protects the entire page (replaces body on no access)
 *   - 'element': protects elements marked with data-sellf-product
 *
 * NOT to be confused with the embed checkout snippet (see EmbedSnippetModal).
 * Embed renders a buy/get-access form on a third-party page; this renders
 * gated content on the seller's own page.
 */
import { useState } from 'react';
import BaseModal from './ui/BaseModal';
import { Product } from '@/types';
import { useTranslations } from 'next-intl';

interface ProtectionCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: Product;
}

type ProtectionMode = 'page' | 'element';

export default function ProtectionCodeModal({ isOpen, onClose, product }: ProtectionCodeModalProps) {
  const t = useTranslations('protectionCode');
  const [mode, setMode] = useState<ProtectionMode>('page');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const generateCode = () => {
    const domain = window.location.origin;

    if (mode === 'page') {
      return `<script src="${domain}/api/sellf?productSlug=${product.slug}"></script><noscript><meta http-equiv="refresh" content="0;url=${domain}/p/${product.slug}"></noscript>`;
    }
    return `<!-- Add this to your page head -->
<script src="${domain}/api/sellf"></script><noscript><meta http-equiv="refresh" content="0;url=${domain}/p/${product.slug}"></noscript>

<!-- Then mark elements you want to protect -->
<div data-sellf-product="${product.slug}">
  <h2>Protected Content</h2>
  <p>This content is only visible to users with access to ${product.name}.</p>

  <!-- Fallback content for users without access -->
  <div data-no-access>
    <h2>🔒 Premium Content</h2>
    <p>This content requires access to ${product.name}.</p>
    <a href="${domain}/p/${product.slug}" class="upgrade-button">
      Get Access Now
    </a>
  </div>
</div>`;
  };

  const handleCopy = async () => {
    const code = generateCode();
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2000);
    } catch {
      // ignored
    }
  };

  const generatedCode = generateCode();

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} size="lg" closeOnBackdropClick={false}>
      <div className="p-6">
        <h2 className="text-2xl font-bold text-sf-heading mb-1">{t('title')}</h2>
        <p className="text-sm text-sf-muted mb-6">{t('subtitle')}</p>

        <div className="space-y-6">
          <div className="bg-sf-raised p-4">
            <h3 className="font-semibold text-sf-heading mb-2">{t('product')}: {product.name}</h3>
            <p className="text-sm text-sf-body">{t('slug')}: {product.slug}</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-sf-body mb-2">
              {t('protectionMode')}
            </label>
            <div className="grid gap-4 grid-cols-2">
              <button
                onClick={() => setMode('page')}
                className={`p-3 border text-left ${
                  mode === 'page'
                    ? 'border-sf-accent bg-sf-accent-soft text-sf-accent'
                    : 'border-sf-border hover:border-sf-accent/50'
                }`}
              >
                <div className="font-medium">🌐 {t('pageMode')}</div>
                <div className="text-sm text-sf-body">{t('pageDescription')}</div>
              </button>
              <button
                onClick={() => setMode('element')}
                className={`p-3 border text-left ${
                  mode === 'element'
                    ? 'border-sf-accent bg-sf-accent-soft text-sf-accent'
                    : 'border-sf-border hover:border-sf-accent/50'
                }`}
              >
                <div className="font-medium">🎯 {t('elementMode')}</div>
                <div className="text-sm text-sf-body">{t('elementDescription')}</div>
              </button>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-sf-body">{t('generatedCode')}</label>
              <button
                onClick={handleCopy}
                className={`px-3 py-1 text-sm transition ${
                  copiedCode === generatedCode
                    ? 'bg-sf-success-soft text-sf-success'
                    : 'bg-sf-accent-soft text-sf-accent hover:bg-sf-accent-soft/80'
                }`}
              >
                {copiedCode === generatedCode ? t('copied') : t('copyCode')}
              </button>
            </div>
            <pre className="bg-gray-900 text-gray-100 p-4 text-sm whitespace-pre-wrap break-all">
              <code>{generatedCode}</code>
            </pre>
          </div>

          <div className="bg-sf-accent-soft p-4">
            <h4 className="font-semibold text-sf-accent mb-2">📋 {t('instructions')}</h4>
            <div className="text-sm text-sf-accent space-y-1">
              {mode === 'page' ? (
                <>
                  <p dangerouslySetInnerHTML={{ __html: t('pageInstructions.step1') }} />
                  <p dangerouslySetInnerHTML={{ __html: t('pageInstructions.step2') }} />
                  <p dangerouslySetInnerHTML={{ __html: t('pageInstructions.step3') }} />
                </>
              ) : (
                <>
                  <p dangerouslySetInnerHTML={{ __html: t('elementInstructions.step1') }} />
                  <p dangerouslySetInnerHTML={{ __html: t('elementInstructions.step2', { slug: product.slug }) }} />
                  <p dangerouslySetInnerHTML={{ __html: t('elementInstructions.step3') }} />
                  <p dangerouslySetInnerHTML={{ __html: t('elementInstructions.step4') }} />
                </>
              )}
            </div>
          </div>

          <div className="bg-sf-warning-soft p-4">
            <h4 className="font-semibold text-sf-warning mb-2">ℹ️ {t('importantInfo')}</h4>
            <div className="text-sm text-sf-warning space-y-2">
              {mode === 'page' ? (
                <>
                  <p><strong>{t('frontendProtection')}:</strong> {t('frontendProtectionDescription')}</p>
                  <p><strong>{t('useCase')}:</strong> {t('pageModeUseCase')}</p>
                </>
              ) : (
                <>
                  <p><strong>{t('selectiveDisplay')}:</strong> {t('selectiveDisplayDescription')}</p>
                  <p><strong>{t('implementation')}:</strong> {t('implementationDescription', { slug: product.slug })}</p>
                  <p><strong>{t('commonUseCase')}:</strong> {t('elementModeUseCase')}</p>
                </>
              )}
            </div>
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
