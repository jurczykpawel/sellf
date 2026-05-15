import {
  CHECKOUT_TEMPLATE_SLUGS,
  type CheckoutTemplate,
  type CheckoutTemplateSlug,
} from './types';
import DefaultCheckoutTemplate from './default';
import TipJarCheckoutTemplate from './tip-jar';

// Single source of truth for /checkout/<slug> dispatch. Keep ordering — admin
// dropdown iterates in CHECKOUT_TEMPLATE_SLUGS order so 'default' stays first.
const REGISTRY: Record<CheckoutTemplateSlug, CheckoutTemplate> = {
  'default': {
    slug: 'default',
    displayName: 'Default',
    descriptionKey: 'productForm.checkoutTemplate.options.default.description',
    Component: DefaultCheckoutTemplate,
  },
  'tip-jar': {
    slug: 'tip-jar',
    displayName: 'Tip jar',
    descriptionKey: 'productForm.checkoutTemplate.options.tipJar.description',
    Component: TipJarCheckoutTemplate,
  },
};

// Safe lookup: anything not in the registry — typos, stale DB values, null,
// empty — yields the default template. Throwing here would 500 the buyer's
// checkout, which is exactly what the DB CHECK constraint exists to prevent
// in the first place; this is just defense in depth.
export function getTemplate(
  slug: CheckoutTemplateSlug | string | null | undefined,
): CheckoutTemplate {
  const key = slug as CheckoutTemplateSlug;
  return REGISTRY[key] ?? REGISTRY['default'];
}

export function getAllTemplates(): CheckoutTemplate[] {
  return CHECKOUT_TEMPLATE_SLUGS.map((slug) => REGISTRY[slug]);
}
