'use client';

import React from 'react';
import { UserWithAccess } from '@/types';
import Pagination from './Pagination';
import { useTranslations } from 'next-intl';

interface SortableHeaderProps {
  column: string;
  title: string;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  onSort: (column: string) => void;
}

function SortableHeader({ column, title, sortBy, sortOrder, onSort }: SortableHeaderProps) {
  return (
    <th
      scope="col"
      className="px-6 py-3 text-left text-xs font-medium text-sf-muted uppercase tracking-wider cursor-pointer"
      onClick={() => onSort(column)}
    >
      <div className="flex items-center">
        <span>{title}</span>
        {sortBy === column && (
          <span className="ml-1">
            {sortOrder === 'asc' ? '▲' : '▼'}
          </span>
        )}
      </div>
    </th>
  );
}

interface UsersTableProps {
  users: UserWithAccess[];
  loading: boolean;
  error: string | null;
  onViewDetails: (user: UserWithAccess) => void;
  onManageAccess: (user: UserWithAccess) => void;
  onRefresh: () => void;
  currentPage: number;
  totalPages: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  limit: number;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  onSort: (column: string) => void;
}

const UsersTable: React.FC<UsersTableProps> = ({
  users,
  loading,
  error,
  onViewDetails,
  onManageAccess,
  onRefresh,
  currentPage,
  totalPages,
  totalItems,
  onPageChange,
  limit,
  sortBy,
  sortOrder,
  onSort,
}) => {
  const t = useTranslations('admin.users');
  const startIndex = (currentPage - 1) * limit + 1;
  const endIndex = Math.min(startIndex + users.length - 1, totalItems);

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return t('notAvailable');
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const sortProps = { sortBy, sortOrder, onSort };

  if (loading) {
    return (
      <div className="text-center py-10">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sf-accent mx-auto"></div>
        <p className="mt-4 text-sf-body">{t('loadingUsers')}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 m-4" role="alert">
        <strong className="font-bold">{t('error')}:</strong>
        <span className="block sm:inline"> {error}</span>
        <button onClick={onRefresh} className="ml-4 bg-red-200 text-red-800 px-2 py-1">{t('tryAgain')}</button>
      </div>
    );
  }

  if (users.length === 0) {
    return (
      <div className="text-center py-10 bg-sf-base border-2 border-sf-border-medium">
        <h3 className="text-lg font-semibold text-sf-heading">{t('noUsers')}</h3>
        <p className="mt-2 text-sm text-sf-muted">
          {t('noUsersMessage')}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="overflow-x-auto border-2 border-sf-border-medium sm:bg-sf-base">
            <table className="min-w-full divide-y divide-sf-border-subtle">
              <thead className="bg-sf-raised">
                <tr>
                  <SortableHeader column="email" title={t('user')} {...sortProps} />
                  <SortableHeader column="last_sign_in_at" title={t('lastSeen')} {...sortProps} />
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-sf-muted uppercase tracking-wider">
                    {t('productAccess')}
                  </th>
                  <SortableHeader column="total_value" title={t('totalValue')} {...sortProps} />
                  <SortableHeader column="email_confirmed_at" title={t('status')} {...sortProps} />
                  <th scope="col" className="relative px-6 py-3">
                    <span className="sr-only">{t('actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sf-border-subtle">
                {users.map((user, index) => (
                  <tr key={user.id} className={`hover:bg-sf-hover transition-colors duration-150 ${index % 2 === 1 ? 'bg-sf-row-alt' : ''}`}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-10 w-10">
                          <div className="h-10 w-10 bg-sf-accent-bg flex items-center justify-center text-white font-bold">
                            {user.email.charAt(0).toUpperCase()}
                          </div>
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-sf-heading">{user.email}</div>
                          <div className="text-sm text-sf-muted">{t('joined')}: {formatDate(user.created_at)}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-sf-muted">
                      {formatDate(user.last_sign_in_at)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex flex-wrap gap-1">
                        {user.product_access.length > 0 ? (
                          user.product_access.slice(0, 2).map((access) => (
                            <span
                              key={access.product_slug}
                              className="inline-flex items-center px-2.5 py-0.5 text-xs font-medium bg-sf-success-soft text-sf-success"
                            >
                              {access.product_name}
                            </span>
                          ))
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 text-xs font-medium bg-sf-raised text-sf-body">
                            {t('noAccess')}
                          </span>
                        )}
                        {user.product_access.length > 2 && (
                          <span className="inline-flex items-center px-2.5 py-0.5 text-xs font-medium bg-sf-accent-soft text-sf-accent">
                            +{user.product_access.length - 2} {t('more')}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {user.stats && user.stats.total_value > 0 ? (
                        <div className="text-sf-heading">
                          {new Intl.NumberFormat('en-US', {
                            style: 'currency',
                            currency: 'USD',
                          }).format(user.stats.total_value)}
                        </div>
                      ) : (
                        <span className="text-sf-muted">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold ${
                        user.email_confirmed_at
                          ? 'bg-sf-success-soft text-sf-success'
                          : 'bg-sf-warning-soft text-sf-warning'
                      }`}>
                        {user.email_confirmed_at ? t('verified') : t('pending')}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center justify-end space-x-2">
                        <button
                          onClick={() => onViewDetails(user)}
                          className="text-sf-success hover:text-sf-success transition-colors"
                          aria-label={t('viewDetailsLabel', { email: user.email })}
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => onManageAccess(user)}
                          className="text-sf-accent hover:text-sf-accent transition-colors"
                          aria-label={t('manageAccessLabel', { email: user.email })}
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-3 sm:px-6 border-t border-sf-border">
              <div className="flex items-center justify-between">
                <div className="text-sm text-sf-body">
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
  );
};

export default UsersTable;
