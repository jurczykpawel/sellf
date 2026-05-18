// Default checkout template = the current /checkout/<slug> behavior. Wraps
// ProductPurchaseView verbatim so this phase is a pure refactor (no UI delta).
import ProductPurchaseView from '@/app/[locale]/checkout/[slug]/components/ProductPurchaseView';
import type { CheckoutTemplateProps } from './types';

export default function DefaultCheckoutTemplate(props: CheckoutTemplateProps) {
  return <ProductPurchaseView {...props} />;
}
