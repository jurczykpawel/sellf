'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { BaseModal, ModalHeader, ModalBody, ModalFooter, Button } from '../ui/Modal';

interface WebhookBatchConfirmModalProps {
  isOpen: boolean;
  variant: 'replay' | 'cancel';
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

  const title = variant === 'replay' ? t('batchReplay') : t('batchCancel');
  const body =
    variant === 'replay'
      ? t('batchReplayConfirm', { count })
      : t('batchCancelConfirm', { count });
  const confirmLabel = variant === 'replay' ? t('replay') : t('cancel');
  const confirmVariant = variant === 'replay' ? 'primary' : 'danger';

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
