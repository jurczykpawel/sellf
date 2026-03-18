'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { Key, Plus, RotateCw, Trash2, Copy, Eye, EyeOff, AlertTriangle, Pencil } from 'lucide-react';
import ApiKeyFormModal from './ApiKeyFormModal';
import { BaseModal, ModalHeader, ModalBody, ModalFooter, Button } from './ui/Modal';

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  rate_limit_per_minute: number;
  is_active: boolean;
  expires_at: string | null;
  last_used_at: string | null;
  usage_count: number;
  created_at: string;
  revoked_at: string | null;
}

const SCOPE_KEY_MAP: Record<string, string> = {
  '*': 'scopes.fullAccess',
  'products:read': 'scopes.productsRead',
  'products:write': 'scopes.productsWrite',
  'users:read': 'scopes.usersRead',
  'users:write': 'scopes.usersWrite',
  'coupons:read': 'scopes.couponsRead',
  'coupons:write': 'scopes.couponsWrite',
  'analytics:read': 'scopes.analyticsRead',
  'webhooks:read': 'scopes.webhooksRead',
  'webhooks:write': 'scopes.webhooksWrite',
};

export default function ApiKeysPageContent({ scopesLocked = false }: { scopesLocked?: boolean }) {
  const t = useTranslations('admin.apiKeys');
  const tCommon = useTranslations('common');

  // State
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modals
  const [showForm, setShowForm] = useState(false);
  const [keyToEdit, setKeyToEdit] = useState<ApiKey | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [keyToRevoke, setKeyToRevoke] = useState<ApiKey | null>(null);
  const [keyToRotate, setKeyToRotate] = useState<ApiKey | null>(null);
  const [newKeySecret, setNewKeySecret] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);

  // Fetch API keys
  const fetchApiKeys = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/v1/api-keys');
      if (!res.ok) throw new Error('Failed to fetch API keys');
      const data = await res.json();
      setApiKeys(data.data || []);
    } catch (err) {
      console.error('Error fetching API keys:', err);
      setError(t('fetchError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchApiKeys();
  }, [fetchApiKeys]);

  // Create API key
  const handleCreate = async (formData: { name: string; scopes: string[]; rate_limit_per_minute?: number; expires_at?: string }) => {
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/v1/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || 'Failed to create API key');
      }

      const data = await res.json();
      setNewKeySecret(data.data.key);
      await fetchApiKeys();
      setShowForm(false);
      toast.success(t('createSuccess'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('createError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Update API key
  const handleUpdate = async (formData: { name: string; scopes: string[]; rate_limit_per_minute?: number }) => {
    if (!keyToEdit) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/v1/api-keys/${keyToEdit.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || t('editError'));
      }

      await fetchApiKeys();
      setKeyToEdit(null);
      toast.success(t('editSuccess'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('editError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Revoke API key
  const handleRevoke = async () => {
    if (!keyToRevoke) return;

    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/v1/api-keys/${keyToRevoke.id}?reason=Revoked by admin`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || 'Failed to revoke API key');
      }

      await fetchApiKeys();
      setKeyToRevoke(null);
      toast.success(t('revokeSuccess'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('revokeError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Rotate API key
  const handleRotate = async () => {
    if (!keyToRotate) return;

    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/v1/api-keys/${keyToRotate.id}/rotate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grace_period_hours: 24 }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || 'Failed to rotate API key');
      }

      const data = await res.json();
      setNewKeySecret(data.data.new_key.key);
      await fetchApiKeys();
      setKeyToRotate(null);
      toast.success(t('rotateSuccess'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('rotateError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Copy to clipboard
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success(t('copied'));
  };

  // Format date
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Get status badge
  const getStatusBadge = (key: ApiKey) => {
    if (key.revoked_at) {
      return <span className="px-2 py-1 text-xs font-medium bg-sf-danger-soft text-sf-danger">{t('statusRevoked')}</span>;
    }
    if (!key.is_active) {
      return <span className="px-2 py-1 text-xs font-medium bg-sf-raised text-sf-muted">{t('statusInactive')}</span>;
    }
    if (key.expires_at && new Date(key.expires_at) < new Date()) {
      return <span className="px-2 py-1 text-xs font-medium bg-sf-warning-soft text-sf-warning">{t('statusExpired')}</span>;
    }
    return <span className="px-2 py-1 text-xs font-medium bg-sf-success-soft text-sf-success">{t('statusActive')}</span>;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-[40px] font-[800] text-sf-heading tracking-[-0.03em] leading-[1.1]">{t('title')}</h1>
          <p className="text-sf-body mt-1">{t('subtitle')}</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t('createKey')}
        </button>
      </div>

      {/* API Keys Table */}
      <div className="bg-sf-base border-2 border-sf-border-medium overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-12 text-red-500">
            <AlertTriangle className="w-5 h-5 mr-2" />
            {error}
          </div>
        ) : apiKeys.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-sf-muted">
            <Key className="w-12 h-12 mb-4 opacity-50" />
            <p className="text-lg font-medium">{t('noKeys')}</p>
            <p className="text-sm">{t('noKeysDescription')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-sf-raised">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-sf-muted uppercase tracking-wider">{t('columnName')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-sf-muted uppercase tracking-wider">{t('columnKey')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-sf-muted uppercase tracking-wider">{t('columnScopes')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-sf-muted uppercase tracking-wider">{t('columnStatus')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-sf-muted uppercase tracking-wider">{t('columnLastUsed')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-sf-muted uppercase tracking-wider">{t('columnCreated')}</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-sf-muted uppercase tracking-wider">{t('columnActions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sf-border">
                {apiKeys.map((key, index) => (
                  <tr key={key.id} className={`hover:bg-sf-hover transition-colors ${index % 2 === 1 ? 'bg-sf-row-alt' : ''}`}>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <Key className="w-4 h-4 text-sf-muted" />
                        <span className="font-medium text-sf-heading">{key.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <code className="px-2 py-1 bg-sf-raised text-sm font-mono text-sf-body">
                        {key.key_prefix}...
                      </code>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1">
                        {key.scopes.slice(0, 2).map((scope) => (
                          <span key={scope} className="px-2 py-0.5 text-xs bg-sf-accent-soft text-sf-accent">
                            {SCOPE_KEY_MAP[scope] ? t(SCOPE_KEY_MAP[scope]) : scope}
                          </span>
                        ))}
                        {key.scopes.length > 2 && (
                          <span className="px-2 py-0.5 text-xs bg-sf-raised text-sf-muted">
                            +{key.scopes.length - 2}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">{getStatusBadge(key)}</td>
                    <td className="px-6 py-4 text-sm text-sf-muted">
                      {key.last_used_at ? formatDate(key.last_used_at) : t('neverUsed')}
                      {key.usage_count > 0 && (
                        <span className="block text-xs">({key.usage_count} {t('requests')})</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-sf-muted">
                      {formatDate(key.created_at)}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2">
                        {!key.revoked_at && (
                          <button
                            onClick={() => setKeyToEdit(key)}
                            className="p-2 text-sf-muted hover:text-sf-accent hover:bg-sf-accent-soft transition-colors"
                            title={t('editKeyTitle')}
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                        )}
                        {!key.revoked_at && key.is_active && (
                          <>
                            <button
                              onClick={() => setKeyToRotate(key)}
                              className="p-2 text-sf-muted hover:text-blue-600 hover:bg-sf-accent-soft transition-colors"
                              title={t('rotateKey')}
                            >
                              <RotateCw className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setKeyToRevoke(key)}
                              className="p-2 text-sf-muted hover:text-red-600 hover:bg-sf-danger-soft transition-colors"
                              title={t('revokeKey')}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Key Modal */}
      <ApiKeyFormModal
        isOpen={showForm}
        onClose={() => setShowForm(false)}
        onSubmit={handleCreate}
        isSubmitting={isSubmitting}
        scopesLocked={scopesLocked}
      />

      {/* Edit Key Modal */}
      <ApiKeyFormModal
        isOpen={!!keyToEdit}
        onClose={() => setKeyToEdit(null)}
        onSubmit={handleUpdate}
        isSubmitting={isSubmitting}
        initialData={keyToEdit ? {
          name: keyToEdit.name,
          scopes: keyToEdit.scopes,
          rate_limit_per_minute: keyToEdit.rate_limit_per_minute,
        } : undefined}
      />

      {/* New Key Secret Modal */}
      {newKeySecret && (
        <BaseModal isOpen={true} onClose={() => { setNewKeySecret(null); setShowSecret(false); }} size="md">
          <ModalHeader
            title={t('keyCreated')}
            icon={<Key className="w-6 h-6 text-green-500" />}
          />
          <ModalBody>
            <div className="space-y-4">
              <div className="p-4 bg-sf-warning-soft border border-sf-warning/20">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-sf-warning mt-0.5" />
                  <div>
                    <p className="font-medium text-sf-warning">{t('saveKeyWarning')}</p>
                    <p className="text-sm text-sf-warning mt-1">{t('saveKeyDescription')}</p>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-sf-body mb-2">{t('yourApiKey')}</label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 relative">
                    <input
                      type={showSecret ? 'text' : 'password'}
                      value={newKeySecret}
                      readOnly
                      className="w-full px-3 py-2 pr-10 bg-sf-raised border-2 border-sf-border-medium font-mono text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecret(!showSecret)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-sf-muted hover:text-gray-600"
                    >
                      {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <button
                    onClick={() => copyToClipboard(newKeySecret)}
                    className="p-2 bg-sf-raised hover:bg-sf-hover transition-colors"
                    title={t('copy')}
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button onClick={() => { setNewKeySecret(null); setShowSecret(false); }} variant="primary">
              {t('done')}
            </Button>
          </ModalFooter>
        </BaseModal>
      )}

      {/* Revoke Confirmation Modal */}
      {keyToRevoke && (
        <BaseModal isOpen={true} onClose={() => setKeyToRevoke(null)} size="sm">
          <ModalHeader
            title={t('revokeTitle')}
            icon={<Trash2 className="w-6 h-6 text-red-500" />}
          />
          <ModalBody>
            <p className="text-sf-body">
              {t('revokeConfirmation', { name: keyToRevoke.name })}
            </p>
            <p className="text-sm text-sf-muted mt-2">
              {t('revokeWarning')}
            </p>
          </ModalBody>
          <ModalFooter>
            <Button onClick={() => setKeyToRevoke(null)} variant="secondary">
              {tCommon('cancel')}
            </Button>
            <Button onClick={handleRevoke} variant="danger" loading={isSubmitting}>
              {t('revokeKey')}
            </Button>
          </ModalFooter>
        </BaseModal>
      )}

      {/* Rotate Confirmation Modal */}
      {keyToRotate && (
        <BaseModal isOpen={true} onClose={() => setKeyToRotate(null)} size="sm">
          <ModalHeader
            title={t('rotateTitle')}
            icon={<RotateCw className="w-6 h-6 text-blue-500" />}
          />
          <ModalBody>
            <p className="text-sf-body">
              {t('rotateConfirmation', { name: keyToRotate.name })}
            </p>
            <p className="text-sm text-sf-muted mt-2">
              {t('rotateGracePeriod')}
            </p>
          </ModalBody>
          <ModalFooter>
            <Button onClick={() => setKeyToRotate(null)} variant="secondary">
              {tCommon('cancel')}
            </Button>
            <Button onClick={handleRotate} variant="primary" loading={isSubmitting}>
              {t('rotateKey')}
            </Button>
          </ModalFooter>
        </BaseModal>
      )}
    </div>
  );
}
