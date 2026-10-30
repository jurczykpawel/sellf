import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

const noop = () => {};
export default function Empty(): null { return null; }
export const signOutAndRedirectToCheckout = noop;
export const useSearchParams = () => new URLSearchParams(location.search);
export const useRouter = () => ({ push: noop, replace: noop, refresh: noop, back: noop, forward: noop, prefetch: noop });
export const useAuth = () => ({ user: null, isAdmin: false, loading: false });
export const useConfig = () => ({ stripePublishableKey: 'pk_test_fixture' });
export const useTheme = () => ({ resolvedTheme: 'light' });
export const getTransferAvailability = async () => ({ enabled: false, dueDays: 14 });
export const getStripeClient = () => Promise.resolve(null);
export const useTracking = () => ({ track: noop });
export const useOrderBumps = () => ({ orderBumps: [] });
export const useOto = () => ({});
export const useFreeAccess = () => ({});
export const useCheckoutRedirect = () => ({ hasAccess: false });
export const useCoupon = () => ({ appliedCoupon: null, couponCode: '', setCouponCode: noop, showCouponInput: false, isVerifyingCoupon: false, couponError: null, removeCoupon: noop, handleVerifyCoupon: noop, applyOtoCoupon: noop });
export function useInvoiceData() {
  const [fullName, setFullName] = useState('');
  return { fullName, setFullName, isLoadingProfile: false };
}
export function CheckoutElementsProvider({ children }: { children: ReactNode }): ReactNode { return children; }
export function PaymentElement({ onReady }: { onReady: () => void }): ReactNode {
  useEffect(() => { onReady(); }, [onReady]);
  return <div data-testid="payment-fields">Payment method ready</div>;
}
export function useCheckoutElements() {
  return { type: 'success', checkout: {
    updateEmail: async () => ({ type: 'success' }),
    updateBillingAddress: async () => ({ type: 'success' }),
    confirm: async () => {
      if (new URLSearchParams(location.search).has('decline')) return { type: 'error', error: { message: 'Choose another payment method' } };
      location.assign(new URL('/confirmed', location.href).href);
      return new Promise<never>(() => {});
    },
  } };
}
