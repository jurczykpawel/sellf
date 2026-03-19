'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Product } from '@/types';
import FilterBar from './FilterBar';
import ProductsTable from './ProductsTable';
import { toast } from 'sonner';
import ProductCreationWizard from './ProductFormModal/wizard/ProductCreationWizard';
import type { ProductFormData } from './ProductFormModal/types';
import CodeGeneratorModal from './CodeGeneratorModal';
import { exportProductsToCsv } from '@/utils/csvExport';
import { useTranslations } from 'next-intl';
import { useSearchParams, useRouter } from 'next/navigation';
import { useProducts } from '@/hooks/useProducts';
import { useAuth } from '@/contexts/AuthContext';

const ProductsPageContent: React.FC = () => {
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const t = useTranslations('admin.products');
  const searchParams = useSearchParams();
  const router = useRouter();
  const { sellerSlug } = useAuth();

  // Build product URLs based on context: seller uses /s/[slug]/[product], platform uses /p/[product]
  const productPath = (productSlug: string) =>
    sellerSlug ? `/s/${sellerSlug}/${productSlug}` : `/p/${productSlug}`;
  const checkoutPath = (productSlug: string) =>
    sellerSlug ? `/s/${sellerSlug}/checkout/${productSlug}` : `/checkout/${productSlug}`;

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
      toast.success(t('createSuccess', { name: formData.name }));
      setTimeout(() => {
        addButtonRef.current?.focus();
      }, 0);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('createError'));
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
      toast.success(t('updateSuccess', { name: formData.name }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('updateError'));
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

      toast.success(t('deleteSuccess', { name: productName }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('deleteError'));
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
    window.open(`${productPath(product.slug)}?preview=1`, '_blank');
  };

  const handlePreviewRedirect = (product: Product) => {
    if (product.content_delivery_type === 'redirect' && product.content_config?.redirect_url) {
      window.open(product.content_config.redirect_url, '_blank');
    } else {
      toast.warning(t('noRedirectUrl'));
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

      toast.success(!currentStatus ? t('statusActivated') : t('statusDeactivated'));
    } catch (err) {
      toast.error(t('statusToggleError'));
    }
  };

  const handleToggleFeatured = async (productId: string, currentFeatured: boolean) => {
    try {
      // Use the v1 API hook to toggle featured status
      await toggleFeatured(productId, currentFeatured);

      // Refetch to get updated data
      await fetchProducts();

      toast.success(!currentFeatured ? t('featuredEnabled') : t('featuredDisabled'));
    } catch (err) {
      toast.error(t('featuredToggleError'));
    }
  };

  const handleToggleListed = async (productId: string, currentListed: boolean) => {
    try {
      await toggleListed(productId, currentListed);
      await fetchProducts();
      toast.success(!currentListed ? t('listedEnabled') : t('listedDisabled'));
    } catch (err) {
      toast.error(t('listedToggleError'));
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
      toast.warning(t('noProductsToExport'));
      return;
    }
    setShowExportConfirmation(true);
  }, [products, t]);
  
  const confirmExport = () => {
    const filename = `products_${new Date().toISOString().split('T')[0]}.csv`;
    exportProductsToCsv(products, filename);
    setShowExportConfirmation(false);
    toast.success(t('exportSuccess', { count: products.length }));
  };

  return (
    <div className="space-y-6">
      <h1 className="text-[40px] font-[800] text-sf-heading tracking-[-0.03em] leading-[1.1]">{t('title')}</h1>
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
        productPath={productPath}
        checkoutPath={checkoutPath}
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
            className="bg-sf-base p-6 w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-sf-heading">{t('confirmDelete')}</h3>
            <p className="mt-2 text-sm text-sf-body">
              {t('deleteConfirmMessage', { name: productToDelete.name })}
            </p>
            <div className="mt-6 flex justify-end space-x-3">
              <button
                onClick={() => setProductToDelete(null)}
                className="px-4 py-2 text-sm font-medium text-sf-body bg-sf-base border-2 border-sf-border-medium hover:bg-sf-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sf-accent"
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
            className="bg-sf-base p-6 w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-sf-heading">{t('confirmExport')}</h3>
            <p className="mt-2 text-sm text-sf-body">
              {t('exportConfirmMessage', { count: products.length })}
            </p>
            <div className="mt-6 flex justify-end space-x-3">
              <button
                onClick={() => setShowExportConfirmation(false)}
                className="px-4 py-2 text-sm font-medium text-sf-body bg-sf-base border-2 border-sf-border-medium hover:bg-sf-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sf-accent"
              >
                {t('cancel')}
              </button>
              <button
                onClick={confirmExport}
                className="px-4 py-2 text-sm font-medium text-white bg-sf-accent-bg border border-transparent hover:bg-sf-accent-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sf-accent"
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
