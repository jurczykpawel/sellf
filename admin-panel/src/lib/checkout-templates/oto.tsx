// Standalone (not embedded) so direct visits still show product header/price.
// Countdown + decline render themselves conditionally on ?oto=1 URL params.
import ProductPurchaseView from '@/app/[locale]/checkout/[slug]/components/ProductPurchaseView';
import OtoDeclineButton from '@/components/checkout-templates/OtoDeclineButton';
import type { CheckoutTemplateProps } from './types';

export default function OtoCheckoutTemplate(props: CheckoutTemplateProps) {
  return (
    <>
      <ProductPurchaseView {...props} layoutMode="standalone" />
      <div className="max-w-3xl mx-auto px-4 pb-8">
        <OtoDeclineButton />
      </div>
    </>
  );
}
