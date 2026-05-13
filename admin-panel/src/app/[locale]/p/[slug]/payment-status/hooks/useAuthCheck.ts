import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PaymentStatus, AuthStatus } from '../types';

interface UseAuthCheckParams {
  paymentStatus: PaymentStatus;
  accessGranted: boolean;
}

// Server-side verify-payment is the source of truth for paymentStatus +
// accessGranted. We only resolve the auth flag locally for UI affordances
// (e.g. "go to product" vs "send magic link") — never redirect.
export function useAuthCheck({ paymentStatus, accessGranted }: UseAuthCheckParams): AuthStatus {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  useEffect(() => {
    if (paymentStatus !== 'completed' || !accessGranted) return;
    setIsChecking(true);
    (async () => {
      try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        setIsAuthenticated(!!user);
      } catch (error) {
        console.error('Error checking auth status:', error);
        setIsAuthenticated(false);
      } finally {
        setIsChecking(false);
      }
    })();
  }, [paymentStatus, accessGranted]);

  return { isAuthenticated, isChecking };
}
