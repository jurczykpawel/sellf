'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  getPaymentMethodConfig,
  updatePaymentMethodConfig,
  resetToRecommendedConfig,
} from '@/lib/actions/payment-config';
import { getPaymentMethodSourceAction } from '@/lib/actions/stripe-tax';
import type { PaymentConfigMode, PaymentMethodMetadata } from '@/types/payment-config';
import type { ConfigSource } from '@/lib/stripe/checkout-config';

interface UsePaymentMethodConfigReturn {
  loading: boolean;
  saving: boolean;
  resettingToRecommended: boolean;
  configMode: PaymentConfigMode;
  stripePmcId: string;
  stripePmcName: string;
  customPaymentMethods: PaymentMethodMetadata[];
  paymentMethodOrder: string[];
  enableExpressCheckout: boolean;
  enableApplePay: boolean;
  enableGooglePay: boolean;
  enableLink: boolean;
  currencyOverrides: Record<string, string[]>;
  showCurrencyOverrides: boolean;
  pmSource: ConfigSource;
  pmEnvExists: boolean;
  /** Select a Stripe PMC by id and name in one call */
  selectStripePmc: (id: string, name: string) => void;
  setPaymentMethodOrder: (order: string[]) => void;
  /** Update express checkout options (partial — only provided fields change) */
  updateExpressCheckout: (updates: { enabled?: boolean; applePay?: boolean; googlePay?: boolean; link?: boolean }) => void;
  setCurrencyOverrides: (overrides: Record<string, string[]> | ((prev: Record<string, string[]>) => Record<string, string[]>)) => void;
  setShowCurrencyOverrides: (v: boolean) => void;
  handleModeChange: (mode: PaymentConfigMode, loadStripePmcs: () => void) => void;
  togglePaymentMethod: (type: string) => void;
  handleSave: () => Promise<void>;
  handleReset: () => void;
  handleResetToRecommended: () => Promise<void>;
}

export function usePaymentMethodConfig(): UsePaymentMethodConfigReturn {
  const t = useTranslations('settings');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resettingToRecommended, setResettingToRecommended] = useState(false);

  const [configMode, setConfigMode] = useState<PaymentConfigMode>('automatic');
  const [stripePmcId, setStripePmcId] = useState('');
  const [stripePmcName, setStripePmcName] = useState('');
  const [customPaymentMethods, setCustomPaymentMethods] = useState<PaymentMethodMetadata[]>([]);
  const [paymentMethodOrder, setPaymentMethodOrder] = useState<string[]>([]);
  const [enableExpressCheckout, setEnableExpressCheckout] = useState(true);
  const [enableApplePay, setEnableApplePay] = useState(true);
  const [enableGooglePay, setEnableGooglePay] = useState(true);
  const [enableLink, setEnableLink] = useState(true);
  const [currencyOverrides, setCurrencyOverrides] = useState<Record<string, string[]>>({});
  const [showCurrencyOverrides, setShowCurrencyOverrides] = useState(false);
  const [pmSource, setPmSource] = useState<ConfigSource>('default');
  const [pmEnvExists, setPmEnvExists] = useState(false);

  // Auto-sync payment method order when custom methods change
  useEffect(() => {
    if (configMode === 'custom') {
      const enabledTypes = customPaymentMethods
        .filter(pm => pm.enabled)
        .sort((a, b) => a.display_order - b.display_order)
        .map(pm => pm.type);
      setPaymentMethodOrder(enabledTypes);
    }
  }, [customPaymentMethods, configMode]);

  // Auto-sync currency overrides when global methods change
  useEffect(() => {
    if (configMode !== 'custom') return;
    const enabledTypes = new Set(
      customPaymentMethods.filter(pm => pm.enabled).map(pm => pm.type)
    );
    setCurrencyOverrides(prev => {
      const updated: Record<string, string[]> = {};
      let changed = false;
      for (const [currency, order] of Object.entries(prev)) {
        const filtered = order.filter(type => enabledTypes.has(type));
        if (filtered.length !== order.length) changed = true;
        if (filtered.length > 0) {
          updated[currency] = filtered;
        } else {
          changed = true;
        }
      }
      return changed ? updated : prev;
    });
  }, [customPaymentMethods, configMode]);

  function initializeCustomPaymentMethods() {
    const defaults: PaymentMethodMetadata[] = [
      { type: 'card', enabled: true, display_order: 0, currency_restrictions: [] },
      { type: 'blik', enabled: false, display_order: 1, currency_restrictions: ['PLN'] },
      { type: 'p24', enabled: false, display_order: 2, currency_restrictions: ['PLN', 'EUR'] },
      { type: 'sepa_debit', enabled: false, display_order: 3, currency_restrictions: ['EUR'] },
      { type: 'ideal', enabled: false, display_order: 4, currency_restrictions: ['EUR'] },
    ];
    setCustomPaymentMethods(defaults);
  }

  async function loadConfig() {
    try {
      setLoading(true);
      const [config, sourceResult] = await Promise.all([
        getPaymentMethodConfig(),
        getPaymentMethodSourceAction(),
      ]);

      if (sourceResult.success && sourceResult.data) {
        setPmSource(sourceResult.data.source);
        setPmEnvExists(sourceResult.data.envExists);
      }

      if (config) {
        setConfigMode(config.config_mode);
        setStripePmcId(config.stripe_pmc_id || '');
        setStripePmcName(config.stripe_pmc_name || '');
        setCustomPaymentMethods(config.custom_payment_methods || []);
        setPaymentMethodOrder(config.payment_method_order || []);
        setEnableExpressCheckout(config.enable_express_checkout);
        setEnableApplePay(config.enable_apple_pay);
        setEnableGooglePay(config.enable_google_pay);
        setEnableLink(config.enable_link);
        const rawOverrides = config.currency_overrides || {};
        const safeOverrides: Record<string, string[]> = {};
        for (const [k, v] of Object.entries(rawOverrides)) {
          if (Array.isArray(v)) safeOverrides[k] = v;
        }
        setCurrencyOverrides(safeOverrides);
        setShowCurrencyOverrides(Object.keys(safeOverrides).length > 0);

        if (config.config_mode === 'custom' && config.custom_payment_methods.length === 0) {
          initializeCustomPaymentMethods();
        }
      }
    } catch (error) {
      console.error('[usePaymentMethodConfig] Failed to load payment config:', error);
      toast.error(t('paymentMethods.messages.error'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadConfig();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleModeChange(mode: PaymentConfigMode, loadStripePmcs: () => void) {
    setConfigMode(mode);
    if (mode === 'stripe_preset') {
      loadStripePmcs();
    }
    if (mode === 'custom' && customPaymentMethods.length === 0) {
      initializeCustomPaymentMethods();
    }
  }

  function togglePaymentMethod(type: string) {
    setCustomPaymentMethods(prev =>
      prev.map(pm => (pm.type === type ? { ...pm, enabled: !pm.enabled } : pm))
    );
  }

  async function handleSave() {
    try {
      setSaving(true);

      if (configMode === 'stripe_preset' && !stripePmcId) {
        toast.error(t('paymentMethods.validation.noStripePMC'));
        return;
      }

      if (configMode === 'custom') {
        const enabledCount = customPaymentMethods.filter(pm => pm.enabled).length;
        const hasExpressMethod = enableExpressCheckout && (enableLink || enableApplePay || enableGooglePay);
        if (enabledCount === 0 && !hasExpressMethod) {
          toast.error(t('paymentMethods.validation.noMethods'));
          return;
        }
      }

      const result = await updatePaymentMethodConfig({
        config_mode: configMode,
        stripe_pmc_id: configMode === 'stripe_preset' ? stripePmcId : null,
        stripe_pmc_name: configMode === 'stripe_preset' ? stripePmcName : null,
        custom_payment_methods: configMode === 'custom' ? customPaymentMethods : [],
        payment_method_order: paymentMethodOrder,
        currency_overrides: currencyOverrides,
        enable_express_checkout: enableExpressCheckout,
        enable_apple_pay: enableApplePay,
        enable_google_pay: enableGooglePay,
        enable_link: enableLink,
      });

      if (result.success) {
        setPmSource('db');
        toast.success(t('paymentMethods.messages.saveSuccess'));
      } else {
        toast.error(result.error || t('paymentMethods.messages.saveError'));
      }
    } catch (error) {
      console.error('[usePaymentMethodConfig] Failed to save payment config:', error);
      toast.error(t('paymentMethods.messages.saveError'));
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    loadConfig();
    toast.info(t('paymentMethods.messages.configReset'));
  }

  async function handleResetToRecommended() {
    try {
      setResettingToRecommended(true);
      const result = await resetToRecommendedConfig();
      if (result.success) {
        toast.success(t('paymentMethods.messages.resetSuccess'));
        await loadConfig();
      } else {
        toast.error(result.error || t('paymentMethods.messages.error'));
      }
    } catch (error) {
      console.error('[usePaymentMethodConfig] Failed to reset to recommended config:', error);
      toast.error(t('paymentMethods.messages.error'));
    } finally {
      setResettingToRecommended(false);
    }
  }

  return {
    loading,
    saving,
    resettingToRecommended,
    configMode,
    stripePmcId,
    stripePmcName,
    customPaymentMethods,
    paymentMethodOrder,
    enableExpressCheckout,
    enableApplePay,
    enableGooglePay,
    enableLink,
    currencyOverrides,
    showCurrencyOverrides,
    pmSource,
    pmEnvExists,
    selectStripePmc: (id: string, name: string) => {
      setStripePmcId(id);
      setStripePmcName(name);
    },
    setPaymentMethodOrder,
    updateExpressCheckout: (updates: { enabled?: boolean; applePay?: boolean; googlePay?: boolean; link?: boolean }) => {
      if (updates.enabled !== undefined) setEnableExpressCheckout(updates.enabled);
      if (updates.applePay !== undefined) setEnableApplePay(updates.applePay);
      if (updates.googlePay !== undefined) setEnableGooglePay(updates.googlePay);
      if (updates.link !== undefined) setEnableLink(updates.link);
    },
    setCurrencyOverrides,
    setShowCurrencyOverrides,
    handleModeChange,
    togglePaymentMethod,
    handleSave,
    handleReset,
    handleResetToRecommended,
  };
}
