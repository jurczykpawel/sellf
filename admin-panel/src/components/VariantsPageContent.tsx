/**
 * Variants Management Page Component
 *
 * Manages product variant groups - allowing products to be linked as variants
 * (e.g., different sizes, colors, or editions of the same product).
 *
 * Uses M:N relationship where products can belong to multiple variant groups.
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Product } from '@/types';
import { useToast } from '@/contexts/ToastContext';
import { useTranslations } from 'next-intl';
import { formatPrice } from '@/lib/constants';
import VariantGroupFormModal from './VariantGroupFormModal';
import { api } from '@/lib/api/client';

interface ProductInGroup {
  id: string;
  product_id: string;
  group_id: string;
  variant_name: string | null;
  display_order: number;
  is_featured: boolean;
  created_at: string;
  product: {
    id: string;
    name: string;
    slug: string;
    price: number;
    currency: string;
    icon: string | null;
    is_active: boolean;
  };
}

interface VariantGroup {
  id: string;
  name: string | null;
  slug: string | null;
  created_at: string;
  updated_at: string;
  products: ProductInGroup[];
}

const VariantsPageContent: React.FC = () => {
  const { addToast } = useToast();
  const t = useTranslations('admin.variantsPage');

  // State for variant groups and loading
  const [groups, setGroups] = useState<VariantGroup[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // State for modals
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingGroup, setEditingGroup] = useState<VariantGroup | null>(null);
  const [groupToDelete, setGroupToDelete] = useState<VariantGroup | null>(null);
  const [productToRemove, setProductToRemove] = useState<{ group: VariantGroup; product: ProductInGroup } | null>(null);

  // Fetch all products for the form using v1 API
  const fetchProducts = useCallback(async () => {
    try {
      setLoadingProducts(true);
      const response = await api.list<Product>('products', {
        limit: 1000,
        sort: 'name',
      });
      setAllProducts(response.data || []);
    } catch (err) {
      console.error('Error fetching products:', err);
    } finally {
      setLoadingProducts(false);
    }
  }, []);

  // Fetch variant groups using v1 API
  const fetchGroups = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const groups = await api.getCustom<VariantGroup[]>('variant-groups');
      setGroups(groups || []);
    } catch (err) {
      setError(t('loadError'));
      console.error('Error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial data fetch
  useEffect(() => {
    fetchGroups();
    fetchProducts();
  }, [fetchGroups, fetchProducts]);

  // Delete entire group using v1 API
  const handleDeleteGroup = async (group: VariantGroup) => {
    try {
      await api.delete('variant-groups', group.id);
      setGroupToDelete(null);
      await fetchGroups();
      addToast(t('deleteSuccess'), 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : t('deleteGroupError'), 'error');
    }
  };

  // Remove single product from group using v1 API
  const handleRemoveProduct = async (group: VariantGroup, productToRemove: ProductInGroup) => {
    // If removing would leave less than 2 products, delete the whole group
    if (group.products.length <= 2) {
      await handleDeleteGroup(group);
      setProductToRemove(null);
      return;
    }

    try {
      const remainingProducts = group.products
        .filter(p => p.product_id !== productToRemove.product_id)
        .map((p, index) => ({
          product_id: p.product_id,
          variant_name: p.variant_name,
          display_order: index,
          is_featured: p.is_featured
        }));

      await api.update('variant-groups', group.id, { products: remainingProducts });

      setProductToRemove(null);
      await fetchGroups();
      addToast(t('removeSuccess'), 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : t('removeProductError'), 'error');
    }
  };

  // Toggle featured status using v1 API
  const handleToggleFeatured = async (group: VariantGroup, product: ProductInGroup) => {
    try {
      const updatedProducts = group.products.map(p => ({
        product_id: p.product_id,
        variant_name: p.variant_name,
        display_order: p.display_order,
        is_featured: p.product_id === product.product_id ? !p.is_featured : p.is_featured
      }));

      await api.update('variant-groups', group.id, { products: updatedProducts });

      await fetchGroups();
      addToast(t('featuredUpdated'), 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : t('updateError'), 'error');
    }
  };

  // Copy variant selector page link (prefer slug over ID)
  const copyVariantLink = (group: VariantGroup) => {
    const baseUrl = window.location.origin;
    const link = `${baseUrl}/v/${group.slug || group.id}`;
    navigator.clipboard.writeText(link);
    addToast(t('linkCopied'), 'success');
  };

  // Get stats
  const totalProducts = groups.reduce((sum, g) => sum + g.products.length, 0);
  const uniqueProductIds = new Set(groups.flatMap(g => g.products.map(p => p.product_id)));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-[40px] font-[800] text-gf-heading tracking-[-0.03em] leading-[1.1]">
            {t('title')}
          </h1>
          <p className="text-gf-body mt-2">
            {t('description')}
          </p>
        </div>
        {/* Only show header button when there are existing groups (empty state has its own CTA) */}
        {groups.length > 0 && (
          <button
            onClick={() => {
              setEditingGroup(null);
              setShowFormModal(true);
            }}
            className="px-4 py-2 bg-gf-accent-bg text-white hover:bg-gf-accent-hover transition-colors flex items-center space-x-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>{t('createGroup')}</span>
          </button>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-gf-base border-2 border-gf-border-medium p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gf-body">{t('stats.totalGroups')}</p>
              <p className="text-[40px] font-[800] text-gf-heading tracking-[-0.03em] leading-[1.1] mt-1">
                {groups.length}
              </p>
            </div>
            <div className="w-12 h-12 bg-gf-accent-soft flex items-center justify-center">
              <svg className="w-6 h-6 text-gf-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
          </div>
        </div>

        <div className="bg-gf-base border-2 border-gf-border-medium p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gf-body">{t('stats.totalAssignments')}</p>
              <p className="text-[40px] font-[800] text-gf-heading tracking-[-0.03em] leading-[1.1] mt-1">
                {totalProducts}
              </p>
            </div>
            <div className="w-12 h-12 bg-gf-accent-soft flex items-center justify-center">
              <svg className="w-6 h-6 text-gf-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
            </div>
          </div>
        </div>

        <div className="bg-gf-base border-2 border-gf-border-medium p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gf-body">{t('stats.uniqueProducts')}</p>
              <p className="text-[40px] font-[800] text-gf-heading tracking-[-0.03em] leading-[1.1] mt-1">
                {uniqueProductIds.size}
              </p>
            </div>
            <div className="w-12 h-12 bg-gf-success-soft flex items-center justify-center">
              <svg className="w-6 h-6 text-gf-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Variant Groups List */}
      <div className="space-y-4">
        {loading ? (
          <div className="bg-gf-base border-2 border-gf-border-medium p-12">
            <div className="flex items-center justify-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gf-accent"></div>
            </div>
          </div>
        ) : error ? (
          <div className="bg-gf-base border-2 border-gf-border-medium p-12">
            <div className="text-center text-red-500">{error}</div>
          </div>
        ) : groups.length === 0 ? (
          <div className="bg-gf-base border-2 border-gf-border-medium p-12">
            <div className="text-center">
              <div className="w-16 h-16 bg-gf-raised flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-gf-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gf-heading mb-2">
                {t('noGroups')}
              </h3>
              <p className="text-gf-muted mb-4">
                {t('noGroupsDescription')}
              </p>
              <button
                onClick={() => {
                  setEditingGroup(null);
                  setShowFormModal(true);
                }}
                className="px-4 py-2 bg-gf-accent-bg text-white hover:bg-gf-accent-hover transition-colors"
              >
                {t('createGroup')}
              </button>
            </div>
          </div>
        ) : (
          groups.map((group) => (
            <div
              key={group.id}
              className="bg-gf-base border-2 border-gf-border-medium overflow-hidden"
            >
              {/* Group Header */}
              <div className="px-6 py-4 bg-gf-raised border-b border-gf-border flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-gf-accent-soft flex items-center justify-center">
                    <svg className="w-5 h-5 text-gf-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-gf-heading">
                      {group.name || t('unnamedGroup')} ({group.products.length} {t('products')})
                    </h3>
                    <p className="text-xs text-gf-muted font-mono">
                      {group.slug ? `/v/${group.slug}` : `ID: ${group.id.slice(0, 8)}...`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <a
                    href={`/v/${group.slug || group.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 text-gf-muted hover:text-gf-success transition-colors"
                    title={t('openLink')}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                  <button
                    onClick={() => copyVariantLink(group)}
                    className="p-2 text-gf-muted hover:text-gf-accent transition-colors"
                    title={t('copyLink')}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => {
                      setEditingGroup(group);
                      setShowFormModal(true);
                    }}
                    className="p-2 text-gf-muted hover:text-gf-accent transition-colors"
                    title={t('edit')}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setGroupToDelete(group)}
                    className="p-2 text-gf-muted hover:text-gf-danger transition-colors"
                    title={t('deleteGroup')}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Products List */}
              <div className="divide-y divide-gf-border">
                {group.products.map((item, index) => (
                  <div
                    key={item.id}
                    className={`px-6 py-4 flex items-center justify-between hover:bg-gf-hover transition-colors ${index % 2 === 1 ? 'bg-gf-row-alt' : ''}`}
                  >
                    <div className="flex items-center space-x-4">
                      <span className="text-sm font-medium text-gf-muted w-6">
                        #{index + 1}
                      </span>
                      <div className="w-10 h-10 bg-gf-raised flex items-center justify-center text-xl">
                        {item.product.icon || '📦'}
                      </div>
                      <div>
                        <div className="flex items-center space-x-2">
                          <a
                            href={`/p/${item.product.slug}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-gf-heading hover:text-gf-accent transition-colors"
                          >
                            {item.variant_name || item.product.name}
                          </a>
                          {item.variant_name && item.variant_name !== item.product.name && (
                            <span className="px-2 py-0.5 text-xs bg-gf-raised text-gf-muted">
                              {item.product.name}
                            </span>
                          )}
                          {item.is_featured && (
                            <span className="px-2 py-0.5 text-xs bg-gf-warning-soft text-gf-warning">
                              {t('featured')}
                            </span>
                          )}
                          {!item.product.is_active && (
                            <span className="px-2 py-0.5 text-xs bg-gf-raised text-gf-muted">
                              {t('inactive')}
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-gf-muted font-mono">
                          /{item.product.slug}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-4">
                      <span className="text-sm font-semibold text-gf-heading">
                        {formatPrice(item.product.price, item.product.currency)}
                      </span>
                      <button
                        onClick={() => handleToggleFeatured(group, item)}
                        className={`p-1.5 transition-colors ${
                          item.is_featured
                            ? 'text-yellow-500 hover:text-yellow-600'
                            : 'text-gf-muted hover:text-yellow-500'
                        }`}
                        title={item.is_featured ? t('removeFeatured') : t('setFeatured')}
                      >
                        <svg className="w-4 h-4" fill={item.is_featured ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => setProductToRemove({ group, product: item })}
                        className="p-1.5 text-gf-muted hover:text-gf-danger transition-colors"
                        title={t('removeProduct')}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Create/Edit Form Modal */}
      {showFormModal && (
        <VariantGroupFormModal
          products={allProducts}
          loadingProducts={loadingProducts}
          editingGroup={editingGroup}
          onClose={() => {
            setShowFormModal(false);
            setEditingGroup(null);
          }}
          onSuccess={() => {
            setShowFormModal(false);
            setEditingGroup(null);
            fetchGroups();
          }}
        />
      )}

      {/* Delete Group Confirmation Modal */}
      {groupToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setGroupToDelete(null)}
          />
          <div className="relative bg-gf-base max-w-md w-full p-6 border-2 border-gf-border-medium">
            <h3 className="text-lg font-bold text-gf-heading mb-4">
              {t('confirmDeleteGroup')}
            </h3>
            <p className="text-gf-body mb-6">
              {t('deleteGroupMessage', { count: groupToDelete.products.length })}
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setGroupToDelete(null)}
                className="px-4 py-2 text-gf-body hover:bg-gf-hover transition-colors"
              >
                {t('cancel')}
              </button>
              <button
                onClick={() => handleDeleteGroup(groupToDelete)}
                className="px-4 py-2 bg-red-600 text-white hover:bg-red-700 transition-colors"
              >
                {t('delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remove Product Confirmation Modal */}
      {productToRemove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setProductToRemove(null)}
          />
          <div className="relative bg-gf-base max-w-md w-full p-6 border-2 border-gf-border-medium">
            <h3 className="text-lg font-bold text-gf-heading mb-4">
              {t('confirmRemoveProduct')}
            </h3>
            <p className="text-gf-body mb-6">
              {productToRemove.group.products.length <= 2
                ? t('removeProductWillDeleteGroup', { name: productToRemove.product.product.name })
                : t('removeProductMessage', { name: productToRemove.product.product.name })}
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setProductToRemove(null)}
                className="px-4 py-2 text-gf-body hover:bg-gf-hover transition-colors"
              >
                {t('cancel')}
              </button>
              <button
                onClick={() => handleRemoveProduct(productToRemove.group, productToRemove.product)}
                className="px-4 py-2 bg-red-600 text-white hover:bg-red-700 transition-colors"
              >
                {t('remove')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VariantsPageContent;
