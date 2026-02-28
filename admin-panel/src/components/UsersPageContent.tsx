'use client';

import React, { useState, useEffect } from 'react';
import { UserWithAccess } from '@/types';
import UsersFilterBar from './UsersFilterBar';
import UsersTable from './UsersTable';
import { useToast } from '@/contexts/ToastContext';
import UserDetailsModal from './UserDetailsModal';
import AccessManagementModal from './AccessManagementModal';
import { useTranslations } from 'next-intl';
import { useUsers } from '@/hooks/useUsers';

const UsersPageContent: React.FC = () => {
  const { addToast } = useToast();
  const t = useTranslations('admin.users');

  // State for modals
  const [selectedUser, setSelectedUser] = useState<UserWithAccess | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showAccessModal, setShowAccessModal] = useState(false);

  // State for pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [limit] = useState(10);

  // State for filtering and sorting
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Use the v1 API users hook
  const {
    users,
    loading,
    error,
    pagination,
    fetchUsers,
  } = useUsers({
    page: currentPage,
    limit,
    search: debouncedSearchTerm,
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

  // Debounce search term
  useEffect(() => {
    const timerId = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 300);

    return () => {
      clearTimeout(timerId);
    };
  }, [searchTerm]);

  // Fetch users when dependencies change
  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // UI Handlers
  const handleViewUserDetails = (user: UserWithAccess) => {
    setSelectedUser(user);
    setShowDetailsModal(true);
  };

  const handleManageAccess = (user: UserWithAccess) => {
    setSelectedUser(user);
    setShowAccessModal(true);
  };

  const handleAccessChange = async () => {
    addToast(t('accessUpdated'), 'success');
    await fetchUsers();
  };

  return (
    <div className="space-y-6">
       <div>
        <h1 className="text-2xl font-bold text-gf-heading">{t('title')}</h1>
        <p className="text-gf-body">{t('description')}</p>
      </div>
      <UsersFilterBar
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        onRefresh={fetchUsers}
      />
      <UsersTable
        users={users}
        loading={loading}
        error={error}
        onViewDetails={handleViewUserDetails}
        onManageAccess={handleManageAccess}
        onRefresh={fetchUsers}
        currentPage={pagination.currentPage}
        totalPages={pagination.totalPages}
        totalItems={pagination.totalItems}
        onPageChange={setCurrentPage}
        limit={limit}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSort={handleSort}
      />

      {selectedUser && (
        <UserDetailsModal
          userId={selectedUser.id}
          isOpen={showDetailsModal}
          onClose={() => {
            setShowDetailsModal(false);
            setSelectedUser(null);
          }}
          onManageAccess={() => {
            setShowDetailsModal(false);
            setShowAccessModal(true);
          }}
        />
      )}

      {/* Access Management Modal */}
      {selectedUser && showAccessModal && (
        <AccessManagementModal
          user={selectedUser}
          isOpen={showAccessModal}
          onClose={() => {
            setShowAccessModal(false);
            setSelectedUser(null);
          }}
          onAccessChange={handleAccessChange}
        />
      )}
    </div>
  );
};

export default UsersPageContent;
