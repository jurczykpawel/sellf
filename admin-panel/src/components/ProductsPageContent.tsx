'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Product } from '@/types';
import FilterBar from './FilterBar';
import ProductsTable from './ProductsTable';
import { useToast } from '@/contexts/ToastContext';
import ProductCreationWizard from './ProductFormModal/wizard/ProductCreationWizard';
import type { ProductFormData } from './ProductFormModal/types';
import CodeGeneratorModal from './CodeGeneratorModal';
import { exportProductsToCsv } from '@/utils/csvExport';
import { useTranslations } from 'next-intl';
import { useSearchParams, useRouter } from 'next/navigation';
import { useProducts } from '@/hooks/useProducts';

const ProductsPageContent: React.FC = () => {
  const { addToast } = useToast();
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const t = useTranslations('admin.products');
  const searchParams = useSearchParams();
  const router = useRouter();

  // State for modals
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  const [showExportConfirmation, setShowExportConfirmation] = useState(false);
  const [showProductForm, setShowProductForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showCodeGenerator, setShowCodeGenerator] = useState(false);
  const [productForCodeGeneration, setProductForCodeGeneration] = useState<Product | null>(null);

  // State for pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [limit] = useState(10);

  // State for filtering and sorting
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Use the v1 API products hook
  const {
    products,
    loading,
    error,
    pagination,
    fetchProducts,
    createProduct,
    updateProduct,
    deleteProduct,
    toggleStatus,
    toggleFeatured,
    toggleListed,
  } = useProducts({
    page: currentPage,
    limit,
    search: debouncedSearchTerm,
    status: statusFilter,
    sortBy,
    sortOrder,
  });

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('asc');
    }
  };

  // Debounce search term to avoid excessive API calls
  useEffect(() => {
    const timerId = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 300);

    return () => {
      clearTimeout(timerId);
    };
  }, [searchTerm]);

  // Fetch products when dependencies change
  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // Open modal if ?open=new query param is present
  useEffect(() => {
    if (searchParams.get('open') === 'new') {
      setShowProductForm(true);
      setEditingProduct(null);
    }
  }, [searchParams]);

  // CRUD Handlers
  const handleCreateProduct = async (formData: ProductFormData) => {
    setSubmitting(true);
    try {
      // Use the v1 API hook to create the product (OTO is handled inside the hook)
      await createProduct(formData);

      setShowProductForm(false);
      // Remove query param if present
      if (searchParams.get('open')) {
        router.replace('/dashboard/products');
      }
      await fetchProducts();
      addToast(t('createSuccess', { name: formData.name }), 'success');
      setTimeout(() => {
        addButtonRef.current?.focus();
      }, 0);
    } catch (err) {
      addToast(err instanceof Error ? err.message : t('createError'), 'error');
      return Promise.reject(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateProduct = async (formData: ProductFormData) => {
    if (!editingProduct) return Promise.reject(new Error('No product selected for editing'));
    setSubmitting(true);
    try {
      // Use the v1 API hook to update the product (OTO is handled inside the hook)
      await updateProduct(editingProduct.id, formData);

      setShowProductForm(false);
      setEditingProduct(null);
      await fetchProducts();
      addToast(t('updateSuccess', { name: formData.name }), 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : t('updateError'), 'error');
      return Promise.reject(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleProductSubmit = async (formData: ProductFormData) => {
    if (editingProduct && editingProduct.id) {
      return handleUpdateProduct(formData);
    } else {
      return handleCreateProduct(formData);
    }
  };

  const confirmDelete = async () => {
    if (!productToDelete) return;

    try {
      // Use the v1 API hook to delete the product
      await deleteProduct(productToDelete.id);

      const productName = productToDelete.name;

      await fetchProducts();
      setProductToDelete(null);

      addToast(t('deleteSuccess', { name: productName }), 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : t('deleteError'), 'error');
    }
  };

  // UI Handlers
  const handleEditProduct = (product: Product) => {
    setEditingProduct(product);
    setShowProductForm(true);
  };

  const handleDuplicateProduct = (product: Product) => {
    // Create a copy of the product with modified name and cleared fields
    const duplicatedProduct: Product = {
      ...product,
      name: `[COPY] ${product.name}`,
      // These will be auto-generated/set by the backend
      id: '' as any, // Will be generated on save
      slug: '', // Will be auto-generated from new name
      created_at: '' as any,
      updated_at: '' as any,
    };
    setEditingProduct(duplicatedProduct);
    setShowProductForm(true);
  };

  const handlePreviewProduct = (product: Product) => {
    window.open(`/p/${product.slug}`, '_blank');
  };

  const handlePreviewRedirect = (product: Product) => {
    if (product.content_delivery_type === 'redirect' && product.content_config?.redirect_url) {
      window.open(product.content_config.redirect_url, '_blank');
    } else {
      addToast(t('noRedirectUrl'), 'warning');
    }
  };

  const handleGenerateCode = (product: Product) => {
    setProductForCodeGeneration(product);
    setShowCodeGenerator(true);
  };

  const handleDeleteProductClick = (product: Product) => {
    setProductToDelete(product);
  };

  const handleToggleStatus = async (productId: string, currentStatus: boolean) => {
    try {
      // Use the v1 API hook to toggle status
      await toggleStatus(productId, currentStatus);

      // Refetch to get updated data
      await fetchProducts();

      addToast(
        !currentStatus ? t('statusActivated') : t('statusDeactivated'),
        'success'
      );
    } catch (err) {
      addToast(t('statusToggleError'), 'error');
    }
  };

  const handleToggleFeatured = async (productId: string, currentFeatured: boolean) => {
    try {
      // Use the v1 API hook to toggle featured status
      await toggleFeatured(productId, currentFeatured);

      // Refetch to get updated data
      await fetchProducts();

      addToast(
        !currentFeatured ? t('featuredEnabled') : t('featuredDisabled'),
        'success'
      );
    } catch (err) {
      addToast(t('featuredToggleError'), 'error');
    }
  };

  const handleToggleListed = async (productId: string, currentListed: boolean) => {
    try {
      await toggleListed(productId, currentListed);
      await fetchProducts();
      addToast(
        !currentListed ? t('listedEnabled') : t('listedDisabled'),
        'success'
      );
    } catch (err) {
      addToast(t('listedToggleError'), 'error');
    }
  };

  const handleAddNewProduct = () => {
    setEditingProduct(null);
    setShowProductForm(true);
  };

  const handleSearchChange = (newSearchTerm: string) => {
    setSearchTerm(newSearchTerm);
    setCurrentPage(1);
  };

  const handleStatusFilterChange = (status: string) => {
    setStatusFilter(status as 'all' | 'active' | 'inactive');
    setCurrentPage(1);
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const handleExportCsv = useCallback(() => {
    if (products.length === 0) {
      addToast(t('noProductsToExport'), 'warning');
      return;
    }
    setShowExportConfirmation(true);
  }, [products, addToast, t]);
  
  const confirmExport = () => {
    const filename = `products_${new Date().toISOString().split('T')[0]}.csv`;
    exportProductsToCsv(products, filename);
    setShowExportConfirmation(false);
    addToast(t('exportSuccess', { count: products.length }), 'success');
  };

  return (
    <div className="space-y-6">
      <h1 className="text-[40px] font-[800] text-gf-heading tracking-[-0.03em] leading-[1.1]">{t('title')}</h1>
      <FilterBar
        searchTerm={searchTerm}
        onSearchChange={handleSearchChange}
        statusFilter={statusFilter}
        onStatusFilterChange={handleStatusFilterChange}
        onAddProduct={handleAddNewProduct}
        onExport={handleExportCsv}
        onRefresh={fetchProducts}
        addButtonRef={addButtonRef}
      />
      <ProductsTable
        products={products}
        loading={loading}
        error={error}
        onEditProduct={handleEditProduct}
        onDuplicateProduct={handleDuplicateProduct}
        onDeleteProduct={handleDeleteProductClick}
        onPreviewProduct={handlePreviewProduct}
        onPreviewRedirect={handlePreviewRedirect}
        onGenerateCode={handleGenerateCode}
        onToggleStatus={handleToggleStatus}
        onToggleFeatured={handleToggleFeatured}
        onToggleListed={handleToggleListed}
        currentPage={pagination.currentPage}
        totalPages={pagination.totalPages}
        totalItems={pagination.totalItems}
        onPageChange={handlePageChange}
        limit={limit}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSort={handleSort}
      />

      {showProductForm && (
        <ProductCreationWizard
          isOpen={showProductForm}
          onClose={() => {
            setShowProductForm(false);
            setEditingProduct(null);
            if (searchParams.get('open')) {
              router.replace('/dashboard/products');
            }
          }}
          onSubmit={handleProductSubmit}
          product={editingProduct}
          isSubmitting={submitting}
          error={null}
        />
      )}

      {productToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm">
          <div
            className="bg-gf-base p-6 w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-gf-heading">{t('confirmDelete')}</h3>
            <p className="mt-2 text-sm text-gf-body">
              {t('deleteConfirmMessage', { name: productToDelete.name })}
            </p>
            <div className="mt-6 flex justify-end space-x-3">
              <button
                onClick={() => setProductToDelete(null)}
                className="px-4 py-2 text-sm font-medium text-gf-body bg-gf-base border-2 border-gf-border-medium hover:bg-gf-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gf-accent"
              >
                {t('cancel')}
              </button>
              <button
                onClick={confirmDelete}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 border border-transparent hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
              >
                {t('delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showExportConfirmation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm">
          <div
            className="bg-gf-base p-6 w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-gf-heading">{t('confirmExport')}</h3>
            <p className="mt-2 text-sm text-gf-body">
              {t('exportConfirmMessage', { count: products.length })}
            </p>
            <div className="mt-6 flex justify-end space-x-3">
              <button
                onClick={() => setShowExportConfirmation(false)}
                className="px-4 py-2 text-sm font-medium text-gf-body bg-gf-base border-2 border-gf-border-medium hover:bg-gf-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gf-accent"
              >
                {t('cancel')}
              </button>
              <button
                onClick={confirmExport}
                className="px-4 py-2 text-sm font-medium text-white bg-gf-accent-bg border border-transparent hover:bg-gf-accent-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gf-accent"
              >
                {t('export')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCodeGenerator && productForCodeGeneration && (
        <CodeGeneratorModal
          isOpen={showCodeGenerator}
          onClose={() => {
            setShowCodeGenerator(false);
            setProductForCodeGeneration(null);
          }}
          product={productForCodeGeneration}
        />
      )}
    </div>
  );
};

export default ProductsPageContent;
