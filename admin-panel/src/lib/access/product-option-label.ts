/** Label of a product in the "grant access" picker. @see components/AccessManagementModal.tsx */
import { formatPrice } from '@/lib/constants';

interface OptionProduct { name: string; price: number; currency: string; product_type?: string | null }

/** Subscriptions keep their price in the recurring plan, so a zero `price` there is not "free". */
export function productOptionLabel(product: OptionProduct, locale: string, text: { free: string; subscription: string }): string {
  const detail = product.product_type === 'subscription' ? text.subscription : product.price > 0 ? formatPrice(product.price, product.currency, locale) : text.free;
  return `${product.name} (${detail})`;
}
