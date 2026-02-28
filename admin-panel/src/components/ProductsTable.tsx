'use client';

import React from 'react';
import { Product } from '@/types';
import { formatPrice } from '@/lib/constants';
import { formatUTCForDisplay } from '@/lib/timezone';
import Pagination from './Pagination';
import { getIconEmoji } from '@/utils/themeUtils';
import { useTranslations } from 'next-intl';
import { useLocale } from 'next-intl';
import { useToast } from '@/contexts/ToastContext';

interface ProductsTableProps {
  products: Product[];
  loading: boolean;
  error: string | null;
  onEditProduct: (product: Product) => void;
  onDuplicateProduct: (product: Product) => void;
  onDeleteProduct: (product: Product) => void;
  onPreviewProduct: (product: Product) => void;
  onPreviewRedirect: (product: Product) => void;
  onGenerateCode: (product: Product) => void;
  onToggleStatus: (productId: string, currentStatus: boolean) => void;
  onToggleFeatured: (productId: string, currentFeatured: boolean) => void;
  onToggleListed: (productId: string, currentListed: boolean) => void;
  currentPage: number;
  totalPages: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  limit: number;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  onSort: (column: string) => void;
}

const ProductsTable: React.FC<ProductsTableProps> = ({
  products,
  loading,
  error,
  onEditProduct,
  onDuplicateProduct,
  onDeleteProduct,
  onPreviewProduct,
  onPreviewRedirect,
  onGenerateCode,
  onToggleStatus,
  onToggleFeatured,
  onToggleListed,
  currentPage,
  totalPages,
  totalItems,
  onPageChange,
  limit,
  sortBy,
  sortOrder,
  onSort,
}) => {
  const t = useTranslations('admin.products');
  const locale = useLocale();
  const { addToast } = useToast();
  const startIndex = (currentPage - 1) * limit + 1;
  const endIndex = Math.min(startIndex + products.length - 1, totalItems);

  const SortableHeader = ({ column, title, className = "" }: { column: string; title: string; className?: string }) => (
    <th
      scope="col"
      className={`px-3 py-3 text-left text-xs font-medium text-gf-muted uppercase tracking-wider cursor-pointer whitespace-nowrap ${className}`}
      onClick={() => onSort(column)}
    >
      <div className="flex items-center">
        <span>{title}</span>
        {sortBy === column && (
          <span className="ml-1 flex-shrink-0">
            {sortOrder === 'asc' ? '▲' : '▼'}
          </span>
        )}
      </div>
    </th>
  );

  if (loading) {
    return (
      <div className="text-center py-10">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gf-accent mx-auto"></div>
        <p className="mt-4 text-gf-body">{t('loadingProducts')}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-gf-danger-soft border border-gf-danger text-gf-danger px-4 py-3 rounded-lg" role="alert">
        <strong className="font-bold">{t('error')}:</strong>
        <span className="block sm:inline"> {error}</span>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="text-center py-10 bg-gf-base rounded-lg shadow">
        <h3 className="text-lg font-semibold text-gf-heading">{t('noProducts')}</h3>
        <p className="mt-2 text-sm text-gf-muted">
          {t('noProductsMessage')}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="-my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
        <div className="py-2 align-middle inline-block min-w-full sm:px-6 lg:px-8">
          <div className="shadow-lg overflow-hidden border-b border-gf-border sm:rounded-lg bg-gf-base">
            <table className="min-w-full divide-y divide-gf-border">
              <thead className="bg-gf-raised">
                <tr>
                  <SortableHeader column="name" title={t('name')} />
                  <SortableHeader column="price" title={t('price')} />
                  <SortableHeader column="is_active" title={t('status')} />
                  <SortableHeader column="available_from" title={t('availableFrom')} className="hidden 2xl:table-cell" />
                  <SortableHeader column="available_until" title={t('availableUntil')} className="hidden 2xl:table-cell" />
                  <SortableHeader column="auto_grant_duration_days" title={t('autoDuration')} className="hidden 2xl:table-cell" />
                  <SortableHeader column="created_at" title={t('createdAt')} className="hidden xl:table-cell" />
                  <th scope="col" className="relative px-3 py-3">
                    <span className="sr-only">{t('actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gf-border">
                {products.map((product) => (
                  <tr key={product.id} className="hover:bg-gf-hover transition-colors duration-150">
                    <td className="px-3 py-4">
                      <div className="flex items-center max-w-[300px]">
                        <div className="flex-shrink-0 h-8 w-8">
                          <div className="h-8 w-8 rounded-full bg-gf-raised flex items-center justify-center text-lg">
                            {product.icon?.length === 2 || product.icon?.match(/\p{Emoji}/u) ? product.icon : getIconEmoji(product.icon)}
                          </div>
                        </div>
                        <div className="ml-3 min-w-0 flex-1 overflow-hidden">
                          <div className="flex items-center gap-1">
                            <div className="text-sm font-medium text-gf-heading truncate">{product.name}</div>
                            {product.is_featured && (
                              <span
                                className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gf-warning-soft text-gf-warning flex-shrink-0"
                                title={t('featuredProduct')}
                              >
                                ⭐
                              </span>
                            )}
                            {product.is_listed === false && (
                              <span
                                className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gf-info-soft text-gf-info flex-shrink-0"
                                title={t('unlistedTooltip')}
                              >
                                {t('unlisted')}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-gf-muted truncate">{product.slug}</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                navigator.clipboard.writeText(product.id);
                                addToast(t('idCopied'), 'success', 2000);
                              }}
                              className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] font-mono text-gf-muted hover:text-gf-body hover:bg-gf-raised transition-colors"
                              title={`${t('copyId')}: ${product.id}`}
                            >
                              <span className="hidden sm:inline">{product.id.slice(0, 8)}...</span>
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-4 whitespace-nowrap text-center">
                      {product.price === 0 ? (
                        <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gf-accent-soft text-gf-accent">
                          {t('free')}
                        </span>
                      ) : (
                        <div className="text-sm text-gf-heading">{formatPrice(product.price, product.currency)}</div>
                      )}
                    </td>
                    <td className="px-3 py-4 whitespace-nowrap text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => onToggleStatus(product.id, product.is_active)}
                          className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full cursor-pointer transition-colors hover:opacity-80 ${
                            product.is_active
                              ? 'bg-gf-success-soft text-gf-success'
                              : 'bg-gf-danger-soft text-gf-danger'
                          }`}
                        >
                          {product.is_active ? t('active') : t('inactive')}
                        </button>
                        {!product.is_active && (
                          product.enable_waitlist ? (
                            <span
                              className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gf-accent-soft text-gf-accent"
                              title={t('waitlistEnabled')}
                            >
                              📋
                            </span>
                          ) : (
                            <span
                              className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gf-raised text-gf-muted"
                              title={t('waitlistDisabled')}
                            >
                              🚫
                            </span>
                          )
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-4 text-sm text-gf-muted hidden 2xl:table-cell whitespace-nowrap">
                      {product.available_from ? formatUTCForDisplay(product.available_from, {
                        year: '2-digit',
                        month: 'short',
                        day: 'numeric'
                      }) : '-'}
                    </td>
                    <td className="px-3 py-4 text-sm text-gf-muted hidden 2xl:table-cell whitespace-nowrap">
                      {product.available_until ? formatUTCForDisplay(product.available_until, {
                        year: '2-digit',
                        month: 'short',
                        day: 'numeric'
                      }) : '-'}
                    </td>
                    <td className="px-3 py-4 text-sm text-gf-muted hidden 2xl:table-cell text-center whitespace-nowrap">
                      {product.auto_grant_duration_days ? (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gf-accent-soft text-gf-accent">
                          {product.auto_grant_duration_days}d
                        </span>
                      ) : (
                        <span className="text-gf-muted">∞</span>
                      )}
                    </td>
                    <td className="px-3 py-4 text-sm text-gf-muted hidden xl:table-cell whitespace-nowrap">
                      {formatUTCForDisplay(product.created_at, {
                        year: '2-digit',
                        month: 'short',
                        day: 'numeric'
                      })}
                    </td>
                    <td className="px-3 py-4 text-right text-sm font-medium whitespace-nowrap">
                      <div className="flex items-center justify-end space-x-1">
                        <button
                          onClick={() => onToggleListed(product.id, product.is_listed !== false)}
                          className={`p-1 transition-colors rounded ${
                            product.is_listed !== false
                              ? 'text-gf-muted hover:text-gf-warning'
                              : 'text-gf-warning hover:text-gf-warning'
                          }`}
                          title={product.is_listed !== false ? t('unlistedTooltip') : t('listedEnabled')}
                        >
                          {product.is_listed !== false ? (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
                            </svg>
                          )}
                        </button>
                        <button
                          onClick={() => onToggleFeatured(product.id, product.is_featured)}
                          className={`p-1 transition-colors rounded ${
                            product.is_featured
                              ? 'text-gf-warning hover:text-gf-warning'
                              : 'text-gf-muted hover:text-gf-warning'
                          }`}
                          title={product.is_featured ? t('removeFeatured') : t('setFeatured')}
                        >
                          <svg className="w-4 h-4" fill={product.is_featured ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => onGenerateCode(product)}
                          className="text-gf-accent hover:text-gf-accent transition-colors p-1"
                          aria-label={t('generateCodeLabel', { name: product.name })}
                          title={t('generateCode')}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                          </svg>
                        </button>
                        <button
                          onClick={() => onPreviewProduct(product)}
                          className="text-gf-success hover:text-gf-success transition-colors p-1"
                          aria-label={t('previewLabel', { name: product.name })}
                          title={t('preview')}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => onPreviewRedirect(product)}
                          className="text-gf-accent hover:text-gf-accent transition-colors p-1 hidden sm:block"
                          aria-label={t('previewRedirectLabel', { name: product.name })}
                          title={t('previewRedirect')}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </button>
                        <button
                          onClick={() => onEditProduct(product)}
                          className="text-gf-accent hover:text-gf-accent transition-colors p-1"
                          aria-label={t('editLabel', { name: product.name })}
                          title={t('edit')}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.5L16.732 3.732z"></path>
                          </svg>
                        </button>
                        <button
                          onClick={() => onDuplicateProduct(product)}
                          className="text-gf-success hover:text-gf-success transition-colors p-1"
                          aria-label={t('duplicateLabel', { name: product.name })}
                          title={t('duplicate')}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => onDeleteProduct(product)}
                          className="text-gf-danger hover:text-gf-danger transition-colors p-1"
                          aria-label={t('deleteLabel', { name: product.name })}
                          title={t('delete')}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-3 sm:px-6 border-t border-gf-border">
              <div className="flex items-center justify-between">
                <div className="text-sm text-gf-body">
                  {t('showing')} <span className="font-medium">{startIndex}</span> {t('to')} <span className="font-medium">{endIndex}</span> {t('of')} <span className="font-medium">{totalItems}</span> {t('results')}
                </div>
                <Pagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onPageChange={onPageChange}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductsTable;