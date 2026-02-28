/**
 * Payment Method Configuration Settings
 *
 * Admin UI for configuring global payment method settings.
 * Supports three modes: automatic, Stripe preset, custom
 *
 * @see /supabase/migrations/20260116000000_payment_method_configuration.sql
 * @see /admin-panel/src/lib/actions/payment-config.ts
 *
 * SECURITY: XSS Protection
 * - All string values (stripe_pmc_name, payment method labels) are rendered
 *   via JSX which auto-escapes HTML entities by default
 * - No dangerouslySetInnerHTML is used in this component
 * - User input is validated via Zod schemas before storage (see payment-config.ts)
 */

'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useToast } from '@/contexts/ToastContext';
import {
  getPaymentMethodConfig,
  updatePaymentMethodConfig,
  getStripePaymentMethodConfigsCached,
  refreshStripePaymentMethodConfigs,
  resetToRecommendedConfig,
} from '@/lib/actions/payment-config';
import { getPaymentMethodSourceAction } from '@/lib/actions/stripe-tax';
import { getAvailablePaymentMethods, KNOWN_PAYMENT_METHODS } from '@/lib/stripe/payment-method-configs';
import SourceBadge from '@/components/ui/SourceBadge';
import type {
  PaymentMethodConfig,
  PaymentConfigMode,
  PaymentMethodMetadata,
  StripePaymentMethodConfig,
  PaymentMethodInfo,
} from '@/types/payment-config';
import type { ConfigSource } from '@/lib/stripe/checkout-config';
import { RefreshCw, AlertTriangle, Check, GripVertical, RotateCcw, ChevronDown, ChevronRight, Plus, Trash2, X } from 'lucide-react';

export default function PaymentMethodSettings() {
  const { addToast } = useToast();
  const t = useTranslations('settings');

  // State
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [resettingToRecommended, setResettingToRecommended] = useState(false);

  const [configMode, setConfigMode] = useState<PaymentConfigMode>('automatic');
  const [stripePmcId, setStripePmcId] = useState<string>('');
  const [stripePmcName, setStripePmcName] = useState<string>('');
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

  // Stripe PMCs
  const [stripePmcs, setStripePmcs] = useState<StripePaymentMethodConfig[]>([]);
  const [stripePmcsLoading, setStripePmcsLoading] = useState(false);

  // Available payment methods metadata
  const [availablePaymentMethods] = useState<PaymentMethodInfo[]>(getAvailablePaymentMethods());

  // Drag and drop state
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  // Load initial config
  useEffect(() => {
    loadConfig();
  }, []);

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

        // Initialize custom payment methods if empty
        if (config.config_mode === 'custom' && config.custom_payment_methods.length === 0) {
          initializeCustomPaymentMethods();
        }
      }
    } catch (error) {
      console.error('Failed to load payment config:', error);
      addToast(t('paymentMethods.messages.error'), 'error');
    } finally {
      setLoading(false);
    }
  }

  // Initialize custom payment methods with common defaults
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

  // Load Stripe PMCs
  async function loadStripePmcs() {
    try {
      setStripePmcsLoading(true);
      const result = await getStripePaymentMethodConfigsCached();
      if (result.success && result.data) {
        setStripePmcs(result.data);
      } else {
        addToast(result.error || t('paymentMethods.stripeConfig.error'), 'error');
      }
    } catch (error) {
      console.error('Failed to load Stripe PMCs:', error);
      addToast(t('paymentMethods.stripeConfig.error'), 'error');
    } finally {
      setStripePmcsLoading(false);
    }
  }

  // Refresh Stripe PMCs (force cache invalidation)
  async function handleRefreshStripePmcs() {
    try {
      setRefreshing(true);
      const result = await refreshStripePaymentMethodConfigs();
      if (result.success) {
        await loadStripePmcs();
        addToast(t('paymentMethods.messages.refreshSuccess'), 'success');
      } else {
        addToast(result.error || t('paymentMethods.stripeConfig.error'), 'error');
      }
    } catch (error) {
      console.error('Failed to refresh Stripe PMCs:', error);
      addToast(t('paymentMethods.stripeConfig.error'), 'error');
    } finally {
      setRefreshing(false);
    }
  }

  // Save configuration
  async function handleSave() {
    try {
      setSaving(true);

      // Validation
      if (configMode === 'stripe_preset' && !stripePmcId) {
        addToast(t('paymentMethods.validation.noStripePMC'), 'error');
        return;
      }

      if (configMode === 'custom') {
        const enabledCount = customPaymentMethods.filter((pm) => pm.enabled).length;
        const hasExpressMethod = enableExpressCheckout && (enableLink || enableApplePay || enableGooglePay);
        if (enabledCount === 0 && !hasExpressMethod) {
          addToast(t('paymentMethods.validation.noMethods'), 'error');
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
        addToast(t('paymentMethods.messages.saveSuccess'), 'success');
      } else {
        addToast(result.error || t('paymentMethods.messages.saveError'), 'error');
      }
    } catch (error) {
      console.error('Failed to save payment config:', error);
      addToast(t('paymentMethods.messages.saveError'), 'error');
    } finally {
      setSaving(false);
    }
  }

  // Reset to current saved config
  function handleReset() {
    loadConfig();
    addToast(t('paymentMethods.messages.configReset'), 'info');
  }

  // Reset to recommended configuration
  async function handleResetToRecommended() {
    try {
      setResettingToRecommended(true);
      const result = await resetToRecommendedConfig();
      if (result.success) {
        addToast(t('paymentMethods.messages.resetSuccess'), 'success');
        await loadConfig();
      } else {
        addToast(result.error || t('paymentMethods.messages.error'), 'error');
      }
    } catch (error) {
      console.error('Failed to reset to recommended config:', error);
      addToast(t('paymentMethods.messages.error'), 'error');
    } finally {
      setResettingToRecommended(false);
    }
  }

  // Handle mode change
  function handleModeChange(mode: PaymentConfigMode) {
    setConfigMode(mode);

    // Load Stripe PMCs when switching to stripe_preset mode
    if (mode === 'stripe_preset' && stripePmcs.length === 0) {
      loadStripePmcs();
    }

    // Initialize custom methods when switching to custom mode
    if (mode === 'custom' && customPaymentMethods.length === 0) {
      initializeCustomPaymentMethods();
    }
  }

  // Toggle payment method enabled state
  function togglePaymentMethod(type: string) {
    setCustomPaymentMethods((prev) =>
      prev.map((pm) => (pm.type === type ? { ...pm, enabled: !pm.enabled } : pm))
    );
  }

  // Update payment method order via drag and drop
  function handleDragStart(index: number) {
    setDraggedIndex(index);
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const newOrder = [...paymentMethodOrder];
    const draggedItem = newOrder[draggedIndex];
    newOrder.splice(draggedIndex, 1);
    newOrder.splice(index, 0, draggedItem);

    setPaymentMethodOrder(newOrder);
    setDraggedIndex(index);
  }

  function handleDragEnd() {
    setDraggedIndex(null);
  }

  // Get payment method info
  function getPaymentMethodDisplayInfo(type: string): PaymentMethodInfo {
    return (
      availablePaymentMethods.find((pm) => pm.type === type) || {
        type,
        name: type,
        icon: '💳',
        currencies: ['*'],
      }
    );
  }

  // Update payment method order when custom methods change
  useEffect(() => {
    if (configMode === 'custom') {
      const enabledTypes = customPaymentMethods
        .filter((pm) => pm.enabled)
        .sort((a, b) => a.display_order - b.display_order)
        .map((pm) => pm.type);

      setPaymentMethodOrder(enabledTypes);
    }
  }, [customPaymentMethods, configMode]);

  // Auto-sync currency overrides when global methods change (bug fix):
  // Remove disabled methods from all currency overrides so they stay consistent
  useEffect(() => {
    if (configMode !== 'custom') return;
    const enabledTypes = new Set(
      customPaymentMethods.filter((pm) => pm.enabled).map((pm) => pm.type)
    );

    setCurrencyOverrides((prev) => {
      const updated: Record<string, string[]> = {};
      let changed = false;
      for (const [currency, order] of Object.entries(prev)) {
        const filtered = order.filter((type) => enabledTypes.has(type));
        if (filtered.length !== order.length) changed = true;
        if (filtered.length > 0) {
          updated[currency] = filtered;
        } else {
          changed = true; // Remove empty override entirely
        }
      }
      return changed ? updated : prev;
    });
  }, [customPaymentMethods, configMode]);

  // Currency overrides helpers
  const commonCurrencies = ['PLN', 'EUR', 'USD', 'GBP'];

  function addCurrencyOverride(currency: string) {
    if (currencyOverrides[currency]) return; // Already exists
    setCurrencyOverrides((prev) => ({
      ...prev,
      [currency]: [...paymentMethodOrder], // Copy default order
    }));
  }

  function removeCurrencyOverride(currency: string) {
    setCurrencyOverrides((prev) => {
      const newOverrides = { ...prev };
      delete newOverrides[currency];
      return newOverrides;
    });
  }

  function updateCurrencyOrder(currency: string, newOrder: string[]) {
    setCurrencyOverrides((prev) => ({
      ...prev,
      [currency]: newOrder,
    }));
  }

  // Get globally enabled methods that are valid for a currency but not in its override
  function getExcludedMethodsForCurrency(currency: string): string[] {
    const override = currencyOverrides[currency] || [];
    const overrideSet = new Set(override);
    return customPaymentMethods
      .filter((pm) => {
        if (!pm.enabled) return false;
        if (overrideSet.has(pm.type)) return false;
        // Check currency restrictions from static metadata
        const info = availablePaymentMethods.find((m) => m.type === pm.type);
        if (info && !info.currencies.includes('*') && !info.currencies.includes(currency)) return false;
        return true;
      })
      .sort((a, b) => a.display_order - b.display_order)
      .map((pm) => pm.type);
  }

  function addMethodToOverride(currency: string, type: string) {
    setCurrencyOverrides((prev) => ({
      ...prev,
      [currency]: [...(prev[currency] || []), type],
    }));
  }

  function removeMethodFromOverride(currency: string, type: string) {
    setCurrencyOverrides((prev) => {
      const filtered = (prev[currency] || []).filter((t) => t !== type);
      if (filtered.length === 0) {
        const newOverrides = { ...prev };
        delete newOverrides[currency];
        return newOverrides;
      }
      return { ...prev, [currency]: filtered };
    });
  }

  // Drag handlers for currency-specific ordering
  const [currencyDraggedIndex, setCurrencyDraggedIndex] = useState<{ currency: string; index: number } | null>(null);

  function handleCurrencyDragStart(currency: string, index: number) {
    setCurrencyDraggedIndex({ currency, index });
  }

  function handleCurrencyDragOver(e: React.DragEvent, currency: string, index: number) {
    e.preventDefault();
    if (!currencyDraggedIndex || currencyDraggedIndex.currency !== currency || currencyDraggedIndex.index === index) return;

    const currentOrder = currencyOverrides[currency] || [];
    const newOrder = [...currentOrder];
    const draggedItem = newOrder[currencyDraggedIndex.index];
    newOrder.splice(currencyDraggedIndex.index, 1);
    newOrder.splice(index, 0, draggedItem);

    updateCurrencyOrder(currency, newOrder);
    setCurrencyDraggedIndex({ currency, index });
  }

  function handleCurrencyDragEnd() {
    setCurrencyDraggedIndex(null);
  }

  if (loading) {
    return (
      <div className="bg-gf-base rounded-lg shadow-md p-6">
        <h3 className="text-xl font-semibold text-gf-heading mb-4">
          {t('paymentMethods.title')}
        </h3>
        <p className="text-gf-body">{t('paymentMethods.buttons.loading')}</p>
      </div>
    );
  }

  return (
    <div className="bg-gf-base rounded-lg shadow-md p-6">
      <div className="mb-6">
        <h3 className="text-xl font-semibold text-gf-heading mb-2">
          {t('paymentMethods.title')}
        </h3>
        <p className="text-sm text-gf-body">
          {t('paymentMethods.subtitle')}
        </p>
      </div>

      {/* Configuration Mode Selector */}
      <div className="mb-8">
        <label className="flex items-center gap-2 text-sm font-medium text-gf-body mb-3">
          {t('paymentMethods.mode.label')}
          <SourceBadge source={pmSource} envAlsoSet={pmEnvExists} />
        </label>
        <div className="space-y-3">
          {/* Automatic Mode */}
          <label className="flex items-start p-4 border-2 rounded-lg cursor-pointer transition-colors hover:border-gf-border-accent" style={{ borderColor: configMode === 'automatic' ? 'var(--gf-accent)' : '' }}>
            <input
              type="radio"
              name="config_mode"
              value="automatic"
              checked={configMode === 'automatic'}
              onChange={() => handleModeChange('automatic')}
              className="mt-1 h-4 w-4 text-gf-accent"
            />
            <div className="ml-3 flex-1">
              <div className="font-medium text-gf-heading">
                {t('paymentMethods.mode.automatic')}
              </div>
              <div className="text-sm text-gf-body mt-1">
                {t('paymentMethods.mode.automaticDescription')}
              </div>
            </div>
          </label>

          {/* Stripe Preset Mode */}
          <label className="flex items-start p-4 border-2 rounded-lg cursor-pointer transition-colors hover:border-gf-border-accent" style={{ borderColor: configMode === 'stripe_preset' ? 'var(--gf-accent)' : '' }}>
            <input
              type="radio"
              name="config_mode"
              value="stripe_preset"
              checked={configMode === 'stripe_preset'}
              onChange={() => handleModeChange('stripe_preset')}
              className="mt-1 h-4 w-4 text-gf-accent"
            />
            <div className="ml-3 flex-1">
              <div className="font-medium text-gf-heading">
                {t('paymentMethods.mode.stripePreset')}
              </div>
              <div className="text-sm text-gf-body mt-1">
                {t('paymentMethods.mode.stripePresetDescription')}
              </div>
            </div>
          </label>

          {/* Custom Mode */}
          <label className="flex items-start p-4 border-2 rounded-lg cursor-pointer transition-colors hover:border-gf-border-accent" style={{ borderColor: configMode === 'custom' ? 'var(--gf-accent)' : '' }}>
            <input
              type="radio"
              name="config_mode"
              value="custom"
              checked={configMode === 'custom'}
              onChange={() => handleModeChange('custom')}
              className="mt-1 h-4 w-4 text-gf-accent"
            />
            <div className="ml-3 flex-1">
              <div className="font-medium text-gf-heading">
                {t('paymentMethods.mode.custom')}
              </div>
              <div className="text-sm text-gf-body mt-1">
                {t('paymentMethods.mode.customDescription')}
              </div>
            </div>
          </label>
        </div>
      </div>

      {/* Stripe PMC Selector (only for stripe_preset mode) */}
      {configMode === 'stripe_preset' && (
        <div className="mb-8 p-4 bg-gf-raised rounded-lg">
          <label className="block text-sm font-medium text-gf-body mb-3">
            {t('paymentMethods.stripeConfig.title')}
          </label>
          <div className="flex gap-2">
            <select
              value={stripePmcId}
              onChange={(e) => {
                const selectedPmc = stripePmcs.find((pmc) => pmc.id === e.target.value);
                setStripePmcId(e.target.value);
                setStripePmcName(selectedPmc?.name || '');
              }}
              className="flex-1 px-3 py-2 border border-gf-border rounded-lg bg-gf-input text-gf-heading"
              disabled={stripePmcsLoading}
            >
              <option value="">{t('paymentMethods.stripeConfig.selectPlaceholder')}</option>
              {stripePmcs.map((pmc) => (
                <option key={pmc.id} value={pmc.id}>
                  {pmc.name} ({pmc.id})
                </option>
              ))}
            </select>
            <button
              onClick={handleRefreshStripePmcs}
              disabled={refreshing}
              className="px-4 py-2 bg-gf-raised text-gf-body rounded-lg hover:bg-gf-hover transition-colors disabled:opacity-50"
              title={t('paymentMethods.stripeConfig.refresh')}
            >
              <RefreshCw className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
          {stripePmcsLoading && (
            <p className="text-sm text-gf-body mt-2">{t('paymentMethods.stripeConfig.refreshing')}</p>
          )}

          {/* Stripe Preset Preview - show enabled payment methods */}
          {stripePmcId && !stripePmcsLoading && (() => {
            const selectedPmc = stripePmcs.find((pmc) => pmc.id === stripePmcId);
            if (!selectedPmc) return null;

            // Extract enabled payment methods from PMC
            const enabledMethods: string[] = [];
            // Use shared constant for known payment methods (DRY principle)
            KNOWN_PAYMENT_METHODS.forEach((method) => {
              const methodConfig = selectedPmc[method as keyof typeof selectedPmc] as { enabled?: boolean } | undefined;
              if (methodConfig?.enabled) {
                enabledMethods.push(method);
              }
            });

            return (
              <div className="mt-4 p-3 bg-gf-base border border-gf-border rounded-lg">
                <p className="text-sm font-medium text-gf-body mb-2">
                  {t('paymentMethods.stripeConfig.preview')}
                </p>
                {enabledMethods.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {enabledMethods.map((method) => {
                      const info = getPaymentMethodDisplayInfo(method);
                      return (
                        <span
                          key={method}
                          className="inline-flex items-center px-2.5 py-1 bg-gf-success-soft text-gf-success text-sm rounded-full border border-gf-success/20"
                        >
                          <Check className="w-3 h-3 mr-1" />
                          <span className="mr-1">{info.icon}</span>
                          {info.name}
                        </span>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-gf-muted">
                    {t('paymentMethods.stripeConfig.noMethodsEnabled')}
                  </p>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* Custom Payment Methods (only for custom mode) */}
      {configMode === 'custom' && (
        <div className="mb-8 p-4 bg-gf-raised rounded-lg">
          <label className="block text-sm font-medium text-gf-body mb-3">
            {t('paymentMethods.customConfig.title')}
          </label>
          <div className="space-y-2">
            {customPaymentMethods.map((pm) => {
              const info = getPaymentMethodDisplayInfo(pm.type);
              return (
                <label
                  key={pm.type}
                  className="flex items-center p-3 border border-gf-border rounded-lg hover:bg-gf-hover cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={pm.enabled}
                    onChange={() => togglePaymentMethod(pm.type)}
                    className="h-4 w-4 text-gf-accent"
                  />
                  <span className="ml-3 text-2xl">{info.icon}</span>
                  <div className="ml-3 flex-1">
                    <div className="font-medium text-gf-heading">{info.name}</div>
                    <div className="text-sm text-gf-body">
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
      )}

      {/* Payment Method Order (drag & drop) */}
      {paymentMethodOrder.length > 0 && (
        <div className="mb-8">
          <label className="block text-sm font-medium text-gf-body mb-3">
            {t('paymentMethods.customConfig.orderTitle')}
          </label>
          <p className="text-sm text-gf-body mb-3">
            {t('paymentMethods.customConfig.orderDescription')}
          </p>
          <div className="space-y-2">
            {paymentMethodOrder.map((type, index) => {
              const info = getPaymentMethodDisplayInfo(type);
              return (
                <div
                  key={type}
                  draggable
                  onDragStart={() => handleDragStart(index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragEnd={handleDragEnd}
                  className="flex items-center p-3 bg-gf-base border border-gf-border rounded-lg cursor-move hover:border-gf-border-accent transition-colors"
                  style={{ opacity: draggedIndex === index ? 0.5 : 1 }}
                >
                  <GripVertical className="w-5 h-5 text-gray-400 mr-2" />
                  <span className="text-lg font-medium text-gf-body mr-2">
                    {index + 1}.
                  </span>
                  <span className="text-2xl mr-3">{info.icon}</span>
                  <div className="flex-1">
                    <div className="font-medium text-gf-heading">{info.name}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Express Checkout Toggles */}
      <div className="mb-8 p-4 bg-gf-raised rounded-lg">
        <label className="block text-sm font-medium text-gf-body mb-3">
          {t('paymentMethods.expressCheckout.title')}
        </label>
        <div className="space-y-3">
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={enableExpressCheckout}
              onChange={(e) => setEnableExpressCheckout(e.target.checked)}
              className="h-4 w-4 text-gf-accent"
            />
            <span className="ml-3 text-gf-heading font-medium">
              {t('paymentMethods.expressCheckout.enable')}
            </span>
          </label>
          {enableExpressCheckout && (
            <div className="ml-7 space-y-2">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={enableApplePay}
                  onChange={(e) => setEnableApplePay(e.target.checked)}
                  className="h-4 w-4 text-gf-accent"
                />
                <span className="ml-3 text-gf-body">{t('paymentMethods.expressCheckout.applePay')}</span>
              </label>
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={enableGooglePay}
                  onChange={(e) => setEnableGooglePay(e.target.checked)}
                  className="h-4 w-4 text-gf-accent"
                />
                <span className="ml-3 text-gf-body">{t('paymentMethods.expressCheckout.googlePay')}</span>
              </label>
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={enableLink}
                  onChange={(e) => setEnableLink(e.target.checked)}
                  className="h-4 w-4 text-gf-accent"
                />
                <span className="ml-3 text-gf-body">{t('paymentMethods.expressCheckout.link')}</span>
              </label>
              {enableLink && (
                <p className="ml-7 mt-1 text-xs text-gf-muted">
                  {t('paymentMethods.expressCheckout.linkEnabledDescription', { defaultValue: 'Link is displayed as part of the email field. Users with a Link account can pay with saved cards.' })}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Currency Overrides (Advanced) */}
      <div className="mb-8">
        <button
          type="button"
          onClick={() => setShowCurrencyOverrides(!showCurrencyOverrides)}
          className="flex items-center w-full text-left text-sm font-medium text-gf-body mb-3 hover:text-gf-accent transition-colors"
        >
          {showCurrencyOverrides ? (
            <ChevronDown className="w-4 h-4 mr-2" />
          ) : (
            <ChevronRight className="w-4 h-4 mr-2" />
          )}
          {t('paymentMethods.currencyOverrides.title')}
          <span className="ml-2 text-xs text-gf-muted">
            ({t('paymentMethods.currencyOverrides.advanced')})
          </span>
        </button>

        {showCurrencyOverrides && (
          <div className="p-4 bg-gf-raised rounded-lg space-y-4">
            <p className="text-sm text-gf-body">
              {t('paymentMethods.currencyOverrides.description')}
            </p>

            {/* Add Currency Override */}
            <div className="flex gap-2 flex-wrap">
              {commonCurrencies
                .filter((currency) => !currencyOverrides[currency])
                .map((currency) => (
                  <button
                    key={currency}
                    type="button"
                    onClick={() => addCurrencyOverride(currency)}
                    className="px-3 py-1.5 text-sm border border-dashed border-gf-border rounded-lg hover:border-gf-border-accent hover:bg-gf-accent-soft transition-colors flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" />
                    {currency}
                  </button>
                ))}
            </div>

            {/* Currency Override Cards */}
            {Object.entries(currencyOverrides).filter(([, order]) => Array.isArray(order)).map(([currency, order]) => (
              <div key={currency} className="p-3 bg-gf-base border border-gf-border rounded-lg">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-medium text-gf-heading flex items-center gap-2">
                    <span className="px-2 py-0.5 bg-gf-accent-soft text-gf-accent text-xs rounded">
                      {currency}
                    </span>
                    {t('paymentMethods.currencyOverrides.orderFor', { currency })}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeCurrencyOverride(currency)}
                    className="text-gray-400 hover:text-red-500 transition-colors"
                    title={t('paymentMethods.currencyOverrides.remove')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-1">
                  {order.map((type, index) => {
                    const info = getPaymentMethodDisplayInfo(type);
                    const isDragging = currencyDraggedIndex?.currency === currency && currencyDraggedIndex?.index === index;
                    return (
                      <div
                        key={type}
                        draggable
                        onDragStart={() => handleCurrencyDragStart(currency, index)}
                        onDragOver={(e) => handleCurrencyDragOver(e, currency, index)}
                        onDragEnd={handleCurrencyDragEnd}
                        className="flex items-center p-2 bg-gf-raised rounded cursor-move hover:bg-gf-hover transition-colors"
                        style={{ opacity: isDragging ? 0.5 : 1 }}
                      >
                        <GripVertical className="w-4 h-4 text-gray-400 mr-2" />
                        <span className="text-sm text-gf-body mr-2">{index + 1}.</span>
                        <span className="text-lg mr-2">{info.icon}</span>
                        <span className="text-sm text-gf-heading flex-1">{info.name}</span>
                        <button
                          type="button"
                          onClick={() => removeMethodFromOverride(currency, type)}
                          className="text-gray-400 hover:text-red-500 transition-colors ml-2"
                          title={t('paymentMethods.currencyOverrides.remove')}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Excluded methods available to add */}
                {(() => {
                  const excluded = getExcludedMethodsForCurrency(currency);
                  if (excluded.length === 0) return null;
                  return (
                    <div className="mt-2 pt-2 border-t border-gf-border">
                      <span className="text-xs text-gf-muted mb-1 block">
                        {t('paymentMethods.currencyOverrides.excludedMethods')}
                      </span>
                      <div className="flex gap-1 flex-wrap">
                        {excluded.map((type) => {
                          const info = getPaymentMethodDisplayInfo(type);
                          return (
                            <button
                              key={type}
                              type="button"
                              onClick={() => addMethodToOverride(currency, type)}
                              className="flex items-center gap-1 px-2 py-1 text-xs border border-dashed border-gf-border rounded hover:border-gf-border-accent hover:bg-gf-accent-soft text-gf-body transition-colors"
                            >
                              <Plus className="w-3 h-3" />
                              <span>{info.icon}</span>
                              <span>{info.name}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>
            ))}

            {Object.keys(currencyOverrides).length === 0 && (
              <p className="text-sm text-gf-muted text-center py-4">
                {t('paymentMethods.currencyOverrides.empty')}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Recommended Configuration */}
      <div className="mb-8 p-4 bg-gf-accent-soft border border-gf-border-accent rounded-lg">
        <div className="flex items-start justify-between">
          <div>
            <label className="block text-sm font-medium text-gf-accent mb-1">
              {t('paymentMethods.recommended.title')}
            </label>
            <p className="text-sm text-gf-accent">
              {t('paymentMethods.recommended.description')}
            </p>
            <p className="text-xs text-gf-accent mt-1">
              {t('paymentMethods.recommended.features')}
            </p>
          </div>
          <button
            onClick={handleResetToRecommended}
            disabled={resettingToRecommended || saving}
            className="px-4 py-2 bg-gf-accent text-white text-sm rounded-lg hover:bg-gf-accent-hover transition-colors disabled:opacity-50 flex items-center gap-2 whitespace-nowrap"
          >
            {resettingToRecommended ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                {t('paymentMethods.buttons.loading')}
              </>
            ) : (
              <>
                <RotateCcw className="w-4 h-4" />
                {t('paymentMethods.recommended.reset')}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex justify-end gap-3">
        <button
          onClick={handleReset}
          disabled={saving}
          className="px-4 py-2 border border-gf-border text-gf-body rounded-lg hover:bg-gf-hover transition-colors disabled:opacity-50"
        >
          {t('paymentMethods.buttons.reset')}
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2 bg-gf-accent text-white rounded-lg hover:bg-gf-accent-hover transition-colors disabled:opacity-50 flex items-center gap-2"
        >
          {saving ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              {t('paymentMethods.buttons.saving')}
            </>
          ) : (
            <>
              <Check className="w-4 h-4" />
              {t('paymentMethods.buttons.save')}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
