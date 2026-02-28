'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { formatPrice } from '@/lib/constants';
import { BaseModal, ModalHeader, ModalBody, ModalFooter, ModalSection, Button, Message } from '@/components/ui/Modal';
import { useTranslations } from 'next-intl';

interface UserDetailsModalProps {
  userId: string;
  isOpen: boolean;
  onClose: () => void;
  onManageAccess: () => void;
}

interface UserProfile {
  user: {
    id: string;
    email: string;
    created_at: string;
    email_confirmed_at: string | null;
    last_sign_in_at: string | null;
    user_metadata: Record<string, unknown> | null;
  };
  stats: {
    total_products: number;
    total_value: number;
    last_access_granted_at: string | null;
    first_access_granted_at: string | null;
  };
  access: Array<{
    id: string;
    product_id: string;
    product_name: string;
    product_slug: string;
    product_price: number;
    product_currency: string;
    product_icon: string;
    product_is_active: boolean;
    granted_at: string;
  }>;
}

const UserDetailsModal: React.FC<UserDetailsModalProps> = ({
  userId,
  isOpen,
  onClose,
  onManageAccess
}) => {
  const t = useTranslations('admin.users');
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUserProfile = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/users/${userId}/profile`);
      if (!response.ok) {
        throw new Error(`Failed to fetch user profile: ${response.status}`);
      }

      const data = await response.json();
      setUserProfile(data);
    } catch {
      setError(t('modal.loadError'));
    } finally {
      setLoading(false);
    }
  }, [userId, t]);

  useEffect(() => {
    if (isOpen && userId) {
      fetchUserProfile();
    }
  }, [isOpen, userId, fetchUserProfile]);

  const formatDate = (dateString: string | null) => {
    if (!dateString) return t('modal.never');
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (!isOpen) return null;

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} size="xl" closeOnBackdropClick={false}>
      <ModalHeader
        title={t('modal.title')}
        subtitle={userProfile?.user.email || t('modal.loading')}
        icon={
          userProfile ? (
            <div className="w-8 h-8 rounded-full bg-gf-accent flex items-center justify-center">
              <span className="text-sm font-medium text-gf-inverse">
                {userProfile.user.email.charAt(0).toUpperCase()}
              </span>
            </div>
          ) : (
            <div className="w-8 h-8 rounded-full bg-gf-raised animate-pulse" />
          )
        }
        badge={userProfile ? 
          { text: `${userProfile.access.length} ${t('modal.productsCount', { count: userProfile.access.length })}`, variant: 'neutral' } : 
          undefined
        }
      />

      <ModalBody>
        {loading ? (
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gf-accent"></div>
          </div>
        ) : error ? (
          <Message
            type="error"
            title={t('modal.loadError')}
            message={error}
            className="mb-6"
          />
        ) : userProfile ? (
          <div className="space-y-6">
            {/* User Basic Info */}
            <ModalSection title={t('modal.accountInfo')}>
              <div className="flex items-center space-x-4 p-4 bg-gf-accent-soft rounded-xl border border-gf-border">
                <div className="flex-shrink-0 h-12 w-12">
                  <div className="h-12 w-12 rounded-full bg-gf-accent flex items-center justify-center">
                    <span className="text-lg font-medium text-gf-inverse">
                      {userProfile.user.email.charAt(0).toUpperCase()}
                    </span>
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-lg font-semibold text-gf-heading truncate">
                    {userProfile.user.email}
                  </h4>
                  <p className="text-sm text-gf-muted font-mono">
                    {userProfile.user.id}
                  </p>
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-gf-base p-4 rounded-lg border border-gf-border">
                  <p className="text-sm text-gf-muted">{t('modal.joined')}</p>
                  <p className="text-sm font-medium text-gf-heading">
                    {formatDate(userProfile.user.created_at)}
                  </p>
                </div>
                <div className="bg-gf-base p-4 rounded-lg border border-gf-border">
                  <p className="text-sm text-gf-muted">{t('modal.lastSignIn')}</p>
                  <p className="text-sm font-medium text-gf-heading">
                    {formatDate(userProfile.user.last_sign_in_at)}
                  </p>
                </div>
                <div className="bg-gf-base p-4 rounded-lg border border-gf-border">
                  <p className="text-sm text-gf-muted">{t('modal.emailStatus')}</p>
                  <div className="flex items-center space-x-2">
                    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                      userProfile.user.email_confirmed_at
                        ? 'bg-gf-success-soft text-gf-success'
                        : 'bg-gf-warning-soft text-gf-warning'
                    }`}>
                      {userProfile.user.email_confirmed_at ? t('modal.verified') : t('modal.pending')}
                    </span>
                  </div>
                </div>
                <div className="bg-gf-base p-4 rounded-lg border border-gf-border">
                  <p className="text-sm text-gf-muted">{t('modal.totalValue')}</p>
                  <p className="text-sm font-medium text-gf-heading">
                    {formatPrice(userProfile.stats.total_value, 'USD')}
                  </p>
                </div>
              </div>
            </ModalSection>

            {/* Activity Stats */}
            <ModalSection title={t('modal.activitySummary')}>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-gf-base p-4 rounded-lg border border-gf-border text-center">
                  <div className="text-2xl font-bold text-gf-accent">
                    {userProfile.stats.total_products}
                  </div>
                  <p className="text-sm text-gf-muted">{t('modal.productsAccessed')}</p>
                </div>
                <div className="bg-gf-base p-4 rounded-lg border border-gf-border text-center">
                  <div className="text-2xl font-bold text-gf-success">
                    {formatPrice(userProfile.stats.total_value, 'USD')}
                  </div>
                  <p className="text-sm text-gf-muted">{t('modal.totalValue')}</p>
                </div>
                <div className="bg-gf-base p-4 rounded-lg border border-gf-border text-center">
                  <div className="text-sm font-medium text-gf-heading">
                    {formatDate(userProfile.stats.first_access_granted_at)}
                  </div>
                  <p className="text-sm text-gf-muted">{t('modal.firstAccess')}</p>
                </div>
              </div>
            </ModalSection>

            {/* Product Access */}
            <ModalSection title={t('modal.productAccess')}>
              {userProfile.access.length > 0 ? (
                <div className="overflow-hidden border border-gf-border rounded-lg">
                  <table className="min-w-full divide-y divide-gf-border">
                    <thead className="bg-gf-raised">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gf-muted uppercase tracking-wider">{t('modal.product')}</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gf-muted uppercase tracking-wider">{t('modal.price')}</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gf-muted uppercase tracking-wider">{t('modal.status')}</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gf-muted uppercase tracking-wider">{t('modal.granted')}</th>
                      </tr>
                    </thead>
                    <tbody className="bg-gf-deep divide-y divide-gf-border">
                      {userProfile.access.map((access) => (
                        <tr key={access.id} className="hover:bg-gf-hover">
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="flex items-center">
                              <span className="text-xl mr-3">{access.product_icon}</span>
                              <div>
                                <div className="text-sm font-medium text-gf-heading">
                                  {access.product_name}
                                </div>
                                <div className="text-sm text-gf-muted font-mono">
                                  /{access.product_slug}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                              access.product_price === 0
                                ? 'bg-gf-success-soft text-gf-success'
                                : 'bg-gf-accent-soft text-gf-accent'
                            }`}>
                              {access.product_price === 0 ? t('modal.free') : formatPrice(access.product_price, access.product_currency)}
                            </span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                              access.product_is_active
                                ? 'bg-gf-success-soft text-gf-success'
                                : 'bg-gf-danger-soft text-gf-danger'
                            }`}>
                              {access.product_is_active ? t('modal.active') : t('modal.inactive')}
                            </span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gf-heading">
                            {formatDate(access.granted_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="bg-gf-base p-8 rounded-lg border border-gf-border text-center">
                  <div className="text-gf-muted mb-4">
                    <svg className="mx-auto h-12 w-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2 2v-5m16 0h-4.5" />
                    </svg>
                  </div>
                  <p className="text-gf-muted mb-4">{t('modal.noProducts')}</p>
                  <Button onClick={onManageAccess} variant="primary" size="sm">
                    {t('modal.grantAccess')}
                  </Button>
                </div>
              )}
            </ModalSection>
          </div>
        ) : null}
      </ModalBody>

      <ModalFooter>
        <Button onClick={onClose} variant="secondary">
          {t('modal.close')}
        </Button>
        {userProfile && !loading && !error && (
          <Button onClick={onManageAccess} variant="primary">
            {t('modal.manageAccess')}
          </Button>
        )}
      </ModalFooter>
    </BaseModal>
  );
};

export default UserDetailsModal;
