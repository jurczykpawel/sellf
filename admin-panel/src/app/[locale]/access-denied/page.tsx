'use client'

import { useAuth } from '@/contexts/AuthContext'
import { Shield, Home, LogOut } from 'lucide-react'

export default function AccessDenied() {
  const { signOut, user } = useAuth()

  const handleSignOut = async () => {
    await signOut()
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gf-deep">
      <div className="max-w-md w-full mx-auto p-8 bg-gf-raised/80 border border-gf-border rounded-xl shadow-2xl text-center">
        <div className="flex justify-center mb-6">
          <Shield className="h-16 w-16 text-gf-danger" />
        </div>

        <h1 className="text-2xl font-bold text-gf-heading mb-4">
          Access Denied
        </h1>

        <p className="text-gf-body mb-6">
          You don&apos;t have administrator privileges to access this panel.
        </p>

        {user && (
          <div className="mb-6 p-4 bg-gf-float rounded-lg border border-gf-border">
            <p className="text-sm text-gf-body">
              Logged in as: <span className="font-semibold text-gf-heading">{user.email}</span>
            </p>
          </div>
        )}

        <div className="space-y-3">
          <button
            onClick={handleSignOut}
            className="w-full flex items-center justify-center px-4 py-2 bg-gf-danger text-white rounded-xl hover:opacity-90 transition-opacity duration-200"
          >
            <LogOut className="h-4 w-4 mr-2" />
            Sign Out
          </button>

          <button
            onClick={() => window.location.href = '/'}
            className="w-full flex items-center justify-center px-4 py-2 bg-gf-raised border border-gf-border text-gf-heading rounded-xl hover:border-gf-border-accent transition-[border-color] duration-200"
          >
            <Home className="h-4 w-4 mr-2" />
            Go to Homepage
          </button>
        </div>
      </div>
    </div>
  )
}
