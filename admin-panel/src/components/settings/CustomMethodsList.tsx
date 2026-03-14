'use client';

import { useTranslations } from 'next-intl';
import { GripVertical } from 'lucide-react';
import { useDragOrder } from '@/hooks/useDragOrder';
import { getPaymentMethodDisplayInfo } from '@/lib/utils/payment-method-display';
import type { PaymentMethodMetadata } from '@/types/payment-config';

interface CustomMethodsListProps {
  customPaymentMethods: PaymentMethodMetadata[];
  paymentMethodOrder: string[];
  onToggle: (type: string) => void;
  onOrderChange: (order: string[]) => void;
}

export default function CustomMethodsList({
  customPaymentMethods,
  paymentMethodOrder,
  onToggle,
  onOrderChange,
}: CustomMethodsListProps) {
  const t = useTranslations('settings');
  const drag = useDragOrder(paymentMethodOrder, onOrderChange);

  return (
    <>
      {/* Checkboxes */}
      <div className="mb-8 p-4 bg-sf-raised">
        <label className="block text-sm font-medium text-sf-body mb-3">
          {t('paymentMethods.customConfig.title')}
        </label>
        <div className="space-y-2">
          {customPaymentMethods.map(pm => {
            const info = getPaymentMethodDisplayInfo(pm.type);
            return (
              <label
                key={pm.type}
                className="flex items-center p-3 border-2 border-sf-border-medium hover:bg-sf-hover cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={pm.enabled}
                  onChange={() => onToggle(pm.type)}
                  className="h-4 w-4 text-sf-accent"
                />
                <span className="ml-3 text-2xl">{info.icon}</span>
                <div className="ml-3 flex-1">
                  <div className="font-medium text-sf-heading">{info.name}</div>
                  <div className="text-sm text-sf-body">
                    {pm.currency_restrictions && pm.currency_restrictions.length > 0
                      ? pm.currency_restrictions.join(', ')
                      : t('paymentMethods.customConfig.currencyNote')}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </div>

      {/* Drag-and-drop order */}
      {paymentMethodOrder.length > 0 && (
        <div className="mb-8">
          <label className="block text-sm font-medium text-sf-body mb-3">
            {t('paymentMethods.customConfig.orderTitle')}
          </label>
          <p className="text-sm text-sf-body mb-3">
            {t('paymentMethods.customConfig.orderDescription')}
          </p>
          <div className="space-y-2">
            {paymentMethodOrder.map((type, index) => {
              const info = getPaymentMethodDisplayInfo(type);
              return (
                <div
                  key={type}
                  draggable
                  onDragStart={() => drag.handleDragStart(index)}
                  onDragOver={(e) => drag.handleDragOver(e, index)}
                  onDragEnd={drag.handleDragEnd}
                  className="flex items-center p-3 bg-sf-base border-2 border-sf-border-medium cursor-move hover:border-sf-border-accent transition-colors"
                  style={{ opacity: drag.draggedIndex === index ? 0.5 : 1 }}
                >
                  <GripVertical className="w-5 h-5 text-sf-muted mr-2" />
                  <span className="text-lg font-medium text-sf-body mr-2">{index + 1}.</span>
                  <span className="text-2xl mr-3">{info.icon}</span>
                  <div className="flex-1">
                    <div className="font-medium text-sf-heading">{info.name}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
