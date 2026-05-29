'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { KeyRound, Copy, Check } from 'lucide-react';
import {
  getSellerLicenseInfo,
  generateSellerLicenseKey,
  uploadSellerLicenseKey,
  type SellerLicenseInfo,
} from '@/lib/actions/license-config';

export default function LicenseKeysSettings() {
  const t = useTranslations('settings.licenseKeys');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [info, setInfo] = useState<SellerLicenseInfo | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [privateKeyPem, setPrivateKeyPem] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getSellerLicenseInfo();
      if (res.success) setInfo(res.data ?? null);
      else toast.error(t('loadError'));
    } catch {
      toast.error(t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const handleGenerate = async () => {
    setWorking(true);
    try {
      const res = await generateSellerLicenseKey();
      if (res.success) {
        toast.success(t('generateSuccess'));
        await load();
      } else {
        toast.error(res.error || t('actionError'));
      }
    } finally {
      setWorking(false);
    }
  };

  const handleUpload = async () => {
    setWorking(true);
    try {
      const res = await uploadSellerLicenseKey(privateKeyPem);
      if (res.success) {
        toast.success(t('uploadSuccess'));
        setPrivateKeyPem('');
        setShowUpload(false);
        await load();
      } else {
        toast.error(res.error || t('actionError'));
      }
    } finally {
      setWorking(false);
    }
  };

  const copy = async (value: string, field: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(field);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="bg-sf-base border-2 border-sf-border-medium overflow-hidden">
      <div className="bg-sf-accent-soft px-6 py-4 border-b border-sf-border-accent">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-sf-accent-bg flex items-center justify-center">
            <KeyRound className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-sf-heading">{t('title')}</h2>
            <p className="text-sm text-sf-accent">{t('subtitle')}</p>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        <p className="text-sm text-sf-body">{t('description')}</p>

        {loading ? (
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-sf-raised w-1/4" />
            <div className="h-10 bg-sf-raised" />
          </div>
        ) : info ? (
          <div className="p-4 bg-sf-deep border-2 border-sf-border-medium space-y-4">
            <div>
              <span className="block text-xs font-medium text-sf-muted mb-1">{t('kid')}</span>
              <div className="flex items-center gap-2">
                <code className="font-mono text-sm text-sf-heading break-all">{info.kid}</code>
                <CopyButton value={info.kid} field="kid" copied={copied} onCopy={copy} t={t} />
              </div>
            </div>
            <div>
              <span className="block text-xs font-medium text-sf-muted mb-1">{t('jwksUrl')}</span>
              <div className="flex items-center gap-2">
                <code className="font-mono text-xs text-sf-heading break-all">{info.jwksUrl}</code>
                <CopyButton value={info.jwksUrl} field="jwks" copied={copied} onCopy={copy} t={t} />
              </div>
            </div>
            <div>
              <span className="block text-xs font-medium text-sf-muted mb-1">{t('publicKey')}</span>
              <div className="flex items-start gap-2">
                <pre className="font-mono text-xs text-sf-heading bg-sf-input p-3 border border-sf-border-medium overflow-x-auto flex-1 whitespace-pre-wrap break-all">{info.publicKeyPem}</pre>
                <CopyButton value={info.publicKeyPem} field="pub" copied={copied} onCopy={copy} t={t} />
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-sf-muted">{t('noKey')}</p>
        )}

        <div className="bg-sf-warning-soft border border-sf-warning/20 p-3 text-xs text-sf-warning">
          {t('rotateWarning')}
        </div>

        {showUpload && (
          <div>
            <label htmlFor="license-private-key" className="block text-sm font-medium text-sf-body mb-2">
              {t('uploadLabel')}
            </label>
            <textarea
              id="license-private-key"
              rows={6}
              value={privateKeyPem}
              onChange={(e) => setPrivateKeyPem(e.target.value)}
              placeholder={t('uploadPlaceholder')}
              className="w-full border-2 border-sf-border-medium px-4 py-3 bg-sf-input focus:ring-2 focus:ring-sf-accent outline-none font-mono text-xs"
            />
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-3 pt-4 border-t border-sf-border">
          {!showUpload ? (
            <>
              <button
                type="button"
                onClick={() => setShowUpload(true)}
                disabled={working}
                className="px-6 py-2 border-2 border-sf-border-medium text-sf-heading font-medium hover:bg-sf-hover disabled:opacity-50 transition-all"
              >
                {t('upload')}
              </button>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={working}
                className="px-6 py-2 bg-sf-accent-bg hover:bg-sf-accent-hover text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {working ? t('generating') : t('generate')}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => { setShowUpload(false); setPrivateKeyPem(''); }}
                disabled={working}
                className="px-6 py-2 border-2 border-sf-border-medium text-sf-heading font-medium hover:bg-sf-hover disabled:opacity-50 transition-all"
              >
                {t('upload')}
              </button>
              <button
                type="button"
                onClick={handleUpload}
                disabled={working || !privateKeyPem.trim()}
                className="px-6 py-2 bg-sf-accent-bg hover:bg-sf-accent-hover text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {working ? t('uploading') : t('upload')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

type Translator = (key: string) => string;

function CopyButton({
  value, field, copied, onCopy, t,
}: {
  value: string;
  field: string;
  copied: string | null;
  onCopy: (value: string, field: string) => void;
  t: Translator;
}) {
  const isCopied = copied === field;
  return (
    <button
      type="button"
      onClick={() => onCopy(value, field)}
      className="flex-shrink-0 inline-flex items-center gap-1 text-xs text-sf-accent hover:underline"
      aria-label={isCopied ? t('copied') : t('copy')}
    >
      {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      {isCopied ? t('copied') : t('copy')}
    </button>
  );
}
