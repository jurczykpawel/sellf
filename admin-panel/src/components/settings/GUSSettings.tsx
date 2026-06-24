'use client';

import { useState, useEffect } from 'react';
import { Building2, ExternalLink, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { saveGUSAPIKey, getGUSConfig, deleteGUSAPIKey } from '@/lib/actions/gus-config';
import { BaseModal, ModalHeader, ModalBody, ModalFooter, Button } from '@/components/ui/Modal';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

export default function GUSSettings() {
 const t = useTranslations('settings.gus');
 const tCommon = useTranslations('common');
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
 toast.error(t('errors.apiKeyRequired'));
 return;
 }

 setSaving(true);

 try {
 const result = await saveGUSAPIKey({
 apiKey: apiKey.trim() || 'KEEP_EXISTING', // If empty and hasKey, keep existing
 enabled,
 });

 if (result.success) {
 toast.success(t('messages.saved'));
 setApiKey('');
 await loadConfig();
 } else {
 toast.error(result.error || t('errors.saveFailed'));
 }
 } catch (error) {
 toast.error(t('errors.saveFailed'));
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
 toast.success(t('messages.deleted'));
 setApiKey('');
 setEnabled(false);
 await loadConfig();
 } else {
 toast.error(result.error || t('errors.deleteFailed'));
 }
 } catch (error) {
 toast.error(t('errors.deleteFailed'));
 } finally {
 setDeleting(false);
 }
 };

 if (loading) {
 return (
 <div className="bg-sf-base border-2 border-sf-border-medium p-6">
 <div className="animate-pulse space-y-4">
 <div className="h-4 bg-sf-raised w-1/4"></div>
 <div className="h-20 bg-sf-raised"></div>
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
 <p className="text-sf-body">
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

 <div className="bg-sf-base border-2 border-sf-border-medium p-6">
 <div className="flex items-start justify-between mb-6">
 <div>
 <h2 className="text-xl font-semibold text-sf-heading mb-2">
 {t('title')}
 </h2>
 <p className="text-sm text-sf-body">
 {t('subtitle')}
 </p>
 </div>
 <Building2 className="w-8 h-8 text-sf-accent" />
 </div>

 {/* Status Banner */}
 {hasKey && enabled && (
 <div className="mb-6 bg-sf-success-soft border border-sf-success/20 p-4">
 <div className="flex items-start gap-3">
 <CheckCircle2 className="w-5 h-5 text-sf-success mt-0.5 flex-shrink-0" />
 <div className="flex-1">
 <p className="text-sm font-medium text-sf-heading mb-1">
 {t('status.active')}
 </p>
 <p className="text-sm text-sf-body">
 {t('status.activeDescription')}
 </p>
 </div>
 </div>
 </div>
 )}

 {hasKey && !enabled && (
 <div className="mb-6 bg-sf-warning-soft border border-sf-warning/20 p-4">
 <div className="flex items-start gap-3">
 <AlertCircle className="w-5 h-5 text-sf-warning mt-0.5 flex-shrink-0" />
 <div className="flex-1">
 <p className="text-sm font-medium text-sf-heading mb-1">
 {t('status.disabled')}
 </p>
 <p className="text-sm text-sf-body">
 {t('status.disabledDescription')}
 </p>
 </div>
 </div>
 </div>
 )}

 {/* Configuration Form */}
 <div className="space-y-4">
 <div>
 <label htmlFor="gus-api-key" className="block text-sm font-medium text-sf-body mb-2">
 {t('apiKeyLabel')}
 </label>
 <form onSubmit={(e) => e.preventDefault()} className="contents">
 <input
 type="password"
 id="gus-api-key"
 value={apiKey}
 onChange={(e) => setApiKey(e.target.value)}
 placeholder={hasKey ? '••••••••••••••••' : t('apiKeyPlaceholder')}
 autoComplete="off"
 className="w-full px-4 py-2.5 bg-sf-input border-2 border-sf-border-medium text-sf-heading placeholder-sf-muted focus:outline-none focus:ring-2 focus:ring-sf-accent focus:border-transparent"
 />
 </form>
 <p className="mt-2 text-xs text-sf-muted">
 {t('apiKeyHelp')}{' '}
 <a
 href="https://api.stat.gov.pl/Home/RegonApi"
 target="_blank"
 rel="noopener noreferrer"
 className="text-sf-accent underline hover:no-underline inline-flex items-center gap-1"
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
 className="w-4 h-4 text-sf-accent bg-sf-raised border-sf-border rounded focus:ring-2 focus:ring-sf-accent"
 />
 <span className="text-sm text-sf-body">
 {t('enableLabel')}
 </span>
 </label>
 <p className="mt-1 ml-7 text-xs text-sf-muted">
 {t('enableHelp')}
 </p>
 </div>

 {/* Actions */}
 <div className="flex items-center gap-3 pt-2">
 <button
 onClick={handleSave}
 disabled={saving || deleting}
 className="px-6 py-2.5 bg-sf-accent-bg hover:bg-sf-accent-hover disabled:bg-sf-muted text-white font-medium transition-colors disabled:cursor-not-allowed flex items-center gap-2"
 >
 {saving && <Loader2 className="w-4 h-4 animate-spin" />}
 {t('saveButton')}
 </button>

 {hasKey && (
 <button
 onClick={() => setShowDeleteModal(true)}
 disabled={saving || deleting}
 className="px-6 py-2.5 bg-sf-danger-bg hover:opacity-90 disabled:bg-sf-muted text-sf-inverse font-medium transition-colors disabled:cursor-not-allowed flex items-center gap-2"
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
