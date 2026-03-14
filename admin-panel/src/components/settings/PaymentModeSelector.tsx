'use client';

import { useTranslations } from 'next-intl';
import SourceBadge from '@/components/ui/SourceBadge';
import type { PaymentConfigMode } from '@/types/payment-config';
import type { ConfigSource } from '@/lib/stripe/checkout-config';

interface PaymentModeSelectorProps {
  configMode: PaymentConfigMode;
  pmSource: ConfigSource;
  pmEnvExists: boolean;
  onChange: (mode: PaymentConfigMode) => void;
}

export default function PaymentModeSelector({
  configMode,
  pmSource,
  pmEnvExists,
  onChange,
}: PaymentModeSelectorProps) {
  const t = useTranslations('settings');

  const modes: { value: PaymentConfigMode; label: string; description: string }[] = [
    {
      value: 'automatic',
      label: t('paymentMethods.mode.automatic'),
      description: t('paymentMethods.mode.automaticDescription'),
    },
    {
      value: 'stripe_preset',
      label: t('paymentMethods.mode.stripePreset'),
      description: t('paymentMethods.mode.stripePresetDescription'),
    },
    {
      value: 'custom',
      label: t('paymentMethods.mode.custom'),
      description: t('paymentMethods.mode.customDescription'),
    },
  ];

  return (
    <div className="mb-8">
      <label className="flex items-center gap-2 text-sm font-medium text-sf-body mb-3">
        {t('paymentMethods.mode.label')}
        <SourceBadge source={pmSource} envAlsoSet={pmEnvExists} />
      </label>
      <div className="space-y-3">
        {modes.map((mode) => (
          <label
            key={mode.value}
            className="flex items-start p-4 border-2 cursor-pointer transition-colors hover:border-sf-border-accent"
            style={{ borderColor: configMode === mode.value ? 'var(--sf-accent)' : '' }}
          >
            <input
              type="radio"
              name="config_mode"
              value={mode.value}
              checked={configMode === mode.value}
              onChange={() => onChange(mode.value)}
              className="mt-1 h-4 w-4 text-sf-accent"
            />
            <div className="ml-3 flex-1">
              <div className="font-medium text-sf-heading">{mode.label}</div>
              <div className="text-sm text-sf-body mt-1">{mode.description}</div>
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}
