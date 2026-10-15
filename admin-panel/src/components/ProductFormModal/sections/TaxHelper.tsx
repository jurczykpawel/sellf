'use client';

import React from 'react';
import { useLocale } from 'next-intl';
import { formatPrice } from '@/lib/constants';
import type { TaxMode } from '@/lib/actions/shop-config';
import type { ProductFormData, TranslationFunction } from '@/components/ProductFormModal/types';

export type TaxHelperMessage =
  | { kind: 'gross'; amount: string }
  | { kind: 'net-to-gross'; net: string; gross: string };

interface ComputeArgs {
  taxMode?: TaxMode;
  price: number;
  vatRate: number | null;
  priceIncludesVat: boolean;
  currency: string;
  locale: string;
}

export function computeTaxHelperMessage(args: ComputeArgs): TaxHelperMessage | null {
  if (args.taxMode !== 'local') return null;
  if (args.price <= 0) return null;
  if (args.vatRate === null || args.vatRate === undefined) return null;

  if (args.priceIncludesVat) {
    return {
      kind: 'gross',
      amount: formatPrice(args.price, args.currency, args.locale),
    };
  }
  const gross = args.price * (1 + args.vatRate / 100);
  return {
    kind: 'net-to-gross',
    net: formatPrice(args.price, args.currency, args.locale),
    gross: formatPrice(gross, args.currency, args.locale),
  };
}

interface TaxHelperProps {
  formData: ProductFormData;
  taxMode?: TaxMode;
  t: TranslationFunction;
}

export function TaxHelper({ formData, taxMode, t }: TaxHelperProps) {
  const locale = useLocale();
  const msg = computeTaxHelperMessage({
    taxMode,
    price: formData.price,
    vatRate: formData.vat_rate ?? null,
    priceIncludesVat: formData.price_includes_vat,
    currency: formData.currency,
    locale,
  });
  if (!msg) return null;

  if (msg.kind === 'gross') {
    return (
      <p className="mt-1 text-xs text-sf-muted" data-testid="tax-helper">
        💡 {t('taxHelper.gross', { amount: msg.amount })}
      </p>
    );
  }
  return (
    <p className="mt-1 text-xs text-sf-muted" data-testid="tax-helper">
      💡 {t('taxHelper.netToGross', { net: msg.net, gross: msg.gross })}
    </p>
  );
}
