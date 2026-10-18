'use client';

import { useTranslations } from 'next-intl';
import type { MoneyInputError as MoneyInputErrorCode } from '@/lib/currency/parse-money-input';

const MESSAGE_KEY: Record<MoneyInputErrorCode, string> = {
  fraction_not_allowed: 'fractionNotAllowed',
  too_many_decimals: 'tooManyDecimals',
  invalid_format: 'invalidFormat',
};

interface MoneyInputErrorProps {
  error: MoneyInputErrorCode | null;
  currency: string;
  className?: string;
}

export function MoneyInputError({ error, currency, className = 'mt-1 text-xs text-sf-danger' }: MoneyInputErrorProps) {
  const t = useTranslations('moneyInput');
  if (!error) return null;
  return <p role="alert" className={className}>{t(MESSAGE_KEY[error], { currency })}</p>;
}
