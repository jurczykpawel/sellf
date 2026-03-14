'use client';

import { useTranslations } from 'next-intl';
import { GripVertical, Trash2, Plus, X, ChevronDown, ChevronRight } from 'lucide-react';
import { useDragOrder } from '@/hooks/useDragOrder';
import { getPaymentMethodDisplayInfo } from '@/lib/utils/payment-method-display';
import type { PaymentMethodMetadata } from '@/types/payment-config';

const COMMON_CURRENCIES = ['PLN', 'EUR', 'USD', 'GBP'];

interface CurrencyOverridesProps {
  currencyOverrides: Record<string, string[]>;
  customPaymentMethods: PaymentMethodMetadata[];
  paymentMethodOrder: string[];
  showCurrencyOverrides: boolean;
  onToggleShow: (show: boolean) => void;
  onOverridesChange: (updater: (prev: Record<string, string[]>) => Record<string, string[]>) => void;
}

interface CurrencyRowProps {
  currency: string;
  order: string[];
  customPaymentMethods: PaymentMethodMetadata[];
  onOrderChange: (currency: string, order: string[]) => void;
  onRemoveMethod: (currency: string, type: string) => void;
  onRemoveCurrency: (currency: string) => void;
  onAddMethod: (currency: string, type: string) => void;
}

function CurrencyRow({
  currency,
  order,
  customPaymentMethods,
  onOrderChange,
  onRemoveMethod,
  onRemoveCurrency,
  onAddMethod,
}: CurrencyRowProps) {
  const t = useTranslations('settings');
  const drag = useDragOrder(order, (newOrder) => onOrderChange(currency, newOrder));

  const overrideSet = new Set(order);
  const excluded = customPaymentMethods
    .filter(pm => {
      if (!pm.enabled || overrideSet.has(pm.type)) return false;
      const info = getPaymentMethodDisplayInfo(pm.type);
      if (!info.currencies.includes('*') && !info.currencies.includes(currency)) return false;
      return true;
    })
    .sort((a, b) => a.display_order - b.display_order)
    .map(pm => pm.type);

  return (
    <div className="p-3 bg-sf-base border-2 border-sf-border-medium">
      <div className="flex items-center justify-between mb-3">
        <span className="font-medium text-sf-heading flex items-center gap-2">
          <span className="px-2 py-0.5 bg-sf-accent-soft text-sf-accent text-xs">{currency}</span>
          {t('paymentMethods.currencyOverrides.orderFor', { currency })}
        </span>
        <button
          type="button"
          onClick={() => onRemoveCurrency(currency)}
          className="text-sf-muted hover:text-red-500 transition-colors"
          title={t('paymentMethods.currencyOverrides.remove')}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-1">
        {order.map((type, index) => {
          const info = getPaymentMethodDisplayInfo(type);
          return (
            <div
              key={type}
              draggable
              onDragStart={() => drag.handleDragStart(index)}
              onDragOver={(e) => drag.handleDragOver(e, index)}
              onDragEnd={drag.handleDragEnd}
              className="flex items-center p-2 bg-sf-raised cursor-move hover:bg-sf-hover transition-colors"
              style={{ opacity: drag.draggedIndex === index ? 0.5 : 1 }}
            >
              <GripVertical className="w-4 h-4 text-sf-muted mr-2" />
              <span className="text-sm text-sf-body mr-2">{index + 1}.</span>
              <span className="text-lg mr-2">{info.icon}</span>
              <span className="text-sm text-sf-heading flex-1">{info.name}</span>
              <button
                type="button"
                onClick={() => onRemoveMethod(currency, type)}
                className="text-sf-muted hover:text-red-500 transition-colors ml-2"
                title={t('paymentMethods.currencyOverrides.remove')}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      {excluded.length > 0 && (
        <div className="mt-2 pt-2 border-t border-sf-border">
          <span className="text-xs text-sf-muted mb-1 block">
            {t('paymentMethods.currencyOverrides.excludedMethods')}
          </span>
          <div className="flex gap-1 flex-wrap">
            {excluded.map(type => {
              const info = getPaymentMethodDisplayInfo(type);
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => onAddMethod(currency, type)}
                  className="flex items-center gap-1 px-2 py-1 text-xs border border-dashed border-sf-border hover:border-sf-border-accent hover:bg-sf-accent-soft text-sf-body transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  <span>{info.icon}</span>
                  <span>{info.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function CurrencyOverrides({
  currencyOverrides,
  customPaymentMethods,
  paymentMethodOrder,
  showCurrencyOverrides,
  onToggleShow,
  onOverridesChange,
}: CurrencyOverridesProps) {
  const t = useTranslations('settings');

  function addCurrencyOverride(currency: string) {
    if (currencyOverrides[currency]) return;
    onOverridesChange(prev => ({ ...prev, [currency]: [...paymentMethodOrder] }));
  }

  function removeCurrencyOverride(currency: string) {
    onOverridesChange(prev => {
      const next = { ...prev };
      delete next[currency];
      return next;
    });
  }

  function updateCurrencyOrder(currency: string, newOrder: string[]) {
    onOverridesChange(prev => ({ ...prev, [currency]: newOrder }));
  }

  function addMethodToOverride(currency: string, type: string) {
    onOverridesChange(prev => ({ ...prev, [currency]: [...(prev[currency] || []), type] }));
  }

  function removeMethodFromOverride(currency: string, type: string) {
    onOverridesChange(prev => {
      const filtered = (prev[currency] || []).filter(t => t !== type);
      if (filtered.length === 0) {
        const next = { ...prev };
        delete next[currency];
        return next;
      }
      return { ...prev, [currency]: filtered };
    });
  }

  return (
    <div className="mb-8">
      <button
        type="button"
        onClick={() => onToggleShow(!showCurrencyOverrides)}
        className="flex items-center w-full text-left text-sm font-medium text-sf-body mb-3 hover:text-sf-accent transition-colors"
      >
        {showCurrencyOverrides ? (
          <ChevronDown className="w-4 h-4 mr-2" />
        ) : (
          <ChevronRight className="w-4 h-4 mr-2" />
        )}
        {t('paymentMethods.currencyOverrides.title')}
        <span className="ml-2 text-xs text-sf-muted">
          ({t('paymentMethods.currencyOverrides.advanced')})
        </span>
      </button>

      {showCurrencyOverrides && (
        <div className="p-4 bg-sf-raised space-y-4">
          <p className="text-sm text-sf-body">
            {t('paymentMethods.currencyOverrides.description')}
          </p>

          {/* Add currency buttons */}
          <div className="flex gap-2 flex-wrap">
            {COMMON_CURRENCIES.filter(c => !currencyOverrides[c]).map(currency => (
              <button
                key={currency}
                type="button"
                onClick={() => addCurrencyOverride(currency)}
                className="px-3 py-1.5 text-sm border border-dashed border-sf-border hover:border-sf-border-accent hover:bg-sf-accent-soft transition-colors flex items-center gap-1"
              >
                <Plus className="w-3 h-3" />
                {currency}
              </button>
            ))}
          </div>

          {/* Per-currency override rows */}
          {Object.entries(currencyOverrides)
            .filter(([, order]) => Array.isArray(order))
            .map(([currency, order]) => (
              <CurrencyRow
                key={currency}
                currency={currency}
                order={order}
                customPaymentMethods={customPaymentMethods}
                onOrderChange={updateCurrencyOrder}
                onRemoveMethod={removeMethodFromOverride}
                onRemoveCurrency={removeCurrencyOverride}
                onAddMethod={addMethodToOverride}
              />
            ))}

          {Object.keys(currencyOverrides).length === 0 && (
            <p className="text-sm text-sf-muted text-center py-4">
              {t('paymentMethods.currencyOverrides.empty')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
