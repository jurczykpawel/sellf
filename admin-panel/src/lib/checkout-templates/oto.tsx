// OTO checkout template — countdown banner + decline-to-downsell button on
// the same page as the normal purchase form. Same composition pattern as
// tip-jar: reuse ProductPurchaseView in embedded mode and overlay the funnel
// chrome.
//
// The countdown banner is already rendered by ProductPurchaseView via useOto
// when the URL carries ?oto=1&coupon=...&email=..., so this template doesn't
// re-render the banner itself — it only adds the "Nie, dziękuję" affordance.

import ProductPurchaseView from '@/app/[locale]/checkout/[slug]/components/ProductPurchaseView';
import OtoDeclineButton from '@/components/checkout-templates/OtoDeclineButton';
import type { CheckoutTemplateProps } from './types';

export default function OtoCheckoutTemplate(props: CheckoutTemplateProps) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-sf-deep to-sf-raised p-4 lg:p-8">
      <div className="max-w-3xl mx-auto">
        <ProductPurchaseView {...props} layoutMode="embedded" />
        <OtoDeclineButton />
      </div>
    </div>
  );
}
