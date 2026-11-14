'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { UserWithAccess, Product } from '@/types';
import { BaseModal, ModalHeader, ModalBody, ModalFooter, ModalSection, Button, Message } from './ui/Modal';
import { useTranslations, useLocale } from 'next-intl';
import { productOptionLabel } from '@/lib/access/product-option-label';
import { fetchAllProductsForDropdown } from '@/hooks/useProducts';
import CustomCheckoutFieldsForm from '@/components/checkout/CustomCheckoutFieldsForm';
import { validateCustomFieldDefinitions } from '@/lib/validations/custom-checkout-fields';
import { formatAdminDate } from '@/lib/timezone';

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
  has_grant_license?: boolean;
  license_pending?: boolean;
}

const AccessManagementModal: React.FC<AccessManagementModalProps> = ({
  user,
  isOpen,
  onClose,
  onAccessChange
}) => {
  const t = useTranslations('admin.users.accessModal');
  const locale = useLocale();
  const tCommon = useTranslations('common');
  const [userAccess, setUserAccess] = useState<UserAccess[]>([]);
  const [availableProducts, setAvailableProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [accessDuration, setAccessDuration] = useState<number | ''>('');
  const [accessExpiration, setAccessExpiration] = useState<string>('');
  const [accessType, setAccessType] = useState<'permanent' | 'duration' | 'expiration'>('permanent');
  const [issueLicense, setIssueLicense] = useState(true);
  const [revokeLicenses, setRevokeLicenses] = useState<Record<string, boolean>>({});
  const [licenseValues, setLicenseValues] = useState<Record<string, string>>({});
  const [licenseErrors, setLicenseErrors] = useState<Record<string, string>>({});
  const selectedProduct = availableProducts.find(product => product.id === selectedProductId);
  const definitions = validateCustomFieldDefinitions(selectedProduct?.custom_checkout_fields ?? []);
  const [error, setError] = useState<string | null>(null);

  const loadUserAccess = useCallback(async () => {
    try {
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

  const requestKey = JSON.stringify([user.id, isOpen]);
  const [previousKey, setPreviousKey] = useState(requestKey);
  if (previousKey !== requestKey) {
    setPreviousKey(requestKey);
    setLoading(true);
    setError(null);
    setRevokeLicenses({});
  }

  const fetchUserAccess = useCallback(() => {
    setLoading(true);
    setError(null);
    return loadUserAccess();
  }, [loadUserAccess]);

  const fetchAvailableProducts = useCallback(async function loadAvailableProducts(retryCount = 0) {
    try {
      // Fetch every active product using v1 API
      setAvailableProducts(await fetchAllProductsForDropdown('active'));
    } catch (err) {
      // Retry on auth errors (session might not be ready yet)
      if (retryCount < 2) {
        setTimeout(() => loadAvailableProducts(retryCount + 1), 500);
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

      loadUserAccess();
      fetchAvailableProducts();
    }
  }, [isOpen, user, loadUserAccess, fetchAvailableProducts]);

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
          issue_license: issueLicense,
          license: { customFieldValues: licenseValues, locale },
          access_type: accessType,
          access_duration_days: accessType === 'duration' ? accessDuration : null,
          access_expires_at: accessType === 'expiration' ? accessExpiration : null
        })
      });

      const responseData = await response.json();
      if (!response.ok) {
        setLicenseErrors(responseData.fieldErrors ?? {});
        throw new Error(responseData.error_code === 'LICENSE_ISSUANCE_FAILED' ? t('licenseError') : responseData.error?.message || responseData.error || t('grantAccessError'));
      }

      // Refresh user access
      await fetchUserAccess();
      setShowAddForm(false);
      setRevokeLicenses(values => ({ ...values, [selectedProductId]: true }));
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

      const response = await fetch(`/api/users/${user.id}/access?product_id=${productId}&revoke_license=${revokeLicenses[productId] !== false}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || errorData.error || t('removeAccessError'));
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
    return formatAdminDate(dateString, locale);
  };

  const getAvailableProductsForUser = () => {
    const userProductIds = userAccess.map(access => access.product_id);
    return availableProducts.filter(product =>
      product.is_active && (!userProductIds.includes(product.id) || userAccess.some(access => access.product_id === product.id && access.license_pending))
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
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sf-accent mb-4"></div>
            <p className="text-sm text-sf-muted">{t('loadingAccess')}</p>
          </div>
        ) : (
          <div className="space-y-6">
            <ModalSection title={t('currentAccess')}>
              {userAccess.length > 0 ? (
                <div className="space-y-3">
                  {userAccess.map((access) => (
                    <div key={access.id} className="group relative">
                      <div className="flex items-center justify-between p-4 bg-sf-deep border-2 border-sf-border-medium hover:bg-sf-hover transition-colors">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="text-sm font-medium text-sf-heading truncate">
                              {access.product_name}
                            </h4>
                            <div className="flex items-center space-x-2 ml-4">
                              <span className={`inline-flex items-center px-2 py-1 text-xs font-medium ${
                                access.product_is_active
                                  ? 'bg-sf-success-soft text-sf-success'
                                  : 'bg-sf-raised text-sf-body'
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
                          {access.has_grant_license && (
                            <label className="flex min-h-11 items-center gap-2 mb-2 text-sm text-sf-body">
                              <input type="checkbox" checked={revokeLicenses[access.product_id] !== false} onChange={e => setRevokeLicenses(values => ({ ...values, [access.product_id]: e.target.checked }))} />
                              {t('revokeLicense')}
                            </label>
                          )}
                          <p className="text-xs text-sf-muted">
                            {t('granted')}: {formatDate(access.access_created_at)}
                            {access.access_expires_at && (
                              <span className="block text-sf-info">
                                {t('expires')}: {formatDate(access.access_expires_at)}
                              </span>
                            )}
                            {access.access_duration_days && (
                              <span className="block text-sf-accent">
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
                  <div className="w-16 h-16 mx-auto mb-4 bg-sf-raised flex items-center justify-center">
                    <svg className="w-8 h-8 text-sf-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <p className="text-sf-muted font-medium">{t('noAccessGranted')}</p>
                  <p className="text-sm text-sf-muted mt-1">{t('noAccessYet')}</p>
                </div>
              )}
            </ModalSection>

            <ModalSection title={t('grantNewAccess')}>
              {showAddForm ? (
                <div className="space-y-4 p-4 bg-sf-accent-soft border border-sf-accent/20">
                  <div>
                    <label htmlFor="product-select" className="block text-sm font-medium text-sf-body mb-2">
                      {t('selectProductLabel')}
                    </label>
                    <select
                      id="product-select"
                      value={selectedProductId}
                      onChange={(e) => { setSelectedProductId(e.target.value); setIssueLicense(true); setLicenseValues({}); setLicenseErrors({}); }}
                      className="w-full px-3 py-2.5 bg-sf-input text-sf-heading border-2 border-sf-border-medium focus:outline-none focus:ring-2 focus:ring-sf-accent focus:border-transparent"
                    >
                      <option value="">{t('chooseProductPlaceholder')}</option>
                      {getAvailableProductsForUser().map(product => (
                        <option key={product.id} value={product.id}>
                          {productOptionLabel(product, locale, { free: t('free'), subscription: t('subscription') })}
                        </option>
                        ))}
                    </select>
                  </div>

                  {selectedProduct?.issue_license_on_purchase && (
                    <div className="space-y-3">
                      <label className="flex min-h-11 items-center gap-2 text-sm text-sf-body">
                        <input type="checkbox" checked={issueLicense} onChange={e => setIssueLicense(e.target.checked)} />
                        {t('issueLicense')}
                      </label>
                      <p className="text-xs text-sf-muted">{t('licenseSettings', { tier: selectedProduct.license_tier ?? '—', days: selectedProduct.license_duration_days ? `${selectedProduct.license_duration_days} ${t('days')}` : t('permanent') })}</p>
                      {issueLicense && definitions.ok && <CustomCheckoutFieldsForm fields={definitions.value} values={licenseValues} onChange={setLicenseValues} errors={licenseErrors} disabled={actionLoading === 'grant'} />}
                    </div>
                  )}
                  <div>
                    <label htmlFor="access-type" className="block text-sm font-medium text-sf-body mb-2">
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
                      <label htmlFor="access-duration" className="block text-sm font-medium text-sf-body mb-2">
                        {t('durationInDays')}
                      </label>
                      <input
                        id="access-duration"
                        type="number"
                        value={accessDuration}
                        onChange={(e) => setAccessDuration(Number(e.target.value))}
                        className="w-full px-3 py-2.5 bg-sf-input text-sf-heading border-2 border-sf-border-medium focus:outline-none focus:ring-2 focus:ring-sf-accent focus:border-transparent"
                        placeholder={t('enterDurationDays')}
                      />
                    </div>
                  )}

                  {accessType === 'expiration' && (
                    <div>
                      <label htmlFor="access-expiration" className="block text-sm font-medium text-sf-body mb-2">
                        {t('expirationDate')}
                      </label>
                      <input
                        id="access-expiration"
                        type="date"
                        value={accessExpiration}
                        onChange={(e) => setAccessExpiration(e.target.value)}
                        className="w-full px-3 py-2.5 bg-sf-input text-sf-heading border-2 border-sf-border-medium focus:outline-none focus:ring-2 focus:ring-sf-accent focus:border-transparent"
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
