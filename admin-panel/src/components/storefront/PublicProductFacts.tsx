/** Shared buyer facts from the bounded public product model. @see lib/storefront-templates/catalogue.ts */
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
import type { ReactElement } from 'react';
import type { PublicPriceInfo, PublicProductInfo } from '@/lib/storefront-templates/catalogue';

export function PublicProductPrice({ price, locale }: { price: PublicPriceInfo; locale: 'en' | 'pl' }): ReactElement {
  const labels = (locale === 'pl' ? pl : en).storefront.product;
  return <>
    {price.originalDisplay && <del className="mr-2 text-sm font-normal text-sf-muted"><span className="sr-only">{labels.regularPrice}: </span>{price.originalDisplay}</del>}
    <span>{price.display}</span>
  </>;
}

export function PublicProductFacts({ product, locale }: { product: PublicProductInfo; locale: 'en' | 'pl' }): ReactElement | null {
  if (!product.eventDateLabel && !product.accessDurationDays && !product.availableUntil) return null;
  const labels = (locale === 'pl' ? pl : en).storefront.product;
  return <p className="col-span-full flex flex-wrap gap-2 text-xs text-sf-body">
    {product.eventDateLabel && <span>{product.eventDateLabel}</span>}
    {product.accessDurationDays && <span className="rounded border border-sf-border px-2 py-1 text-sf-accent">{labels.daysAccessShort.replace('{days}', String(product.accessDurationDays))}</span>}
    {product.availableUntil && product.availableUntilLabel && <time className="max-w-full rounded border border-sf-border px-2 py-1" dateTime={product.availableUntil}>{product.availableUntilLabel}</time>}
  </p>;
}
