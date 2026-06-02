'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import BaseModal from '@/components/ui/BaseModal';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  jwksUrl: string | null;
}

const WEBHOOK_PAYLOAD_EXAMPLE = `{
  "event": "purchase.completed",
  "license": {
    "token": "eyJ2IjoxLCJraWQiOiJhYmNkZWYxMjM0NTY3ODkwIn0.abc...",
    "kid": "abcdef0123456789",
    "jwksUrl": "https://yourdomain.com/api/licenses/jwks?seller=uuid"
  },
  "product": { "id": "...", "slug": "my-product" },
  "customer": { "email": "customer@example.com" }
}`;

const JWKS_EXAMPLE = (jwksUrl: string) =>
  `// event.license.jwksUrl comes straight from the webhook payload.
// Cache the response — the endpoint sets max-age=300.
const res = await fetch('${jwksUrl}');
const { keys } = await res.json();
// keys = [{ kid, alg, pem }, ...]`;

const JWKS_PLACEHOLDER = `// event.license.jwksUrl comes straight from the webhook payload.
// Cache the response — the endpoint sets max-age=300.
const res = await fetch(event.license.jwksUrl);
const { keys } = await res.json();
// keys = [{ kid, alg, pem }, ...]`;

const VERIFY_CODE = `import { createVerify } from 'node:crypto';

// token = event.license.token from the purchase.completed webhook
function verifyLicense(token, publicKeyPem) {
  const dot = token.indexOf('.');
  const payload = token.slice(0, dot);
  const sig = Buffer.from(token.slice(dot + 1), 'base64url');

  const ok = createVerify('SHA256')
    .update(payload)
    .end()
    .verify(publicKeyPem, sig);
  if (!ok) return { valid: false, reason: 'invalid_signature' };

  const claims = JSON.parse(
    Buffer.from(payload, 'base64url').toString()
  );
  if (claims.exp && claims.exp < Math.floor(Date.now() / 1000)) {
    return { valid: false, reason: 'expired' };
  }
  return { valid: true, claims };
}

// claims shape:
// { v, kid, product, email, order, tier, iat, exp }`;

function CodeBlock({ code, label, t }: { code: string; label: string; t: (k: string) => string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-sf-muted">{label}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 text-xs text-sf-accent hover:underline"
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copied ? t('copiedCode') : t('copyCode')}
        </button>
      </div>
      <pre className="bg-gray-900 text-gray-100 p-4 text-xs overflow-x-auto whitespace-pre">{code}</pre>
    </div>
  );
}

export default function LicenseHowToUseModal({ isOpen, onClose, jwksUrl }: Props) {
  const t = useTranslations('settings.licenseKeys.modal');

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} size="xl">
      <div className="flex flex-col h-full">

        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-sf-border flex-shrink-0">
          <h2 className="text-xl font-bold text-sf-heading pr-8">{t('title')}</h2>
          <p className="text-sm text-sf-muted mt-1">{t('subtitle')}</p>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-8">

          {/* How it works */}
          <section className="space-y-2">
            <h3 className="font-semibold text-sf-heading border-l-4 border-sf-accent pl-3">
              {t('flowTitle')}
            </h3>
            <p className="text-sm text-sf-body">{t('flowText')}</p>
          </section>

          {/* Setup */}
          <section className="space-y-4">
            <h3 className="font-semibold text-sf-heading border-l-4 border-sf-accent pl-3">
              {t('setupTitle')}
            </h3>
            <div className="space-y-3">
              <div className="bg-sf-raised p-4">
                <p className="font-medium text-sf-heading text-sm mb-1">{t('step1Title')}</p>
                <p className="text-sm text-sf-body">{t('step1Body')}</p>
                <div className="mt-3">
                  <p className="text-xs text-sf-muted mb-1">Wygeneruj własny klucz (terminal):</p>
                  <pre className="bg-gray-900 text-gray-100 p-3 text-xs overflow-x-auto whitespace-pre">{`openssl ecparam -name prime256v1 -genkey -noout \\\n  | openssl pkcs8 -topk8 -nocrypt`}</pre>
                </div>
              </div>
              <div className="bg-sf-raised p-4">
                <p className="font-medium text-sf-heading text-sm mb-1">{t('step2Title')}</p>
                <p className="text-sm text-sf-body">{t('step2Body')}</p>
              </div>
            </div>
          </section>

          {/* Delivery */}
          <section className="space-y-3">
            <h3 className="font-semibold text-sf-heading border-l-4 border-sf-accent pl-3">
              {t('deliveryTitle')}
            </h3>
            <p className="text-sm text-sf-body">{t('deliveryBody')}</p>
            <div className="bg-sf-info-soft border border-sf-info/20 p-3 text-xs text-sf-info">
              {t('deliverySetup')}
            </div>
            <CodeBlock
              code={WEBHOOK_PAYLOAD_EXAMPLE}
              label={t('deliveryPayloadLabel')}
              t={t}
            />
          </section>

          {/* Verification */}
          <section className="space-y-4">
            <h3 className="font-semibold text-sf-heading border-l-4 border-sf-accent pl-3">
              {t('verifyTitle')}
            </h3>
            <p className="text-sm text-sf-body">{t('verifyBody')}</p>

            <div className="space-y-1">
              <p className="font-medium text-sf-heading text-sm">{t('verifyKidTitle')}</p>
              <p className="text-sm text-sf-body">{t('verifyKidBody')}</p>
            </div>

            <CodeBlock
              code={jwksUrl ? JWKS_EXAMPLE(jwksUrl) : JWKS_PLACEHOLDER}
              label={t('verifyJwksLabel')}
              t={t}
            />

            <CodeBlock
              code={VERIFY_CODE}
              label={t('verifyCodeLabel')}
              t={t}
            />
          </section>

          {/* Key rotation */}
          <section className="space-y-3">
            <h3 className="font-semibold text-sf-heading border-l-4 border-sf-warning pl-3">
              {t('rotationTitle')}
            </h3>
            <p className="text-sm text-sf-body">{t('rotationBody')}</p>
            <div className="bg-sf-warning-soft border border-sf-warning/20 p-3 text-xs text-sf-warning">
              {t('rotationFix')}
            </div>
          </section>

        </div>

        {/* Footer */}
        <div className="flex justify-end px-6 py-4 border-t border-sf-border flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2 border-2 border-sf-border-medium text-sf-heading font-medium hover:bg-sf-hover transition-all"
          >
            {t('close')}
          </button>
        </div>

      </div>
    </BaseModal>
  );
}
