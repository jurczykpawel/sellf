'use client';

import { useState, useEffect } from 'react';
import { Building2, ExternalLink, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { saveGUSAPIKey, getGUSConfig, deleteGUSAPIKey } from '@/lib/actions/gus-config';
import { BaseModal, ModalHeader, ModalBody, ModalFooter, Button } from '@/components/ui/Modal';
import { useToast } from '@/contexts/ToastContext';
import { useTranslations } from 'next-intl';

export default function GUSSettings() {
  const t = useTranslations('settings.gus');
  const tCommon = useTranslations('common');
  const { addToast } = useToast();
  const [apiKey, setApiKey] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const result = await getGUSConfig();
      if (result.success && result.data) {
        setEnabled(result.data.enabled);
        setHasKey(result.data.hasKey);
      }
    } catch (error) {
      console.error('Failed to load GUS config:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const handleSave = async () => {
    if (!apiKey.trim() && !hasKey) {
      addToast(t('errors.apiKeyRequired'), 'error');
      return;
    }

    setSaving(true);

    try {
      const result = await saveGUSAPIKey({
        apiKey: apiKey.trim() || 'KEEP_EXISTING', // If empty and hasKey, keep existing
        enabled,
      });

      if (result.success) {
        addToast(t('messages.saved'), 'success');
        setApiKey('');
        await loadConfig();
      } else {
        addToast(result.error || t('errors.saveFailed'), 'error');
      }
    } catch (error) {
      addToast(t('errors.saveFailed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setShowDeleteModal(false);

    try {
      const result = await deleteGUSAPIKey();

      if (result.success) {
        addToast(t('messages.deleted'), 'success');
        setApiKey('');
        setEnabled(false);
        await loadConfig();
      } else {
        addToast(result.error || t('errors.deleteFailed'), 'error');
      }
    } catch (error) {
      addToast(t('errors.deleteFailed'), 'error');
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-gf-base rounded-xl shadow-sm border border-gf-border p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-gf-raised rounded w-1/4"></div>
          <div className="h-20 bg-gf-raised rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Delete Confirmation Modal */}
      <BaseModal isOpen={showDeleteModal} onClose={() => setShowDeleteModal(false)} size="md">
        <ModalHeader title={t('deleteModal.title')} />
        <ModalBody>
          <p className="text-gf-body">
            {t('deleteModal.description')}
          </p>
        </ModalBody>
        <ModalFooter>
          <Button onClick={() => setShowDeleteModal(false)} variant="secondary">
            {tCommon('cancel')}
          </Button>
          <Button onClick={handleDelete} variant="danger" loading={deleting}>
            {tCommon('delete')}
          </Button>
        </ModalFooter>
      </BaseModal>

      <div className="bg-gf-base rounded-xl shadow-sm border border-gf-border p-6">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold text-gf-heading mb-2">
              {t('title')}
            </h2>
            <p className="text-sm text-gf-body">
              {t('subtitle')}
            </p>
          </div>
          <Building2 className="w-8 h-8 text-gf-accent" />
        </div>

      {/* Status Banner */}
      {hasKey && enabled && (
        <div className="mb-6 bg-gf-success-soft border border-gf-success/20 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-gf-success mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-gf-heading mb-1">
                {t('status.active')}
              </p>
              <p className="text-sm text-gf-body">
                {t('status.activeDescription')}
              </p>
            </div>
          </div>
        </div>
      )}

      {hasKey && !enabled && (
        <div className="mb-6 bg-gf-warning-soft border border-gf-warning/20 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-gf-warning mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-gf-heading mb-1">
                {t('status.disabled')}
              </p>
              <p className="text-sm text-gf-body">
                {t('status.disabledDescription')}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Configuration Form */}
      <div className="space-y-4">
        <div>
          <label htmlFor="gus-api-key" className="block text-sm font-medium text-gf-body mb-2">
            {t('apiKeyLabel')}
          </label>
          <input
            type="password"
            id="gus-api-key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={hasKey ? '••••••••••••••••' : t('apiKeyPlaceholder')}
            className="w-full px-4 py-2.5 bg-gf-input border border-gf-border rounded-lg text-gf-heading placeholder-gf-muted focus:outline-none focus:ring-2 focus:ring-gf-accent focus:border-transparent"
          />
          <p className="mt-2 text-xs text-gf-muted">
            {t('apiKeyHelp')}{' '}
            <a
              href="https://api.stat.gov.pl/Home/RegonApi"
              target="_blank"
              rel="noopener noreferrer"
              className="text-gf-accent hover:underline inline-flex items-center gap-1"
            >
              {t('getApiKey')}
              <ExternalLink className="w-3 h-3" />
            </a>
          </p>
        </div>

        <div>
          <label className="flex items-center space-x-3 cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="w-4 h-4 text-gf-accent bg-gf-raised border-gf-border rounded focus:ring-2 focus:ring-gf-accent"
            />
            <span className="text-sm text-gf-body">
              {t('enableLabel')}
            </span>
          </label>
          <p className="mt-1 ml-7 text-xs text-gf-muted">
            {t('enableHelp')}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleSave}
            disabled={saving || deleting}
            className="px-6 py-2.5 bg-gf-accent hover:bg-gf-accent-hover disabled:bg-gray-400 text-gf-inverse font-medium rounded-lg transition-colors disabled:cursor-not-allowed flex items-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {t('saveButton')}
          </button>

          {hasKey && (
            <button
              onClick={() => setShowDeleteModal(true)}
              disabled={saving || deleting}
              className="px-6 py-2.5 bg-gf-danger hover:opacity-90 disabled:bg-gray-400 text-gf-inverse font-medium rounded-lg transition-colors disabled:cursor-not-allowed flex items-center gap-2"
            >
              {deleting && <Loader2 className="w-4 h-4 animate-spin" />}
              {t('deleteButton')}
            </button>
          )}
        </div>
      </div>
    </div>
    </>
  );
}
