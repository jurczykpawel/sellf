'use client';

import React from 'react';
import type { ProductFormData, TranslationFunction } from '../types';
import type { TaxMode } from '@/lib/actions/shop-config';

export type TaxHelperMessage =
  | { kind: 'gross'; amount: string; currency: string }
  | { kind: 'net-to-gross'; net: string; gross: string; currency: string };

interface ComputeArgs {
  taxMode?: TaxMode;
  price: number;
  vatRate: number | null;
  priceIncludesVat: boolean;
  currency: string;
}

export function computeTaxHelperMessage(args: ComputeArgs): TaxHelperMessage | null {
  if (args.taxMode !== 'local') return null;
  if (args.price <= 0) return null;
  if (args.vatRate === null || args.vatRate === undefined) return null;

  if (args.priceIncludesVat) {
    return {
      kind: 'gross',
      amount: args.price.toFixed(2),
      currency: args.currency,
    };
  }
  const gross = args.price * (1 + args.vatRate / 100);
  return {
    kind: 'net-to-gross',
    net: args.price.toFixed(2),
    gross: gross.toFixed(2),
    currency: args.currency,
  };
}

interface TaxHelperProps {
  formData: ProductFormData;
  taxMode?: TaxMode;
  t: TranslationFunction;
}

export function TaxHelper({ formData, taxMode, t }: TaxHelperProps) {
  const msg = computeTaxHelperMessage({
    taxMode,
    price: formData.price,
    vatRate: formData.vat_rate ?? null,
    priceIncludesVat: formData.price_includes_vat,
    currency: formData.currency,
  });
  if (!msg) return null;

  if (msg.kind === 'gross') {
    return (
      <p className="mt-1 text-xs text-sf-muted" data-testid="tax-helper">
        💡 {t('taxHelper.gross', { amount: msg.amount, symbol: msg.currency })}
      </p>
    );
  }
  return (
    <p className="mt-1 text-xs text-sf-muted" data-testid="tax-helper">
      💡 {t('taxHelper.netToGross', { net: msg.net, gross: msg.gross, symbol: msg.currency })}
    </p>
  );
}
