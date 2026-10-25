'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { api, isExpectedApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/Modal';

interface WebhookSecretRotationProps {
  endpointId: string;
  secret: string;
  onRotated: () => void;
}

export default function WebhookSecretRotation({ endpointId, secret, onRotated }: WebhookSecretRotationProps) {
  const t = useTranslations('admin.webhooks');
  const [displaySecret, setDisplaySecret] = useState(secret);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [rotated, setRotated] = useState(false);
  const [visible, setVisible] = useState(false);

  const rotate = async () => {
    setPending(true);
    try {
      const result = await api.postCustom<{ secret: string }>(`webhooks/${endpointId}/rotate-secret`);
      setDisplaySecret(result.secret);
      setVisible(true);
      setRotated(true);
      setConfirming(false);
      onRotated();
    } catch (err) {
      if (isExpectedApiError(err)) return;
      toast.error(t('rotateSecretError'));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-2">
      {displaySecret ? (
        <>
          <input aria-label={t('secret')} type={visible ? 'text' : 'password'} readOnly
            autoComplete="off" value={displaySecret}
            className="w-full px-3 py-2 border-2 border-sf-border-medium bg-sf-deep text-sf-muted font-mono text-sm" />
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setVisible(!visible)}>{visible ? t('hide') : t('show')}</Button>
            <Button type="button" variant="secondary" onClick={async () => {
              try {
                await navigator.clipboard.writeText(displaySecret);
                toast.success(t('secretCopied'));
              } catch {
                toast.error(t('copySecretError'));
              }
            }}>{t('copy')}</Button>
          </div>
        </>
      ) : <p className="text-sm text-sf-muted">{t('secretUnavailable')}</p>}
      {rotated && <p role="status" className="text-sm text-sf-warning">{t('rotatedSecretOnce')}</p>}
      {confirming ? (
        <div className="space-y-2">
          <p className="text-sm text-sf-warning">{t('rotateSecretWarning')}</p>
          <Button type="button" variant="danger" disabled={pending} loading={pending} onClick={rotate}>{t('confirmRotateSecret')}</Button>
          <Button type="button" variant="secondary" disabled={pending} onClick={() => setConfirming(false)}>{t('cancelRotateSecret')}</Button>
        </div>
      ) : <Button type="button" variant="danger" onClick={() => setConfirming(true)}>{t('rotateSecret')}</Button>}
    </div>
  );
}
