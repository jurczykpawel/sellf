'use client';

import { createContext, useContext, ReactNode } from 'react';
import type { AdminRole } from '@/lib/auth-server';

interface AdminSchemaContextValue {
  /** 'platform_admin' = full access to everything. 'seller_admin' = scoped to seller schema. */
  role: AdminRole;
  /** PostgreSQL schema name for seller admins (e.g. 'seller_kowalski_digital'). Undefined for platform admins. */
  sellerSchema?: string;
  /** Seller slug (URL-friendly). Undefined for platform admins. */
  sellerSlug?: string;
  /** Seller display name. Undefined for platform admins. */
  sellerDisplayName?: string;
  /** True if this user is a platform admin (not seller admin). */
  isPlatformAdmin: boolean;
  /** True if this user is a seller admin (not platform admin). */
  isSellerAdmin: boolean;
}

const AdminSchemaContext = createContext<AdminSchemaContextValue>({
  role: 'platform_admin',
  isPlatformAdmin: true,
  isSellerAdmin: false,
});

export function AdminSchemaProvider({
  children,
  role,
  sellerSchema,
  sellerSlug,
  sellerDisplayName,
}: {
  children: ReactNode;
  role: AdminRole;
  sellerSchema?: string;
  sellerSlug?: string;
  sellerDisplayName?: string;
}) {
  return (
    <AdminSchemaContext.Provider
      value={{
        role,
        sellerSchema,
        sellerSlug,
        sellerDisplayName,
        isPlatformAdmin: role === 'platform_admin',
        isSellerAdmin: role === 'seller_admin',
      }}
    >
      {children}
    </AdminSchemaContext.Provider>
  );
}

export function useAdminSchema() {
  return useContext(AdminSchemaContext);
}
