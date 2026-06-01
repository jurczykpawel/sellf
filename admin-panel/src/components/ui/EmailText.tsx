'use client'

import { useState, useEffect, useTransition } from 'react'

interface EmailTextProps {
  email: string | null | undefined
  className?: string
}

export function EmailText({ email, className }: EmailTextProps) {
  const [mounted, setMounted] = useState(false)
  const [, startTransition] = useTransition()
  useEffect(() => { startTransition(() => setMounted(true)) }, [])
  if (!mounted || !email) return null
  return <span className={className}>{email}</span>
}
