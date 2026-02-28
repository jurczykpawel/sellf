'use client';

import React from 'react';
import { WebhookEndpoint } from '@/types/webhooks';
import { BaseModal, ModalHeader, ModalBody, ModalFooter, Button } from '../ui/Modal';
import { useTranslations } from 'next-intl';

interface WebhookDeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  endpoint: WebhookEndpoint | null;
  waitlistWarning?: {
    isLastWaitlistWebhook: boolean;
    productsCount: number;
  };
}

export default function WebhookDeleteModal({
  isOpen,
  onClose,
  onConfirm,
  endpoint,
  waitlistWarning
}: WebhookDeleteModalProps) {
  const t = useTranslations('admin.webhooks');
  const tCommon = useTranslations('common');

  if (!endpoint) return null;

  const showWaitlistWarning = waitlistWarning?.isLastWaitlistWebhook && waitlistWarning.productsCount > 0;

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} size="md">
      <ModalHeader title={t('deleteTitle')} />
      <ModalBody>
        <p className="text-gf-body">
          {t('deleteConfirm')} <br />
          <span className="font-mono text-xs mt-2 block p-2 bg-gf-raised rounded">
            {endpoint.url}
          </span>
        </p>

        {showWaitlistWarning && (
          <div data-testid="waitlist-webhook-warning" className="mt-4 p-4 bg-gf-warning-soft border border-gf-warning/20 rounded-lg">
            <div className="flex items-start gap-3">
              <span className="text-xl">⚠️</span>
              <div>
                <p className="font-medium text-gf-warning">
                  {t('waitlistWarning.title')}
                </p>
                <p className="text-sm text-gf-warning mt-1">
                  {t('waitlistWarning.description', { count: waitlistWarning.productsCount })}
                </p>
              </div>
            </div>
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <Button onClick={onClose} variant="secondary">
          {tCommon('cancel')}
        </Button>
        <Button onClick={onConfirm} variant="danger">
          {tCommon('delete')}
        </Button>
      </ModalFooter>
    </BaseModal>
  );
}
