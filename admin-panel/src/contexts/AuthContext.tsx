'use client'

import { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { User, Session, AuthChangeEvent } from '@supabase/supabase-js'
import { AuthContextType } from '@/types/auth'

// Create context with default values
const AuthContext = createContext<AuthContextType>({
  user: null,
  isAdmin: false,
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
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Performance and memory management refs
  const isMountedRef = useRef(true)
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

  /**
   * Fetches admin status using cached function for better performance
   */
  const checkAdminStatus = async (userId: string, retries = 3): Promise<boolean> => {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        // Use cached version for better performance when called repeatedly
        const supabase = await createClient()
        const { data, error } = await supabase.rpc('is_admin_cached')
        
        if (error) {
          if (attempt === retries) {
            return false // Default to non-admin after final attempt
          }
          
          // Exponential backoff: 1s, 2s, 3s
          await new Promise(resolve => setTimeout(resolve, attempt * 1000))
          continue
        }
        
        return Boolean(data)
      } catch {
        if (attempt === retries) {
          return false // Default to non-admin after final attempt
        }
        await new Promise(resolve => setTimeout(resolve, attempt * 1000))
      }
    }
    
    return false // Final fallback
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
        
        // Check admin status if user exists
        if (currentUser) {
          const adminStatus = await checkAdminStatus(currentUser.id)
          
          // Check again after async operation
          if (!isMountedRef.current) return
          
          setIsAdmin(adminStatus)
        } else {
          setIsAdmin(false)
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
          setIsAdmin(false)
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
      // POST (not GET) to prevent logout CSRF via link/image injection.
      // Server clears session cookies before redirect so the proxy doesn't
      // see a valid JWT and 307 back to dashboard.
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
        loading,
        error,
        signOut,
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
