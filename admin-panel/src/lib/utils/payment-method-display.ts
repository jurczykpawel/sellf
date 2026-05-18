import { getAvailablePaymentMethods } from '@/lib/stripe/payment-method-metadata';
import type { PaymentMethodInfo } from '@/types/payment-config';

const availablePaymentMethods: PaymentMethodInfo[] = getAvailablePaymentMethods();

export function getPaymentMethodDisplayInfo(type: string): PaymentMethodInfo {
  return (
    availablePaymentMethods.find(pm => pm.type === type) || {
      type,
      name: type,
      icon: '💳',
      currencies: ['*'],
    }
  );
}
