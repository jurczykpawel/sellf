/** Current catalog value of a customer's access, grouped by original currency. */
import { formatPrice } from '@/lib/constants';
interface AccessPrice { product_price?: number; product_currency?: string }
export default function AccessValue({ access, locale }: { access: AccessPrice[]; locale: string }) {
  const totals = access.reduce<Record<string, number>>((values, item) => {
    const currency = item.product_currency?.toUpperCase();
    if (currency) values[currency] = (values[currency] ?? 0) + (item.product_price ?? 0);
    return values;
  }, {});
  return Object.entries(totals).map(([currency, amount]) => <span className="block" key={currency}>{formatPrice(amount, currency, locale)}</span>);
}
