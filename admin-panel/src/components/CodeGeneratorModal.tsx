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
      return `<script src="${domain}/api/gatekeeper?productSlug=${product.slug}"></script><noscript><meta http-equiv="refresh" content="0;url=${domain}/p/${product.slug}"></noscript>`;
    } else if (options.mode === 'embed') {
      // Embed widget mode - only for free products
      return `<!-- GateFlow Free Product Embed -->
<div data-gateflow-product="${product.slug}"></div>
<script src="${domain}/api/gateflow-embed"></script>

<!-- Optional: Listen for success events -->
<!--
<script>
  document.addEventListener('gateflow:success', function(e) {
    console.log('Claimed:', e.detail.productSlug, 'Email:', e.detail.email);
    // Reload page to show protected content
    location.reload();
  });
</script>
-->`;
    } else {
      return `<!-- Add this to your page head -->
<script src="${domain}/api/gatekeeper"></script><noscript><meta http-equiv="refresh" content="0;url=${domain}/p/${product.slug}"></noscript>

<!-- Then mark elements you want to protect -->
<div data-gatekeeper-product="${product.slug}">
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
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
          {t('title')}
        </h2>
        
        <div className="space-y-6">
          {/* Product Info */}
          <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">{t('product')}: {product.name}</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">{t('slug')}: {product.slug}</p>
          </div>

          {/* Options */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('protectionMode')}
              </label>
              <div className={`grid gap-4 ${product.price === 0 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                <button
                  onClick={() => setOptions({...options, mode: 'page'})}
                  className={`p-3 rounded-lg border text-left ${
                    options.mode === 'page'
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                >
                  <div className="font-medium">🌐 {t('pageMode')}</div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    {t('pageDescription')}
                  </div>
                </button>
                <button
                  onClick={() => setOptions({...options, mode: 'element'})}
                  className={`p-3 rounded-lg border text-left ${
                    options.mode === 'element'
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                >
                  <div className="font-medium">🎯 {t('elementMode')}</div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    {t('elementDescription')}
                  </div>
                </button>
                {product.price === 0 && (
                  <button
                    onClick={() => setOptions({...options, mode: 'embed'})}
                    className={`p-3 rounded-lg border text-left ${
                      options.mode === 'embed'
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <div className="font-medium">🎁 {t('embedMode')}</div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">
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
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('generatedCode')}
              </label>
              <button
                onClick={handleCopy}
                className={`px-3 py-1 text-sm rounded-lg transition ${
                  copiedCode === generatedCode
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400'
                    : 'bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-900/40'
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
          <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
            <h4 className="font-semibold text-blue-900 dark:text-blue-300 mb-2">
              📋 {t('instructions')}
            </h4>
            <div className="text-sm text-blue-800 dark:text-blue-400 space-y-1">
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
          <div className="bg-amber-50 dark:bg-amber-900/20 p-4 rounded-lg">
            <h4 className="font-semibold text-amber-900 dark:text-amber-300 mb-2">
              ℹ️ {t('importantInfo')}
            </h4>
            <div className="text-sm text-amber-800 dark:text-amber-400 space-y-2">
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
            className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition"
          >
            {t('close')}
          </button>
          <button
            onClick={handleCopy}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition"
          >
            {t('copyCode')}
          </button>
        </div>
      </div>
    </BaseModal>
  );
}
