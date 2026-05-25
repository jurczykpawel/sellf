'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { BaseModal, ModalHeader, ModalBody, ModalFooter, Button } from '../ui/Modal';

type Variant = 'replay' | 'force-retry' | 'cancel';

interface WebhookBatchConfirmModalProps {
  isOpen: boolean;
  variant: Variant;
  count: number;
  onClose: () => void;
  onConfirm: () => void;
  busy?: boolean;
}

export default function WebhookBatchConfirmModal({
  isOpen,
  variant,
  count,
  onClose,
  onConfirm,
  busy = false,
}: WebhookBatchConfirmModalProps) {
  const t = useTranslations('admin.webhooks.logs');
  const tCommon = useTranslations('common');

  const title =
    variant === 'replay' ? t('batchReplay')
      : variant === 'force-retry' ? t('batchForceRetry')
      : t('batchCancel');
  const body =
    variant === 'replay' ? t('batchReplayConfirm', { count })
      : variant === 'force-retry' ? t('batchForceRetryConfirm', { count })
      : t('batchCancelConfirm', { count });
  const confirmLabel =
    variant === 'replay' ? t('replay')
      : variant === 'force-retry' ? t('forceRetry')
      : t('cancel');
  const confirmVariant: 'primary' | 'danger' = variant === 'cancel' ? 'danger' : 'primary';

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} size="md">
      <ModalHeader title={title} />
      <ModalBody>
        <p className="text-sf-body">{body}</p>
      </ModalBody>
      <ModalFooter>
        <Button onClick={onClose} variant="secondary" disabled={busy}>
          {tCommon('cancel')}
        </Button>
        <Button onClick={onConfirm} variant={confirmVariant} disabled={busy}>
          {busy ? '...' : confirmLabel}
        </Button>
      </ModalFooter>
    </BaseModal>
  );
}
