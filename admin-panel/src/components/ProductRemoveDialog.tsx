'use client';

/**
 * Confirmation for "Delete" (archives a product with orders) and "Delete permanently"
 * (from the archive). Both show what happens to orders, invoices, licenses and buyer access.
 *
 * @see src/app/api/v1/products/[id]/deletion-impact/route.ts
 * @see src/app/api/v1/products/[id]/route.ts (DELETE)
 */

import React, { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api/client';
import { BaseModal, ModalHeader, ModalBody, ModalFooter, Button, Message } from '@/components/ui/Modal';
import type { Product } from '@/types';

export interface ProductDeletionImpact {
  orders: number;
  invoices: number;
  licenses: number;
  accesses: number;
  subscriptions: number;
  hasHistory: boolean;
}

interface ProductRemoveDialogProps {
  product: Product;
  /** `remove` = the regular Delete action; `permanent` = Delete permanently from the archive. */
  mode: 'remove' | 'permanent';
  onClose: () => void;
  /** Called after the API call succeeded; `archived` tells whether the product went to the archive. */
  onDone: (outcome: 'archived' | 'deleted') => void;
}

export default function ProductRemoveDialog({ product, mode, onClose, onDone }: ProductRemoveDialogProps) {
  const t = useTranslations('admin.products.remove');
  const [impact, setImpact] = useState<ProductDeletionImpact | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.getCustom<ProductDeletionImpact>(`products/${product.id}/deletion-impact`)
      .then(data => { if (!cancelled) setImpact(data); })
      .catch(() => { if (!cancelled) setLoadFailed(true); });
    return () => { cancelled = true; };
  }, [product.id]);

  const archives = mode === 'remove' && impact?.hasHistory === true;
  // Products with subscriptions stay in the archive (the database keeps the subscription link).
  const blocked = mode === 'permanent' && (impact?.subscriptions ?? 0) > 0;

  const confirm = async () => {
    setSubmitting(true);
    setFailed(false);
    try {
      if (mode === 'permanent') await api.deleteCustom(`products/${product.id}`, { permanent: true });
      else await api.delete('products', product.id);
      onDone(archives ? 'archived' : 'deleted');
    } catch {
      setFailed(true);
      setSubmitting(false);
    }
  };

  const title = mode === 'permanent' ? t('permanentTitle') : archives ? t('archiveTitle') : t('deleteTitle');
  const counts = impact ? { orders: impact.orders, invoices: impact.invoices, licenses: impact.licenses, accesses: impact.accesses } : null;

  return (
    <BaseModal isOpen onClose={onClose} size="md" labelledBy="product-remove-title">
      <ModalHeader title={<span id="product-remove-title">{title}</span>} subtitle={product.name} />
      <ModalBody>
        <div className="space-y-3 text-sm text-sf-body" data-testid="product-remove-dialog">
          {!impact && !loadFailed && <p>{t('loading')}</p>}
          {loadFailed && <Message type="error" message={t('loadError')} />}
          {impact && mode === 'remove' && !archives && <p>{t('deleteBody', { name: product.name })}</p>}
          {archives && counts && (
            <>
              <p className="font-semibold">{t('archiveLead', counts)}</p>
              <p>{t('archiveBody')}</p>
            </>
          )}
          {impact && mode === 'permanent' && counts && (
            <>
              <p className="font-semibold">{t('permanentLead')}</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>{t('permanentKept', counts)}</li>
                <li>{t('permanentAccess', counts)}</li>
                <li>{t('permanentIrreversible')}</li>
              </ul>
              {blocked && <Message type="warning" message={t('permanentBlocked', { subscriptions: impact.subscriptions })} />}
            </>
          )}
          {failed && <Message type="error" message={mode === 'permanent' ? t('permanentError') : t('error')} />}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button onClick={onClose} variant="secondary">{t('cancel')}</Button>
        <Button onClick={confirm} variant="danger" loading={submitting} disabled={!impact || blocked || submitting}>
          {mode === 'permanent' ? t('permanentConfirm') : archives ? t('archiveConfirm') : t('deleteConfirm')}
        </Button>
      </ModalFooter>
    </BaseModal>
  );
}
