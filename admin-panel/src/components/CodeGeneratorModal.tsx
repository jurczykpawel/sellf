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
      return `<!-- Sellf Free Product Embed -->
<div data-sellf-embed data-product-slug="${product.slug}" data-sellf-mode="free"></div>
<script src="${domain}/embed/v1/checkout.js"></script>`;
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
        <h2 className="text-2xl font-bold text-sf-heading mb-6">
          {t('title')}
        </h2>
        
        <div className="space-y-6">
          {/* Product Info */}
          <div className="bg-sf-raised p-4">
            <h3 className="font-semibold text-sf-heading mb-2">{t('product')}: {product.name}</h3>
            <p className="text-sm text-sf-body">{t('slug')}: {product.slug}</p>
          </div>

          {/* Options */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-sf-body mb-2">
                {t('protectionMode')}
              </label>
              <div className={`grid gap-4 ${product.price === 0 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                <button
                  onClick={() => setOptions({...options, mode: 'page'})}
                  className={`p-3 border text-left ${
                    options.mode === 'page'
                      ? 'border-sf-accent bg-sf-accent-soft text-sf-accent'
                      : 'border-sf-border hover:border-sf-accent/50'
                  }`}
                >
                  <div className="font-medium">🌐 {t('pageMode')}</div>
                  <div className="text-sm text-sf-body">
                    {t('pageDescription')}
                  </div>
                </button>
                <button
                  onClick={() => setOptions({...options, mode: 'element'})}
                  className={`p-3 border text-left ${
                    options.mode === 'element'
                      ? 'border-sf-accent bg-sf-accent-soft text-sf-accent'
                      : 'border-sf-border hover:border-sf-accent/50'
                  }`}
                >
                  <div className="font-medium">🎯 {t('elementMode')}</div>
                  <div className="text-sm text-sf-body">
                    {t('elementDescription')}
                  </div>
                </button>
                {product.price === 0 && (
                  <button
                    onClick={() => setOptions({...options, mode: 'embed'})}
                    className={`p-3 border text-left ${
                      options.mode === 'embed'
                        ? 'border-sf-accent bg-sf-accent-soft text-sf-accent'
                        : 'border-sf-border hover:border-sf-accent/50'
                    }`}
                  >
                    <div className="font-medium">🎁 {t('embedMode')}</div>
                    <div className="text-sm text-sf-body">
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
              <label className="block text-sm font-medium text-sf-body">
                {t('generatedCode')}
              </label>
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

          {/* Instructions */}
          <div className="bg-sf-accent-soft p-4">
            <h4 className="font-semibold text-sf-accent mb-2">
              📋 {t('instructions')}
            </h4>
            <div className="text-sm text-sf-accent space-y-1">
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
          <div className="bg-sf-warning-soft p-4">
            <h4 className="font-semibold text-sf-warning mb-2">
              ℹ️ {t('importantInfo')}
            </h4>
            <div className="text-sm text-sf-warning space-y-2">
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
            className="px-4 py-2 text-sf-body hover:bg-sf-hover transition"
          >
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
