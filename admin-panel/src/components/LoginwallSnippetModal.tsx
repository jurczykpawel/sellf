'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import BaseModal from './ui/BaseModal';
import { Product } from '@/types';
import { buildLoginwallSnippet } from '@/lib/loginwall/snippet';

interface LoginwallSnippetModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: Product;
}

type AllowlistStatus = 'loading' | 'configured' | 'empty' | 'error';

export default function LoginwallSnippetModal({ isOpen, onClose, product }: LoginwallSnippetModalProps) {
  const t = useTranslations('loginwallSnippet');
  const [copied, setCopied] = useState(false);
  const [allowlistStatus, setAllowlistStatus] = useState<AllowlistStatus>('loading');

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const run = async () => {
      setAllowlistStatus('loading');
      try {
        const res = await fetch(
          `/api/admin/embed/allowed-origins?productId=${encodeURIComponent(product.id)}`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { origins: string[] };
        if (cancelled) return;
        setAllowlistStatus(data.origins.length > 0 ? 'configured' : 'empty');
      } catch {
        if (!cancelled) setAllowlistStatus('error');
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [isOpen, product.id]);

  const snippet = (() => {
    const sellfOrigin = typeof window !== 'undefined' ? window.location.origin : '';
    if (!sellfOrigin) return '';
    return buildLoginwallSnippet({ productId: product.id, sellfOrigin });
  })();

  const handleCopy = async () => {
    if (!snippet) return;
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignored
    }
  };

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
          </div>

          {allowlistStatus === 'empty' && (
            <div className="bg-sf-warning-soft border border-sf-warning/30 p-4 rounded">
              <div className="flex items-start gap-3">
                <svg className="h-5 w-5 text-sf-warning flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <div className="text-sm text-sf-warning">
                  <p className="font-medium">{t('emptyAllowlistTitle')}</p>
                  <p className="mt-1">{t('emptyAllowlistBody')}</p>
                </div>
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-sf-body">{t('snippetLabel')}</label>
              <button
                type="button"
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
            <h4 className="font-semibold text-sf-info mb-2">🔒 {t('howItWorksTitle')}</h4>
            <p className="text-sm text-sf-info">{t('howItWorksBody')}</p>
          </div>
        </div>

        <div className="flex justify-end space-x-3 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sf-body hover:bg-sf-hover transition">
            {t('close')}
          </button>
          <button
            type="button"
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
