/**
 * Variant Group Form Modal
 *
 * Modal for creating or editing a variant group.
 * Supports M:N relationship where products can belong to multiple groups.
 */

'use client';

import React, { useState, useEffect } from 'react';
import { Product } from '@/types';
import { formatPrice } from '@/lib/constants';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
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

interface SelectedProduct {
  product_id: string;
  name: string;
  slug: string;
  price: number;
  currency: string;
  icon: string | null;
  variant_name: string;
  is_featured: boolean;
  is_active: boolean;
}

interface VariantGroupFormModalProps {
  products: Product[];
  loadingProducts: boolean;
  editingGroup: VariantGroup | null;
  onClose: () => void;
  onSuccess: () => void;
}

const VariantGroupFormModal: React.FC<VariantGroupFormModalProps> = ({
  products,
  loadingProducts,
  editingGroup,
  onClose,
  onSuccess,
}) => {
  const t = useTranslations('admin.variantsPage');

  const [groupName, setGroupName] = useState('');
  const [groupSlug, setGroupSlug] = useState('');
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState<SelectedProduct[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [mobileTab, setMobileTab] = useState<'selected' | 'available'>('selected');

  // Generate slug from text
  const generateSlug = (text: string): string => {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
      .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
      .replace(/\s+/g, '-') // Spaces to hyphens
      .replace(/-+/g, '-') // Multiple hyphens to single
      .replace(/^-|-$/g, ''); // Trim hyphens
  };

  // Set default mobile tab based on mode
  useEffect(() => {
    setMobileTab(editingGroup ? 'selected' : 'available');
  }, [editingGroup]);

  // Initialize with existing group data
  useEffect(() => {
    if (editingGroup) {
      setGroupName(editingGroup.name || '');
      setGroupSlug(editingGroup.slug || '');
      setSlugManuallyEdited(!!editingGroup.slug);
      setSelectedProducts(
        editingGroup.products.map((p) => ({
          product_id: p.product_id,
          name: p.product.name,
          slug: p.product.slug,
          price: p.product.price,
          currency: p.product.currency,
          icon: p.product.icon,
          variant_name: p.variant_name || p.product.name,
          is_featured: p.is_featured,
          is_active: p.product.is_active,
        }))
      );
    }
  }, [editingGroup]);

  // Auto-generate slug from name when name changes (if not manually edited)
  const handleNameChange = (newName: string) => {
    setGroupName(newName);
    if (!slugManuallyEdited) {
      setGroupSlug(generateSlug(newName));
    }
  };

  const handleSlugChange = (newSlug: string) => {
    setGroupSlug(newSlug.toLowerCase().replace(/[^a-z0-9_-]/g, ''));
    setSlugManuallyEdited(true);
  };

  const regenerateSlug = () => {
    setGroupSlug(generateSlug(groupName));
    setSlugManuallyEdited(false);
  };

  // Filter products for selection list
  const availableProducts = products.filter((p) => {
    const isSelected = selectedProducts.some((sp) => sp.product_id === p.id);
    const matchesSearch =
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.slug.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSearch && !isSelected;
  });

  const toggleProduct = (product: Product) => {
    const isSelected = selectedProducts.some((sp) => sp.product_id === product.id);
    if (isSelected) {
      setSelectedProducts((prev) => prev.filter((p) => p.product_id !== product.id));
    } else {
      setSelectedProducts((prev) => [
        ...prev,
        {
          product_id: product.id,
          name: product.name,
          slug: product.slug,
          price: product.price,
          currency: product.currency,
          icon: product.icon,
          variant_name: product.name,
          is_featured: false,
          is_active: product.is_active,
        },
      ]);
      // Switch to selected tab on mobile so user can immediately edit the variant name
      setMobileTab('selected');
    }
  };

  const updateVariantName = (productId: string, name: string) => {
    setSelectedProducts((prev) =>
      prev.map((p) => (p.product_id === productId ? { ...p, variant_name: name } : p))
    );
  };

  const toggleFeatured = (productId: string) => {
    setSelectedProducts((prev) =>
      prev.map((p) => (p.product_id === productId ? { ...p, is_featured: !p.is_featured } : p))
    );
  };

  const removeProduct = (productId: string) => {
    setSelectedProducts((prev) => prev.filter((p) => p.product_id !== productId));
  };

  // Move product up in order
  const moveUp = (index: number) => {
    if (index === 0) return;
    setSelectedProducts((prev) => {
      const newList = [...prev];
      [newList[index - 1], newList[index]] = [newList[index], newList[index - 1]];
      return newList;
    });
  };

  // Move product down in order
  const moveDown = (index: number) => {
    if (index === selectedProducts.length - 1) return;
    setSelectedProducts((prev) => {
      const newList = [...prev];
      [newList[index], newList[index + 1]] = [newList[index + 1], newList[index]];
      return newList;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (selectedProducts.length < 2) {
      toast.error(t('minProductsRequired'));
      return;
    }

    setSubmitting(true);

    try {
      const productsData = selectedProducts.map((p, index) => ({
        product_id: p.product_id,
        variant_name: p.variant_name,
        display_order: index,
        is_featured: p.is_featured
      }));

      if (editingGroup) {
        // Update existing group using v1 API
        await api.update('variant-groups', editingGroup.id, {
          name: groupName || null,
          slug: groupSlug || null,
          products: productsData,
        });

        toast.success(t('updateSuccess'));
      } else {
        // Create new group using v1 API
        await api.create('variant-groups', {
          name: groupName || null,
          slug: groupSlug || null,
          products: productsData,
        });

        toast.success(t('createSuccess'));
      }

      onSuccess();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to save variant group';
      // Use translated message for slug exists error
      if (errorMessage === 'Slug already exists') {
        toast.error(t('slugExists'));
      } else {
        toast.error(errorMessage);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="flex min-h-full items-center justify-center p-4">
      {/* Modal */}
      <div
        className="relative bg-sf-base w-full max-w-4xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-sf-border">
          <h2 className="text-2xl font-bold text-sf-heading">
            {editingGroup ? t('editGroup') : t('createGroup')}
          </h2>
          <p className="text-sf-body mt-1">
            {t('formDescription')}
          </p>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-hidden flex flex-col">
          {/* Group Name & Slug */}
          <div className="px-6 py-4 border-b border-sf-border space-y-4">
            <div>
              <label className="block text-sm font-medium text-sf-body mb-2">
                {t('groupName')}
              </label>
              <input
                type="text"
                placeholder={t('groupNamePlaceholder')}
                value={groupName}
                onChange={(e) => handleNameChange(e.target.value)}
                className="w-full px-4 py-2 border-2 border-sf-border-medium focus:ring-2 focus:ring-sf-accent focus:border-sf-accent bg-sf-input text-sf-heading"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-sf-body mb-2">
                {t('slug', { defaultValue: 'Slug (URL)' })}
              </label>
              <div className="flex space-x-2">
                <div className="flex-1 relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sf-muted">/v/</span>
                  <input
                    type="text"
                    placeholder={t('slugPlaceholder', { defaultValue: 'e.g., subscription-plans' })}
                    value={groupSlug}
                    onChange={(e) => handleSlugChange(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border-2 border-sf-border-medium focus:ring-2 focus:ring-sf-accent focus:border-sf-accent bg-sf-input text-sf-heading font-mono text-sm"
                  />
                </div>
                {slugManuallyEdited && groupName && (
                  <button
                    type="button"
                    onClick={regenerateSlug}
                    className="px-3 py-2 text-sm text-sf-accent hover:bg-sf-accent-soft transition-colors"
                    title={t('regenerateSlug', { defaultValue: 'Regenerate from name' })}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </button>
                )}
              </div>
              <p className="mt-1 text-xs text-sf-muted">
                {t('slugHelp', { defaultValue: 'Optional. Leave empty to use UUID in URL.' })}
              </p>
            </div>
          </div>

          {/* Mobile tab switcher */}
          <div className="flex md:hidden border-b border-sf-border">
            <button
              type="button"
              onClick={() => setMobileTab('selected')}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                mobileTab === 'selected'
                  ? 'text-sf-accent border-b-2 border-sf-accent'
                  : 'text-sf-muted hover:text-sf-body'
              }`}
            >
              {t('selectedProducts')} ({selectedProducts.length})
            </button>
            <button
              type="button"
              onClick={() => setMobileTab('available')}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                mobileTab === 'available'
                  ? 'text-sf-accent border-b-2 border-sf-accent'
                  : 'text-sf-muted hover:text-sf-body'
              }`}
            >
              {t('addProducts')} ({availableProducts.length})
            </button>
          </div>

          <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
            {/* Product List */}
            <div className={`flex-1 p-4 border-r border-sf-border overflow-y-auto ${mobileTab === 'available' ? 'block' : 'hidden'} md:block`}>
              <div className="mb-4">
                <input
                  type="text"
                  placeholder={t('searchProducts')}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full px-4 py-2 border-2 border-sf-border-medium focus:ring-2 focus:ring-sf-accent focus:border-sf-accent bg-sf-input text-sf-heading"
                />
              </div>

              {loadingProducts ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sf-accent"></div>
                </div>
              ) : (
                <div className="space-y-2">
                  {availableProducts.map((product) => (
                    <div
                      key={product.id}
                      onClick={() => toggleProduct(product)}
                      className="p-3 transition-colors bg-sf-raised border-2 border-transparent hover:bg-sf-hover cursor-pointer"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 bg-sf-raised flex items-center justify-center text-lg">
                            {product.icon || '📦'}
                          </div>
                          <div>
                            <div className="font-medium text-sf-heading">
                              {product.name}
                            </div>
                            <div className="text-xs text-sf-muted font-mono">
                              /{product.slug}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          <span className="text-sm font-medium text-sf-body">
                            {formatPrice(product.price, product.currency)}
                          </span>
                          <svg className="w-5 h-5 text-sf-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                        </div>
                      </div>
                    </div>
                  ))}

                  {availableProducts.length === 0 && (
                    <div className="text-center py-8 text-sf-muted">
                      {searchTerm ? t('noProductsFound') : t('allProductsSelected')}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Selected Products with Variant Names */}
            <div className={`w-full md:w-96 p-4 bg-sf-raised overflow-y-auto ${mobileTab === 'selected' ? 'block' : 'hidden'} md:block`}>
              <h3 className="font-semibold text-sf-heading mb-3">
                {t('selectedProducts')} ({selectedProducts.length})
              </h3>

              {selectedProducts.length === 0 ? (
                <p className="text-sm text-sf-muted">
                  {t('selectAtLeastTwo')}
                </p>
              ) : (
                <div className="space-y-3">
                  {selectedProducts.map((product, index) => (
                    <div
                      key={product.product_id}
                      className="bg-sf-base p-3 border-2 border-sf-border-medium"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center space-x-2">
                          <span className="text-xs font-medium text-sf-muted">
                            #{index + 1}
                          </span>
                          {/* Reorder buttons */}
                          <button
                            type="button"
                            onClick={() => moveUp(index)}
                            disabled={index === 0}
                            className="p-1 text-sf-muted hover:text-sf-body disabled:opacity-30"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => moveDown(index)}
                            disabled={index === selectedProducts.length - 1}
                            className="p-1 text-sf-muted hover:text-sf-body disabled:opacity-30"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                        </div>
                        <div className="flex items-center space-x-1">
                          {/* Featured toggle */}
                          <button
                            type="button"
                            onClick={() => toggleFeatured(product.product_id)}
                            className={`p-1 transition-colors ${
                              product.is_featured
                                ? 'text-yellow-500 hover:text-yellow-600'
                                : 'text-sf-muted hover:text-yellow-500'
                            }`}
                            title={product.is_featured ? t('removeFeatured') : t('setFeatured')}
                          >
                            <svg className="w-4 h-4" fill={product.is_featured ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                            </svg>
                          </button>
                          {/* Remove button */}
                          <button
                            type="button"
                            onClick={() => removeProduct(product.product_id)}
                            className="p-1 text-red-500 hover:text-red-700"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                      <div className="text-sm font-medium text-sf-heading mb-2 truncate flex items-center space-x-2">
                        <span>{product.name}</span>
                        {product.is_featured && (
                          <span className="px-1.5 py-0.5 text-xs bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300">
                            {t('featured')}
                          </span>
                        )}
                      </div>
                      <div>
                        <label className="block text-xs text-sf-muted mb-1">
                          {t('variantLabel')}
                        </label>
                        <input
                          type="text"
                          placeholder={t('variantNamePlaceholder')}
                          value={product.variant_name}
                          onChange={(e) => updateVariantName(product.product_id, e.target.value)}
                          className="w-full px-2 py-1.5 text-sm border-2 border-sf-border-medium focus:ring-sf-accent focus:border-sf-accent bg-sf-input text-sf-heading"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {selectedProducts.length > 0 && selectedProducts.length < 2 && (
                <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
                  {t('needMoreProducts')}
                </p>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-sf-border">
            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="px-4 py-2 text-sf-body hover:bg-sf-hover transition-colors disabled:opacity-50"
              >
                {t('cancel')}
              </button>
              <button
                type="submit"
                disabled={submitting || selectedProducts.length < 2}
                className="px-6 py-2 bg-sf-accent-bg text-white hover:bg-sf-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
              >
                {submitting ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    <span>{t('saving')}</span>
                  </>
                ) : (
                  <span>{editingGroup ? t('saveChanges') : t('createGroup')}</span>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
      </div>
    </div>
  );
};

export default VariantGroupFormModal;
