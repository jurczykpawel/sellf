'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { WebhookEndpoint } from '@/types/webhooks';
import { useTranslations } from 'next-intl';
import { useWebhooks } from '@/hooks/useWebhooks';
import { useToast } from '@/contexts/ToastContext';
import { createClient } from '@/lib/supabase/client';
import { BaseModal, ModalHeader, ModalBody, ModalFooter, Button } from './ui/Modal';

// Sub-components
import WebhookListTable from './webhooks/WebhookListTable';
import WebhookFormModal from './webhooks/WebhookFormModal';
import WebhookTestModal from './webhooks/WebhookTestModal';
import WebhookDeleteModal from './webhooks/WebhookDeleteModal';
import WebhookLogsDrawer from './WebhookLogsDrawer';
import WebhookFailuresPanel from './WebhookFailuresPanel';

export default function WebhooksPageContent() {
  const t = useTranslations('admin.webhooks');
  const tCommon = useTranslations('common');
  const { addToast } = useToast();
  const {
    endpoints,
    loading,
    submitting,
    fetchEndpoints,
    createEndpoint,
    updateEndpoint,
    deleteEndpoint,
    testEndpoint
  } = useWebhooks();

  // UI States
  const [showFormModal, setShowFormModal] = useState(false);
  const [showTestModal, setShowTestModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  
  const [activeEndpoint, setActiveEndpoint] = useState<WebhookEndpoint | null>(null);
  const [logsEndpoint, setLogsEndpoint] = useState<WebhookEndpoint | null>(null);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [isTesting, setIsTesting] = useState(false);
  const [deleteWaitlistWarning, setDeleteWaitlistWarning] = useState<{
    isLastWaitlistWebhook: boolean;
    productsCount: number;
  } | undefined>(undefined);
  const [editWaitlistWarning, setEditWaitlistWarning] = useState<{
    show: boolean;
    productsCount: number;
    pendingData: any;
  } | null>(null);

  useEffect(() => {
    fetchEndpoints();
  }, [fetchEndpoints]);

  const triggerGlobalRefresh = () => {
    setRefreshCounter(prev => prev + 1);
    fetchEndpoints();
  };

  // Handlers
  const handleOpenCreate = () => {
    setActiveEndpoint(null);
    setShowFormModal(true);
  };

  const handleOpenEdit = (endpoint: WebhookEndpoint) => {
    setActiveEndpoint(endpoint);
    setShowFormModal(true);
  };

  const handleOpenTest = (endpoint: WebhookEndpoint) => {
    setActiveEndpoint(endpoint);
    setShowTestModal(true);
  };

  const handleOpenDelete = useCallback(async (endpoint: WebhookEndpoint) => {
    setActiveEndpoint(endpoint);

    // Check if this webhook has waitlist.signup event
    const hasWaitlistEvent = endpoint.events.includes('waitlist.signup');

    if (hasWaitlistEvent) {
      // Check if it's the last webhook with this event and if there are products using waitlist
      const otherWaitlistWebhooks = endpoints.filter(
        e => e.id !== endpoint.id && e.events.includes('waitlist.signup') && e.is_active
      );

      if (otherWaitlistWebhooks.length === 0) {
        // This is the last active waitlist webhook - check for products
        try {
          const supabase = await createClient();
          const { data } = await supabase.rpc('check_waitlist_config');
          if (data && data.products_count > 0) {
            setDeleteWaitlistWarning({
              isLastWaitlistWebhook: true,
              productsCount: data.products_count
            });
          } else {
            setDeleteWaitlistWarning(undefined);
          }
        } catch (err) {
          console.error('Failed to check waitlist config:', err);
          setDeleteWaitlistWarning(undefined);
        }
      } else {
        setDeleteWaitlistWarning(undefined);
      }
    } else {
      setDeleteWaitlistWarning(undefined);
    }

    setShowDeleteModal(true);
  }, [endpoints]);

  const onFormSubmit = async (data: any) => {
    // Check if editing and removing waitlist.signup event
    if (activeEndpoint && activeEndpoint.events.includes('waitlist.signup')) {
      const newHasWaitlist = data.events?.includes('waitlist.signup');

      if (!newHasWaitlist) {
        // User is removing waitlist.signup - check if it's the last one
        const otherWaitlistWebhooks = endpoints.filter(
          e => e.id !== activeEndpoint.id && e.events.includes('waitlist.signup') && e.is_active
        );

        if (otherWaitlistWebhooks.length === 0) {
          // This is the last webhook with waitlist.signup - check for products
          try {
            const supabase = await createClient();
            const { data: config } = await supabase.rpc('check_waitlist_config');
            if (config && config.products_count > 0) {
              // Show warning and save pending data
              setEditWaitlistWarning({
                show: true,
                productsCount: config.products_count,
                pendingData: data
              });
              return; // Don't submit yet
            }
          } catch (err) {
            console.error('Failed to check waitlist config:', err);
          }
        }
      }
    }

    // Proceed with normal submit
    const success = activeEndpoint
      ? await updateEndpoint(activeEndpoint.id, data)
      : await createEndpoint(data);

    if (success) {
      setShowFormModal(false);
      triggerGlobalRefresh();
    }
  };

  const onEditWarningConfirm = async () => {
    if (!editWaitlistWarning?.pendingData || !activeEndpoint) return;

    const success = await updateEndpoint(activeEndpoint.id, editWaitlistWarning.pendingData);
    if (success) {
      setEditWaitlistWarning(null);
      setShowFormModal(false);
      triggerGlobalRefresh();
    }
  };

  const onEditWarningCancel = () => {
    setEditWaitlistWarning(null);
  };

  const onDeleteConfirm = async () => {
    if (!activeEndpoint) return;
    const success = await deleteEndpoint(activeEndpoint.id);
    if (success) {
      setShowDeleteModal(false);
      triggerGlobalRefresh();
    }
  };

  const onTestExecute = async (eventType: string) => {
    if (!activeEndpoint) return;
    setIsTesting(true);
    const success = await testEndpoint(activeEndpoint.id, eventType);
    setIsTesting(false);
    if (success) {
      setShowTestModal(false);
      setRefreshCounter(prev => prev + 1);
    }
  };

  const handleToggleStatus = async (endpointId: string, currentStatus: boolean) => {
    const newStatus = !currentStatus;

    try {
      const res = await fetch(`/api/v1/webhooks/${endpointId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: newStatus })
      });

      if (!res.ok) throw new Error('Failed');

      addToast(
        newStatus ? t('statusActivated') : t('statusDeactivated'),
        'success'
      );
      triggerGlobalRefresh();
    } catch {
      addToast(t('statusToggleError'), 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gf-heading">{t('title')}</h1>
          <p className="text-sm text-gray-500 mt-1">{t('pageDescription')}</p>
        </div>
        <button
          onClick={handleOpenCreate}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm"
        >
          {t('addEndpoint')}
        </button>
      </div>

      <WebhookFailuresPanel refreshTrigger={refreshCounter} onRefresh={triggerGlobalRefresh} />

      {loading && endpoints.length === 0 ? (
        <div className="flex justify-center items-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        </div>
      ) : endpoints.length === 0 ? (
        <div className="bg-gf-base rounded-xl p-12 text-center border border-dashed border-gf-border">
          <div className="mx-auto w-12 h-12 bg-gf-raised rounded-full flex items-center justify-center mb-4">
            <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <p className="text-gf-muted">{t('noEndpoints')}</p>
          <button onClick={handleOpenCreate} className="mt-4 text-blue-600 hover:text-blue-500 font-medium">
            {t('addEndpoint')}
          </button>
        </div>
      ) : (
        <WebhookListTable
          endpoints={endpoints}
          onEdit={handleOpenEdit}
          onDelete={handleOpenDelete}
          onTest={handleOpenTest}
          onLogs={setLogsEndpoint}
          onToggleStatus={handleToggleStatus}
        />
      )}

      {/* Modals */}
      <WebhookFormModal
        isOpen={showFormModal}
        onClose={() => setShowFormModal(false)}
        onSubmit={onFormSubmit}
        editingEndpoint={activeEndpoint}
        isSubmitting={submitting}
      />

      <WebhookTestModal
        isOpen={showTestModal}
        onClose={() => setShowTestModal(false)}
        onTest={onTestExecute}
        endpoint={activeEndpoint}
        isSending={isTesting}
      />

      <WebhookDeleteModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={onDeleteConfirm}
        endpoint={activeEndpoint}
        waitlistWarning={deleteWaitlistWarning}
      />

      {/* Edit Waitlist Warning Modal */}
      {editWaitlistWarning?.show && (
        <BaseModal isOpen={true} onClose={onEditWarningCancel} size="md">
          <ModalHeader title={t('waitlistWarning.editTitle')} />
          <ModalBody>
            <div data-testid="waitlist-webhook-warning" className="p-4 bg-gf-warning-soft border border-gf-warning/20 rounded-lg">
              <div className="flex items-start gap-3">
                <span className="text-xl">⚠️</span>
                <div>
                  <p className="font-medium text-gf-warning">
                    {t('waitlistWarning.title')}
                  </p>
                  <p className="text-sm text-gf-warning mt-1">
                    {t('waitlistWarning.editDescription', { count: editWaitlistWarning.productsCount })}
                  </p>
                </div>
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button onClick={onEditWarningCancel} variant="secondary">
              {tCommon('cancel')}
            </Button>
            <Button onClick={onEditWarningConfirm} variant="danger">
              {t('waitlistWarning.confirmEdit')}
            </Button>
          </ModalFooter>
        </BaseModal>
      )}

      {logsEndpoint && (
        <WebhookLogsDrawer
          isOpen={!!logsEndpoint}
          onClose={() => setLogsEndpoint(null)}
          endpoint={logsEndpoint}
          onRefresh={triggerGlobalRefresh}
        />
      )}
    </div>
  );
}