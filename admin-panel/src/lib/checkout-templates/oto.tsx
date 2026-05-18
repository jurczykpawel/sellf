import ProductPurchaseView from '@/app/[locale]/checkout/[slug]/components/ProductPurchaseView';
import OtoDeclineButton from '@/components/checkout-templates/OtoDeclineButton';
import type { CheckoutTemplateProps } from './types';

export default function OtoCheckoutTemplate(props: CheckoutTemplateProps) {
  return (
    <ProductPurchaseView
      {...props}
      layoutMode="standalone"
      afterCheckoutSlot={<OtoDeclineButton />}
    />
  );
}
