// Tip-jar checkout template: BMC-style two-column layout.
// Left  = TipJarSidebar (server-rendered: about + recent supporters).
// Right = existing ProductPurchaseView (PWYW form + custom message + Pay).
//
// Reusing ProductPurchaseView keeps every checkout feature (coupons, bumps,
// PWYW, tax, custom fields from Phase 3a) working for tip-jar without
// duplicating payment-form logic. Future templates that need a fundamentally
// different layout can compose their own — primitives extraction is
// scheduled for Phase 8+.
import ProductPurchaseView from '@/app/[locale]/checkout/[slug]/components/ProductPurchaseView';
import TipJarSidebar from '@/components/checkout-templates/TipJarSidebar';
import type { CheckoutTemplateProps } from './types';
import type { CustomFieldDefinition } from '@/lib/validations/custom-checkout-fields';

// Defaults seeded into product.custom_checkout_fields when admin first picks
// the tip-jar template (see Phase 6 — ProductFormModal). Admin can edit /
// extend after. Kept as a function so future templates can compose with
// product-specific overrides without sharing mutable state.
export function getTipJarDefaultCustomFields(): CustomFieldDefinition[] {
  return [
    {
      id: 'message',
      type: 'textarea',
      label: { en: 'Say something nice', pl: 'Powiedz coś miłego' },
      required: false,
      max_length: 200,
      placeholder: 'Dzięki za projekt!',
    },
  ];
}

export default function TipJarCheckoutTemplate(props: CheckoutTemplateProps) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-sf-deep to-sf-raised p-4 lg:p-8">
      <div className="max-w-6xl mx-auto flex flex-col lg:flex-row gap-8 lg:items-start">
        <TipJarSidebar product={props.product} />
        <div className="flex-1 min-w-0">
          <ProductPurchaseView {...props} layoutMode="embedded" />
        </div>
      </div>
    </div>
  );
}
