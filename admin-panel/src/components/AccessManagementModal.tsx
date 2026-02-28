'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { UserWithAccess, Product } from '@/types';
import { BaseModal, ModalHeader, ModalBody, ModalFooter, ModalSection, Button, Message } from './ui/Modal';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api/client';

interface AccessManagementModalProps {
  user: UserWithAccess;
  isOpen: boolean;
  onClose: () => void;
  onAccessChange: () => void;
}

interface UserAccess {
  id: string;
  product_id: string;
  product_name: string;
  product_description: string;
  product_price: number;
  product_currency: string;
  product_is_active: boolean;
  access_created_at: string;
  access_expires_at?: string | null;
  access_duration_days?: number | null;
  product_slug: string;
}

const AccessManagementModal: React.FC<AccessManagementModalProps> = ({
  user,
  isOpen,
  onClose,
  onAccessChange
}) => {
  const t = useTranslations('admin.users.accessModal');
  const tCommon = useTranslations('common');
  const [userAccess, setUserAccess] = useState<UserAccess[]>([]);
  const [availableProducts, setAvailableProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [accessDuration, setAccessDuration] = useState<number | ''>('');
  const [accessExpiration, setAccessExpiration] = useState<string>('');
  const [accessType, setAccessType] = useState<'permanent' | 'duration' | 'expiration'>('permanent');
  const [error, setError] = useState<string | null>(null);

  const fetchUserAccess = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch(`/api/users/${user.id}/access`);
      if (!response.ok) {
        throw new Error('Failed to fetch user access');
      }
      
      const data = await response.json();
      setUserAccess(data.access || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorFetch'));
    } finally {
      setLoading(false);
    }
  }, [user.id, t]);

  const fetchAvailableProducts = useCallback(async (retryCount = 0) => {
    try {
      // Fetch only active products using v1 API
      const response = await api.list<Product>('products', {
        status: 'active',
        limit: 100,
        sort: 'name',
      });
      console.log('[AccessManagementModal] Fetched products:', response.data?.length || 0);
      setAvailableProducts(response.data || []);
    } catch (err) {
      // Retry on auth errors (session might not be ready yet)
      if (retryCount < 2) {
        console.log('[AccessManagementModal] Error fetching, retrying in 500ms...');
        setTimeout(() => fetchAvailableProducts(retryCount + 1), 500);
        return;
      }
      console.error('[AccessManagementModal] Error fetching products:', err);
      // Still set empty array but at least we logged the error
      setAvailableProducts([]);
    }
  }, []);

  // Fetch user's current access and available products
  useEffect(() => {
    if (isOpen && user) {
      fetchUserAccess();
      fetchAvailableProducts();
    }
  }, [isOpen, user, fetchUserAccess, fetchAvailableProducts]);

  const handleGrantAccess = async () => {
    if (!selectedProductId) {
      setError(t('selectProduct'));
      return;
    }

    try {
      setActionLoading('grant');
      setError(null);
      
      const response = await fetch(`/api/users/${user.id}/access`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          product_id: selectedProductId,
          access_type: accessType,
          access_duration_days: accessType === 'duration' ? accessDuration : null,
          access_expires_at: accessType === 'expiration' ? accessExpiration : null
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || t('grantAccessError'));
      }

      // Refresh user access
      await fetchUserAccess();
      setShowAddForm(false);
      setSelectedProductId('');
      setAccessDuration('');
      setAccessExpiration('');
      setAccessType('permanent');
      onAccessChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('grantAccessError'));
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemoveAccess = async (productId: string) => {
    try {
      setActionLoading(productId);
      setError(null);
      
      const response = await fetch(`/api/users/${user.id}/access?product_id=${productId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || t('removeAccessError'));
      }

      // Refresh user access
      await fetchUserAccess();
      onAccessChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('removeAccessError'));
    } finally {
      setActionLoading(null);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getAvailableProductsForUser = () => {
    const userProductIds = userAccess.map(access => access.product_id);
    return availableProducts.filter(product => 
      product.is_active && !userProductIds.includes(product.id)
    );
  };

  if (!isOpen) return null;

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} size="lg" closeOnBackdropClick={false}>
      <ModalHeader
        title={t('title')}
        subtitle={t('subtitle', { email: user.email })}
        icon={
          <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        }
      />

      <ModalBody>
        {error && (
          <Message
            type="error"
            title={t('error')}
            message={error}
            className="mb-4"
          />
        )}

        {loading ? (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gf-accent mb-4"></div>
            <p className="text-sm text-gf-muted">{t('loadingAccess')}</p>
          </div>
        ) : (
          <div className="space-y-6">
            <ModalSection title={t('currentAccess')}>
              {userAccess.length > 0 ? (
                <div className="space-y-3">
                  {userAccess.map((access) => (
                    <div key={access.id} className="group relative">
                      <div className="flex items-center justify-between p-4 bg-gf-deep rounded-xl border border-gf-border hover:bg-gf-hover transition-colors">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="text-sm font-medium text-gf-heading truncate">
                              {access.product_name}
                            </h4>
                            <div className="flex items-center space-x-2 ml-4">
                              <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                                access.product_is_active
                                  ? 'bg-gf-success-soft text-gf-success'
                                  : 'bg-gf-raised text-gf-body'
                              }`}>
                                {access.product_is_active ? t('active') : t('inactive')}
                              </span>
                              <Button
                                onClick={() => handleRemoveAccess(access.product_id)}
                                disabled={actionLoading === access.product_id}
                                loading={actionLoading === access.product_id}
                                variant="danger"
                                size="sm"
                              >
                                {t('remove')}
                              </Button>
                            </div>
                          </div>
                          <p className="text-xs text-gf-muted">
                            {t('granted')}: {formatDate(access.access_created_at)}
                            {access.access_expires_at && (
                              <span className="block text-gf-info">
                                {t('expires')}: {formatDate(access.access_expires_at)}
                              </span>
                            )}
                            {access.access_duration_days && (
                              <span className="block text-gf-accent">
                                {t('duration')}: {access.access_duration_days} {t('days')}
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <div className="w-16 h-16 mx-auto mb-4 bg-gf-raised rounded-full flex items-center justify-center">
                    <svg className="w-8 h-8 text-gf-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <p className="text-gf-muted font-medium">{t('noAccessGranted')}</p>
                  <p className="text-sm text-gf-muted mt-1">{t('noAccessYet')}</p>
                </div>
              )}
            </ModalSection>

            <ModalSection title={t('grantNewAccess')}>
              {showAddForm ? (
                <div className="space-y-4 p-4 bg-gf-accent-soft rounded-xl border border-gf-accent/20">
                  <div>
                    <label htmlFor="product-select" className="block text-sm font-medium text-gf-body mb-2">
                      {t('selectProductLabel')}
                    </label>
                    <select
                      id="product-select"
                      value={selectedProductId}
                      onChange={(e) => setSelectedProductId(e.target.value)}
                      className="w-full px-3 py-2.5 bg-gf-input text-gf-heading border border-gf-border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-gf-accent focus:border-transparent"
                    >
                      <option value="">{t('chooseProductPlaceholder')}</option>
                      {getAvailableProductsForUser().map(product => (
                        <option key={product.id} value={product.id}>
                          {product.name} {product.price > 0 ? `(${product.currency} ${product.price})` : '(Free)'}
                        </option>
                        ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="access-type" className="block text-sm font-medium text-gf-body mb-2">
                      {t('accessTypeLabel')}
                    </label>
                    <div className="flex space-x-2">
                      <Button
                        onClick={() => setAccessType('permanent')}
                        variant={accessType === 'permanent' ? 'primary' : 'secondary'}
                        className="flex-1"
                      >
                        {t('permanent')}
                      </Button>
                      <Button
                        onClick={() => setAccessType('duration')}
                        variant={accessType === 'duration' ? 'primary' : 'secondary'}
                        className="flex-1"
                      >
                        {t('duration')}
                      </Button>
                      <Button
                        onClick={() => setAccessType('expiration')}
                        variant={accessType === 'expiration' ? 'primary' : 'secondary'}
                        className="flex-1"
                      >
                        {t('expiration')}
                      </Button>
                    </div>
                  </div>

                  {accessType === 'duration' && (
                    <div>
                      <label htmlFor="access-duration" className="block text-sm font-medium text-gf-body mb-2">
                        {t('durationInDays')}
                      </label>
                      <input
                        id="access-duration"
                        type="number"
                        value={accessDuration}
                        onChange={(e) => setAccessDuration(Number(e.target.value))}
                        className="w-full px-3 py-2.5 bg-gf-input text-gf-heading border border-gf-border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-gf-accent focus:border-transparent"
                        placeholder={t('enterDurationDays')}
                      />
                    </div>
                  )}

                  {accessType === 'expiration' && (
                    <div>
                      <label htmlFor="access-expiration" className="block text-sm font-medium text-gf-body mb-2">
                        {t('expirationDate')}
                      </label>
                      <input
                        id="access-expiration"
                        type="date"
                        value={accessExpiration}
                        onChange={(e) => setAccessExpiration(e.target.value)}
                        className="w-full px-3 py-2.5 bg-gf-input text-gf-heading border border-gf-border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-gf-accent focus:border-transparent"
                      />
                    </div>
                  )}

                  <div className="flex justify-end space-x-3">
                    <Button
                      onClick={() => {
                        setShowAddForm(false);
                        setSelectedProductId('');
                        setAccessDuration('');
                        setAccessExpiration('');
                        setAccessType('permanent');
                        setError(null);
                      }}
                      variant="secondary"
                    >
                      {tCommon('cancel')}
                    </Button>
                    <Button
                      onClick={handleGrantAccess}
                      disabled={!selectedProductId}
                      loading={actionLoading === 'grant'}
                      variant="primary"
                    >
                      {t('grantAccess')}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  onClick={() => setShowAddForm(true)}
                  disabled={getAvailableProductsForUser().length === 0}
                  variant="primary"
                  className="w-full"
                >
                  {getAvailableProductsForUser().length === 0 ? (
                    <>
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      {t('noProductsAvailable')}
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                      {t('addNewAccess')}
                    </>
                  )}
                </Button>
              )}
            </ModalSection>
          </div>
        )}
      </ModalBody>

      <ModalFooter>
        <Button onClick={onClose} variant="secondary">
          {tCommon('close')}
        </Button>
      </ModalFooter>
    </BaseModal>
  );
};

export default AccessManagementModal;
