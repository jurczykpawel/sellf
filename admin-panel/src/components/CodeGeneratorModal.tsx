'use client';

import { useState } from 'react';
import BaseModal from './ui/BaseModal';
import { Product } from '@/types';
import { useTranslations } from 'next-intl';

interface CodeGeneratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: Product;
}

interface CodeOptions {
  mode: 'page' | 'element' | 'embed';
}

export default function CodeGeneratorModal({ isOpen, onClose, product }: CodeGeneratorModalProps) {
  const t = useTranslations('codeGenerator');
  const [options, setOptions] = useState<CodeOptions>({
    mode: 'page'
  });
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const generateCode = () => {
    const domain = window.location.origin;

    if (options.mode === 'page') {
      return `<script src="${domain}/api/sellf?productSlug=${product.slug}"></script><noscript><meta http-equiv="refresh" content="0;url=${domain}/p/${product.slug}"></noscript>`;
    } else if (options.mode === 'embed') {
      // Embed widget mode - only for free products
      return `<!-- Sellf Free Product Embed -->
<div data-sellf-product="${product.slug}"></div>
<script src="${domain}/api/sellf-embed"></script>

<!-- Optional: Listen for success events -->
<!--
<script>
  document.addEventListener('sellf:success', function(e) {
    console.log('Claimed:', e.detail.productSlug, 'Email:', e.detail.email);
    // Reload page to show protected content
    location.reload();
  });
</script>
-->`;
    } else {
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
    }
  };

  const handleCopy = async () => {
    const code = generateCode();
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2000);
    } catch {
      // Silent error handling
    }
  };

  const generatedCode = generateCode();

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} size="lg" closeOnBackdropClick={false}>
      <div className="p-6">
        <h2 className="text-2xl font-bold text-gf-heading mb-6">
          {t('title')}
        </h2>
        
        <div className="space-y-6">
          {/* Product Info */}
          <div className="bg-gf-raised p-4 rounded-lg">
            <h3 className="font-semibold text-gf-heading mb-2">{t('product')}: {product.name}</h3>
            <p className="text-sm text-gf-body">{t('slug')}: {product.slug}</p>
          </div>

          {/* Options */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gf-body mb-2">
                {t('protectionMode')}
              </label>
              <div className={`grid gap-4 ${product.price === 0 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                <button
                  onClick={() => setOptions({...options, mode: 'page'})}
                  className={`p-3 rounded-lg border text-left ${
                    options.mode === 'page'
                      ? 'border-gf-accent bg-gf-accent-soft text-gf-accent'
                      : 'border-gf-border hover:border-gf-accent/50'
                  }`}
                >
                  <div className="font-medium">🌐 {t('pageMode')}</div>
                  <div className="text-sm text-gf-body">
                    {t('pageDescription')}
                  </div>
                </button>
                <button
                  onClick={() => setOptions({...options, mode: 'element'})}
                  className={`p-3 rounded-lg border text-left ${
                    options.mode === 'element'
                      ? 'border-gf-accent bg-gf-accent-soft text-gf-accent'
                      : 'border-gf-border hover:border-gf-accent/50'
                  }`}
                >
                  <div className="font-medium">🎯 {t('elementMode')}</div>
                  <div className="text-sm text-gf-body">
                    {t('elementDescription')}
                  </div>
                </button>
                {product.price === 0 && (
                  <button
                    onClick={() => setOptions({...options, mode: 'embed'})}
                    className={`p-3 rounded-lg border text-left ${
                      options.mode === 'embed'
                        ? 'border-gf-accent bg-gf-accent-soft text-gf-accent'
                        : 'border-gf-border hover:border-gf-accent/50'
                    }`}
                  >
                    <div className="font-medium">🎁 {t('embedMode')}</div>
                    <div className="text-sm text-gf-body">
                      {t('embedDescription')}
                    </div>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Generated Code */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gf-body">
                {t('generatedCode')}
              </label>
              <button
                onClick={handleCopy}
                className={`px-3 py-1 text-sm rounded-lg transition ${
                  copiedCode === generatedCode
                    ? 'bg-gf-success-soft text-gf-success'
                    : 'bg-gf-accent-soft text-gf-accent hover:bg-gf-accent-soft/80'
                }`}
              >
                {copiedCode === generatedCode ? t('copied') : t('copyCode')}
              </button>
            </div>
            <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg text-sm whitespace-pre-wrap break-all">
              <code>{generatedCode}</code>
            </pre>
          </div>

          {/* Instructions */}
          <div className="bg-gf-accent-soft p-4 rounded-lg">
            <h4 className="font-semibold text-gf-accent mb-2">
              📋 {t('instructions')}
            </h4>
            <div className="text-sm text-gf-accent space-y-1">
              {options.mode === 'page' ? (
                <>
                  <p dangerouslySetInnerHTML={{ __html: t('pageInstructions.step1') }} />
                  <p dangerouslySetInnerHTML={{ __html: t('pageInstructions.step2') }} />
                  <p dangerouslySetInnerHTML={{ __html: t('pageInstructions.step3') }} />
                </>
              ) : options.mode === 'embed' ? (
                <>
                  <p>{t('embedInstructions.step1')}</p>
                  <p>{t('embedInstructions.step2')}</p>
                  <p>{t('embedInstructions.step3')}</p>
                  <p>{t('embedInstructions.step4')}</p>
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

          {/* Additional Information */}
          <div className="bg-gf-warning-soft p-4 rounded-lg">
            <h4 className="font-semibold text-gf-warning mb-2">
              ℹ️ {t('importantInfo')}
            </h4>
            <div className="text-sm text-gf-warning space-y-2">
              {options.mode === 'page' ? (
                <>
                  <p>
                    <strong>{t('frontendProtection')}:</strong> {t('frontendProtectionDescription')}
                  </p>
                  <p>
                    <strong>{t('useCase')}:</strong> {t('pageModeUseCase')}
                  </p>
                </>
              ) : options.mode === 'embed' ? (
                <>
                  <p>
                    <strong>🎁 {t('embedInfoFreeOnlyTitle')}:</strong> {t('embedInfoFreeOnly')}
                  </p>
                  <p>
                    <strong>🔒 {t('embedInfoSecurityTitle')}:</strong> {t('embedInfoSecurity')}
                  </p>
                  <p>
                    <strong>🎨 {t('embedInfoCustomizableTitle')}:</strong> {t('embedInfoCustomizable')}
                  </p>
                  <p>
                    <strong>✉️ {t('embedInfoMagicLinkTitle')}:</strong> {t('embedInfoMagicLink')}
                  </p>
                </>
              ) : (
                <>
                  <p>
                    <strong>{t('selectiveDisplay')}:</strong> {t('selectiveDisplayDescription')}
                  </p>
                  <p>
                    <strong>{t('implementation')}:</strong> {t('implementationDescription', { slug: product.slug })}
                  </p>
                  <p>
                    <strong>{t('commonUseCase')}:</strong> {t('elementModeUseCase')}
                  </p>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end space-x-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gf-body hover:bg-gf-hover rounded-lg transition"
          >
            {t('close')}
          </button>
          <button
            onClick={handleCopy}
            className="px-4 py-2 bg-gf-accent text-gf-inverse rounded-lg hover:bg-gf-accent-hover transition"
          >
            {t('copyCode')}
          </button>
        </div>
      </div>
    </BaseModal>
  );
}
