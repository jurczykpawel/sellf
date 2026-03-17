import { User } from '@supabase/supabase-js'

export type UserRole = 'platform_admin' | 'seller_admin' | 'user'

/**
 * Authentication context type definition with comprehensive state
 */
export interface AuthContextType {
  user: User | null
  /** @deprecated Use role instead */
  isAdmin: boolean
  /** Current user role — single source of truth for navigation, permissions, UI */
  role: UserRole
  loading: boolean
  error: string | null
  signOut: () => Promise<void>
  /** Seller schema name (only when role === 'seller_admin') */
  sellerSchema?: string
  /** Seller slug (only when role === 'seller_admin') */
  sellerSlug?: string
  /** Seller display name (only when role === 'seller_admin') */
  sellerDisplayName?: string
}
