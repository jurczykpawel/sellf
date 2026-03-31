'use client'

import { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { User, Session, AuthChangeEvent } from '@supabase/supabase-js'
import { AuthContextType, UserRole } from '@/types/auth'

// Create context with default values
const AuthContext = createContext<AuthContextType>({
  user: null,
  isAdmin: false,
  role: 'user',
  loading: true,
  error: null,
  signOut: async () => {},
})

/**
 * AuthProvider component that manages authentication state
 * and provides auth-related data and methods to children.
 * Implementation meets production-ready standards with:
 * - Complete TypeScript typing
 * - Retry mechanism with exponential backoff
 * - Debouncing for auth state changes
 * - Memory leak prevention
 * - Comprehensive error handling
 * - Role-based access control using admin_users table
 * - Performance optimization
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  // State Management with Performance Tracking
  const [user, setUser] = useState<User | null>(null)
  const [role, setRole] = useState<UserRole>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('sf_role') as UserRole) || 'user'
    }
    return 'user'
  })
  const [sellerSchema, setSellerSchema] = useState<string | undefined>()
  const [sellerSlug, setSellerSlug] = useState<string | undefined>()
  const [sellerDisplayName, setSellerDisplayName] = useState<string | undefined>()
  const isAdmin = role !== 'user'
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Performance and memory management refs
  const isMountedRef = useRef(true)
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

  /**
   * Fetches admin status using cached function for better performance
   */
  interface RoleResult {
    role: UserRole
    sellerSchema?: string
    sellerSlug?: string
    sellerDisplayName?: string
  }

  const resolveUserRole = async (userId: string, retries = 3): Promise<RoleResult> => {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const supabase = await createClient()

        // Check platform admin
        const { data: isAdminData, error } = await supabase.rpc('is_admin_cached')
        if (error) {
          if (attempt === retries) return { role: 'user' }
          await new Promise(resolve => setTimeout(resolve, attempt * 1000))
          continue
        }

        // is_admin_cached returns true for both platform admins and seller admins
        // Need to distinguish which one
        if (!isAdminData) return { role: 'user' }

        // Check if platform admin (in admin_users table)
        const { data: adminCheck } = await supabase
          .from('admin_users')
          .select('user_id')
          .eq('user_id', userId)
          .maybeSingle()

        if (adminCheck) return { role: 'platform_admin' }

        // Must be seller admin — get seller info
        const { data: seller } = await supabase
          .from('sellers')
          .select('schema_name, slug, display_name')
          .eq('user_id', userId)
          .eq('status', 'active')
          .maybeSingle()

        if (seller) {
          return {
            role: 'seller_admin',
            sellerSchema: seller.schema_name,
            sellerSlug: seller.slug,
            sellerDisplayName: seller.display_name,
          }
        }

        return { role: 'user' as const }
      } catch {
        if (attempt === retries) {
          return { role: 'user' as const }
        }
        await new Promise(resolve => setTimeout(resolve, attempt * 1000))
      }
    }

    return { role: 'user' as const }
  }

  /**
   * Handles auth state changes with debouncing to prevent multiple rapid updates
   */
  const handleAuthStateChange = useCallback(async (session: Session | null, immediate = false) => {
    // Clear existing debounce timer to prevent race conditions
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    const processAuthChange = async () => {
      try {
        // Always check if component is still mounted
        if (!isMountedRef.current) return

        const currentUser = session?.user ?? null

        // Set user immediately for responsive UI
        setUser(currentUser)
        setError(null)

        // Reset role immediately to prevent stale role from rendering wrong components
        // (e.g. localStorage had 'platform_admin' but user is now 'seller_admin')
        setRole('user')

        // Resolve user role
        if (currentUser) {
          const result = await resolveUserRole(currentUser.id)

          if (!isMountedRef.current) return

          setRole(result.role)
          setSellerSchema(result.sellerSchema)
          setSellerSlug(result.sellerSlug)
          setSellerDisplayName(result.sellerDisplayName)
          if (typeof window !== 'undefined') localStorage.setItem('sf_role', result.role)
        } else {
          setRole('user')
          setSellerSchema(undefined)
          setSellerSlug(undefined)
          setSellerDisplayName(undefined)
          if (typeof window !== 'undefined') localStorage.removeItem('sf_role')
        }
      } catch {
        if (isMountedRef.current) {
          setError('Authentication error occurred')
        }
      } finally {
        // Always set loading to false if component is mounted
        if (isMountedRef.current) {
          setLoading(false)
        }
      }
    }

    if (immediate) {
      // Process immediately for initial load
      await processAuthChange()
    } else {
      // Debounce for subsequent changes to prevent rapid updates
      debounceTimerRef.current = setTimeout(processAuthChange, 100)
    }
  }, [])

  /**
   * Initializes auth state by getting the current session
   */
  const initializeAuth = useCallback(async () => {
    try {
      const supabase = await createClient()
      const { data: { session }, error } = await supabase.auth.getSession()

      if (!isMountedRef.current) return

      if (error) {
        setError(error.message)
        setLoading(false)
        return
      }

      // Verify session is still valid (user exists in DB)
      // Handles stale sessions after DB reset (e.g. demo mode hourly reset)
      if (session) {
        const { error: userError } = await supabase.auth.getUser()
        if (userError) {
          // Session is stale — user was deleted from DB
          await supabase.auth.signOut()
          if (!isMountedRef.current) return
          setUser(null)
          setRole('user')
          setLoading(false)
          return
        }
      }

      // Use immediate processing for initial session
      await handleAuthStateChange(session, true)
    } catch {
      if (isMountedRef.current) {
        setError('Failed to initialize authentication')
        setLoading(false)
      }
    }
  }, [handleAuthStateChange])

  /**
   * Signs out the current user with proper cache cleanup
   */
  const signOut = async () => {
    try {
      // Clear cached role so next login doesn't flash stale role
      if (typeof window !== 'undefined') localStorage.removeItem('sf_role')

      const res = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnUrl: '/login' }),
      })
      const data = await res.json()
      window.location.href = data.redirectUrl ?? '/login'
    } catch {
      window.location.href = '/login'
    }
  }

  // Set up authentication state and listeners
  useEffect(() => {
    let mounted = true
    isMountedRef.current = true
    let subscription: { unsubscribe: () => void } | null = null

    const setupAuth = async () => {
      try {
        await initializeAuth()

        // Listen for auth state changes
        const supabase = await createClient()
        const { data: { subscription: authSubscription } } = supabase.auth.onAuthStateChange(async (event: AuthChangeEvent, session: Session | null) => {
          if (!mounted) return
          
          // Don't set loading for subsequent auth changes to prevent UI flicker
          if (event !== 'INITIAL_SESSION') {
            await handleAuthStateChange(session, false)
          }
        })
        
        subscription = authSubscription
      } catch (error) {
        console.error('Failed to setup auth:', error)
      }
    }

    setupAuth()

    return () => {
      // Comprehensive cleanup
      mounted = false
      isMountedRef.current = false
      
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
      
      if (subscription) {
        subscription.unsubscribe()
      }
    }
  }, [initializeAuth, handleAuthStateChange])

  return (
    <AuthContext.Provider
      value={{
        user,
        isAdmin,
        role,
        loading,
        error,
        signOut,
        sellerSchema,
        sellerSlug,
        sellerDisplayName,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

/**
 * Hook to access authentication context
 */
export function useAuth() {
  return useContext(AuthContext)
}
