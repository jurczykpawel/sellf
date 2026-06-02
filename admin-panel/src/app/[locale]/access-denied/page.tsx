'use client'

import { useAuth } from '@/contexts/AuthContext'
import { Shield, Home, LogOut } from 'lucide-react'
import { EmailText } from '@/components/ui/EmailText'

export default function AccessDenied() {
  const { signOut, user } = useAuth()

  const handleSignOut = async () => {
    signOut()
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-sf-deep">
      <div className="max-w-md w-full mx-auto p-8 bg-sf-raised/80 border border-sf-border rounded-2xl shadow-[var(--sf-shadow-accent)] text-center">
        <div className="flex justify-center mb-6">
          <Shield className="h-16 w-16 text-sf-danger" />
        </div>

        <h1 className="text-2xl font-bold text-sf-heading mb-4">
          Access Denied
        </h1>

        <p className="text-sf-body mb-6">
          You don&apos;t have administrator privileges to access this panel.
        </p>

        {user && (
          <div className="mb-6 p-4 bg-sf-float rounded-lg border border-sf-border">
            <p className="text-sm text-sf-body">
              Logged in as: <EmailText email={user.email} className="font-semibold text-sf-heading" />
            </p>
          </div>
        )}

        <div className="space-y-3">
          <button
            onClick={handleSignOut}
            className="w-full flex items-center justify-center px-4 py-2 bg-sf-danger-bg text-sf-inverse rounded-full hover:opacity-90 transition-opacity duration-200 active:scale-[0.98]"
          >
            <LogOut className="h-4 w-4 mr-2" />
            Sign Out
          </button>

          <button
            onClick={() => window.location.href = '/'}
            className="w-full flex items-center justify-center px-4 py-2 bg-sf-raised border border-sf-border text-sf-heading rounded-full hover:border-sf-border-accent transition-[border-color] duration-200"
          >
            <Home className="h-4 w-4 mr-2" />
            Go to Homepage
          </button>
        </div>
      </div>
    </div>
  )
}
