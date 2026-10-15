/** Catalogue presentation contract. @see spec/contracts/section-contract.md */
import { z } from 'zod';
import { sectionSchema } from '@/lib/storefront-templates/schemas';
import { marketingFieldsSchema, productFormatSchema } from '@/lib/validations/product-marketing';
import type { CatalogueGroup, CataloguePage, PublicCategoryInfo } from '@/lib/storefront-templates/catalogue';
import type { TemplateSettings } from '@/lib/storefront-templates/schemas';

export interface CatalogueProps {
  id?: string;
  variant: 'detail-cards' | 'default-groups';
  groups: Partial<Record<CatalogueGroup, CataloguePage>>;
  filters: ('category' | 'price-kind' | 'format')[];
  pageSize: 9 | 12 | 24;
  density: 'comfortable' | 'compact';
  locale: 'en' | 'pl';
  categories?: PublicCategoryInfo[];
}
export const catalogueRequestSchema = z.strictObject({
  locale: z.enum(['en', 'pl']),
  search: z
    .string()
    .transform((v) => v.trim().normalize('NFC'))
    .refine((v) => Array.from(v).length <= 100 && !v.includes('\0')),
  categoryIds: z
    .array(z.uuid())
    .max(12)
    .refine((v) => new Set(v).size === v.length),
  priceKind: z.enum(['free', 'one-time', 'subscription', 'pwyw']).nullable(),
  format: productFormatSchema.nullable(),
  group: z.enum(['all', 'featured', 'free', 'paid']),
  cursor: z
    .string()
    .max(512)
    .regex(/^[A-Za-z0-9_-]+$/)
    .nullable(),
  pageSize: z.union([z.literal(9), z.literal(12), z.literal(24)]),
});
export type CatalogueRequest = z.infer<typeof catalogueRequestSchema>;
const action = z.string().regex(/^\/(en|pl)\/(?:p|checkout)\/[a-zA-Z0-9_-]{1,100}$/);
const product = z.strictObject({
  id: z.uuid(),
  slug: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  title: z.string().refine((value) => Array.from(value).length <= 255),
  price: z.strictObject({
    display: z.string().max(500),
    taxNote: z.string().max(1000).nullable(),
    omnibus: z.string().max(1000).nullable(),
    kind: z.enum(['free', 'one-time', 'subscription', 'pwyw']),
  }),
  marketing: marketingFieldsSchema,
  image: z
    .strictObject({
      src: z
        .url()
        .max(2048)
        .refine((v) => {
          const u = new URL(v);
          return u.protocol === 'https:' && !u.username && !u.password;
        }),
      alt: z.string().refine((value) => Array.from(value).length <= 255),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
    .nullable(),
  actions: z.strictObject({ details: action, buy: action }),
  availability: z.enum(['available', 'unavailable']),
});
export function cataloguePageSchema(pageSize: 9 | 12 | 24) {
  return z.strictObject({ products: z.array(product).max(pageSize), nextCursor: z.string().max(512).nullable() });
}
export function catalogueGroupsSchema(variant: CatalogueProps['variant'], pageSize: CatalogueProps['pageSize']) {
  const page = cataloguePageSchema(pageSize);
  return variant === 'detail-cards'
    ? z.strictObject({ all: page })
    : z.strictObject({ featured: page, free: page, paid: page });
}
export function resolveCatalogue(
  spec: unknown,
  inputs: { locale: 'en' | 'pl'; settings: TemplateSettings; catalogue: CatalogueProps },
): CatalogueProps {
  const parsed = sectionSchema.parse(spec);
  if (parsed.type !== 'catalogue/1') throw new Error('Invalid catalogue section');
  return {
    id: parsed.id,
    variant: parsed.variant,
    groups: catalogueGroupsSchema(parsed.variant, parsed.pageSize).parse(inputs.catalogue.groups),
    filters: parsed.filters,
    pageSize: parsed.pageSize,
    density: inputs.settings.density ?? 'comfortable',
    locale: inputs.locale,
    categories: inputs.catalogue.categories,
  };
}
export const catalogueLabels = {
  en: {
    buy: 'Get access',
    getFree: 'Get free access',
    subscribe: 'Subscribe',
    title: 'All products',
    search: 'Search products',
    submit: 'Search',
    category: 'Categories',
    price: 'Price',
    format: 'Format',
    all: 'All',
    featured: 'Featured',
    free: 'Free products',
    paid: 'Paid products',
    more: 'More products',
    moreFeatured: 'More featured products',
    moreFree: 'More free products',
    morePaid: 'More paid products',
    empty: 'No products match these filters.',
    shown: 'Products shown',
    loading: 'Loading products…',
    error: 'Products could not be loaded.',
    invalid: 'The catalogue changed. Try these filters again.',
    retry: 'Retry',
    details: 'View details',
    requirements: 'Requirements',
    tools: 'Tools',
    reset: 'Clear filters',
    oneTime: 'One-time',
    subscription: 'Subscription',
    pwyw: 'Pay what you want',
    formats: ['Course', 'Workshop', 'Ebook', 'Template', 'Tool', 'Service', 'Bundle', 'Other'],
  },
  pl: {
    buy: 'Uzyskaj dostęp',
    getFree: 'Odbierz bezpłatnie',
    subscribe: 'Subskrybuj',
    title: 'Wszystkie produkty',
    search: 'Szukaj produktów',
    submit: 'Szukaj',
    category: 'Kategorie',
    price: 'Cena',
    format: 'Format',
    all: 'Wszystkie',
    featured: 'Polecane',
    free: 'Bezpłatne produkty',
    paid: 'Płatne produkty',
    more: 'Więcej produktów',
    moreFeatured: 'Więcej polecanych produktów',
    moreFree: 'Więcej bezpłatnych produktów',
    morePaid: 'Więcej płatnych produktów',
    empty: 'Brak produktów dla tych filtrów.',
    shown: 'Wyświetlone produkty',
    loading: 'Ładowanie produktów…',
    error: 'Nie udało się wczytać produktów.',
    invalid: 'Katalog się zmienił. Spróbuj ponownie z tymi filtrami.',
    retry: 'Spróbuj ponownie',
    details: 'Zobacz szczegóły',
    requirements: 'Wymagania',
    tools: 'Narzędzia',
    reset: 'Wyczyść filtry',
    oneTime: 'Jednorazowo',
    subscription: 'Subskrypcja',
    pwyw: 'Zapłać ile chcesz',
    formats: ['Kurs', 'Warsztat', 'Ebook', 'Szablon', 'Narzędzie', 'Usługa', 'Zestaw', 'Inny'],
  },
} as const;
