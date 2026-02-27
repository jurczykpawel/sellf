'use client';

import React, { useState, useEffect } from 'react';
import { WebhookEndpoint } from '@/types/webhooks';
import { BaseModal, ModalHeader, ModalBody, ModalFooter, Button } from '../ui/Modal';
import { useTranslations } from 'next-intl';
import { WEBHOOK_MOCK_PAYLOADS } from '@/lib/webhooks/mock-payloads';

interface WebhookTestModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTest: (eventType: string) => Promise<void>;
  endpoint: WebhookEndpoint | null;
  isSending: boolean;
}

export default function WebhookTestModal({
  isOpen,
  onClose,
  onTest,
  endpoint,
  isSending
}: WebhookTestModalProps) {
  const t = useTranslations('admin.webhooks');
  const tCommon = useTranslations('common');
  const [selectedEvent, setSelectedEvent] = useState<string>('');

  useEffect(() => {
    if (endpoint) {
      setSelectedEvent(endpoint.events[0] || 'test.event');
    }
  }, [endpoint, isOpen]);

  const getEventLabel = (eventValue: string) => {
    if (eventValue === 'test.event') return t('testModal.genericTestEvent');
    const key = eventValue.replace('.', '_');
    try {
      return t(`events_list.${key}`);
    } catch {
      return eventValue;
    }
  };

  if (!endpoint) return null;

  const currentPayload = WEBHOOK_MOCK_PAYLOADS[selectedEvent] || WEBHOOK_MOCK_PAYLOADS['test.event'];

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} size="lg">
      <ModalHeader title={t('test')} />
      <ModalBody>
        <div className="space-y-4">
          <p className="text-gray-600 dark:text-gray-400 text-sm">
            {t('testModal.selectInstruction')}
            <br />
            <span className="font-mono text-xs mt-1 block p-2 bg-gray-100 dark:bg-gray-900 rounded">
              {endpoint.url}
            </span>
          </p>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t('testModal.eventTypeLabel')}
            </label>
            <select
              value={selectedEvent}
              onChange={(e) => setSelectedEvent(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
            >
              <option value="test.event">{t('testModal.genericTestEvent')}</option>
              {endpoint.events.map((ev) => (
                <option key={ev} value={ev}>
                  {getEventLabel(ev)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t('testModal.examplePayload')}
            </label>
            <div className="bg-gray-900 dark:bg-gray-950 rounded-lg p-4 border border-gray-700 max-h-96 overflow-y-auto">
              <pre className="text-xs font-mono text-gray-100">
                <code>{JSON.stringify({
                  event: selectedEvent,
                  timestamp: new Date().toISOString(),
                  data: currentPayload
                }, null, 2)}</code>
              </pre>
            </div>
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button onClick={onClose} variant="secondary">
          {tCommon('cancel')}
        </Button>
        <Button onClick={() => onTest(selectedEvent)} loading={isSending} variant="primary">
          {t('testModal.sendTest')}
        </Button>
      </ModalFooter>
    </BaseModal>
  );
}
