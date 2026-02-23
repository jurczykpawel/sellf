'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Higher-order component (HOC) that restricts access to admin users only.
 * Redirects to login page if user is not authenticated.
 * Redirects to access-denied page if user is not an admin.
 * 
 * Uses the updated AuthContext which includes:
 * - Complete TypeScript typing
 * - Retry mechanism with exponential backoff
 * - Debouncing for auth state changes
 * - Memory leak prevention
 * - Comprehensive error handling
 * - Role-based access control
 * - Performance optimization
 */
export function withAdminAuth<T extends object>(Component: React.ComponentType<T>) {
  return function ProtectedComponent(props: T) {
    const { user, isAdmin, loading, error } = useAuth()
    const router = useRouter()
    
    // Handle redirects based on authentication and authorization
    useEffect(() => {
      // Only redirect if authentication data has loaded
      if (!loading) {
        if (!user) {
          router.replace('/login')
        } else if (!isAdmin) {
          router.replace('/access-denied')
        }
      }
    }, [user, loading, isAdmin, router])
    
    // Show error message if there's an auth error
    if (error) {
      return (
        <div className="min-h-screen flex items-center justify-center">
          <div className="bg-red-50 p-4 rounded-lg border border-red-200 max-w-md">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-red-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">Authentication Error</h3>
                <div className="mt-2 text-sm text-red-700">{error}</div>
              </div>
            </div>
          </div>
        </div>
      )
    }
    
    // Show loading spinner while loading or if user is not authenticated/authorized
    if (loading || !user || !isAdmin) {
      return (
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-gf-accent"></div>
        </div>
      )
    }

    // Render the protected component only for authenticated admins
    return <Component {...props} />
  }
}
