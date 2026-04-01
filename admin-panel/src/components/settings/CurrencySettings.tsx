'use client';

import { useState, useEffect } from 'react';
import { DollarSign, ExternalLink, CheckCircle2, AlertCircle, Loader2, Info, ChevronDown, ChevronUp } from 'lucide-react';
import { saveCurrencyConfig, getCurrencyConfig, deleteCurrencyConfig, type CurrencyConfig } from '@/lib/actions/currency-config';
import { getExchangeRates } from '@/lib/actions/currency';
import { getMyDefaultCurrency } from '@/lib/actions/shop-config';
import { type ExchangeRates } from '@/lib/services/currencyService';
import { BaseModal, ModalHeader, ModalBody, ModalFooter, Button } from '@/components/ui/Modal';
import { toast } from 'sonner';
import { useTranslations, useLocale } from 'next-intl';

export default function CurrencySettings() {
 const t = useTranslations('settings.currency');
 const tCommon = useTranslations('common');
 const locale = useLocale(); // 'pl' lub 'en'
 const [provider, setProvider] = useState<'exchangerate-api' | 'fixer' | 'ecb'>('ecb');
 const [apiKey, setApiKey] = useState('');
 const [config, setConfig] = useState<CurrencyConfig | null>(null);
 const [loading, setLoading] = useState(true);
 const [saving, setSaving] = useState(false);
 const [deleting, setDeleting] = useState(false);
 const [showDeleteModal, setShowDeleteModal] = useState(false);
 const [showRates, setShowRates] = useState(false);
 const [rates, setRates] = useState<ExchangeRates | null>(null);
 const [loadingRates, setLoadingRates] = useState(false);
 const [ratesError, setRatesError] = useState<string | null>(null);
 const [baseCurrency, setBaseCurrency] = useState<string>('USD');
 const [ratesFetchedAt, setRatesFetchedAt] = useState<number>(0);

 const loadConfig = async () => {
 setLoading(true);
 try {
 const result = await getCurrencyConfig();
 if (result.success && result.data) {
 setConfig(result.data);
 setProvider(result.data.provider as 'exchangerate-api' | 'fixer' | 'ecb');
 }
 } catch (error) {
 console.error('Failed to load Currency config:', error);
 } finally {
 setLoading(false);
 }
 };

 useEffect(() => {
 loadConfig();
 // Load default currency from shop config
 getMyDefaultCurrency().then(currency => {
 setBaseCurrency(currency);
 });
 }, []);

 const handleSave = async () => {
 // Validate: exchangerate-api and fixer require API key
 if ((provider === 'exchangerate-api' || provider === 'fixer') && !apiKey.trim() && !config?.hasDatabaseConfig) {
 toast.error(t('errors.apiKeyRequired'));
 return;
 }

 setSaving(true);

 try {
 const result = await saveCurrencyConfig({
 provider,
 apiKey: apiKey.trim() || undefined,
 enabled: true, // Always enabled
 });

 if (result.success) {
 toast.success(t('messages.saved'));
 setApiKey('');
 await loadConfig();
 } else {
 toast.error(result.error || t('errors.saveFailed'));
 }
 } catch (error) {
 toast.error(t('errors.saveFailed'));
 } finally {
 setSaving(false);
 }
 };

 const handleDelete = async () => {
 setDeleting(true);
 setShowDeleteModal(false);

 try {
 const result = await deleteCurrencyConfig();

 if (result.success) {
 toast.success(t('messages.deleted'));
 setApiKey('');
 setProvider('ecb');
 await loadConfig();
 } else {
 toast.error(result.error || t('errors.deleteFailed'));
 }
 } catch (error) {
 toast.error(t('errors.deleteFailed'));
 } finally {
 setDeleting(false);
 }
 };

 const fetchExchangeRates = async () => {
 // Toggle visibility
 const newShowRates = !showRates;
 setShowRates(newShowRates);

 // Jeśli rozwijamy i nie mamy jeszcze danych, załaduj je
 if (newShowRates && !rates) {
 setLoadingRates(true);
 setRatesError(null);

 try {
 const result = await getExchangeRates(baseCurrency);
 if (result) {
 setRates(result);
 setRatesFetchedAt(Date.now()); // Zapisz kiedy faktycznie pobrano dane
 } else {
 setRatesError(t('exchangeRates.error'));
 }
 } catch (error) {
 setRatesError(t('exchangeRates.error'));
 } finally {
 setLoadingRates(false);
 }
 }
 };

 const providerNeedsKey = provider === 'exchangerate-api' || provider === 'fixer';

 if (loading) {
 return (
 <div className="bg-sf-base border-2 border-sf-border-medium p-6">
 <div className="animate-pulse space-y-4">
 <div className="h-4 bg-sf-raised w-1/4"></div>
 <div className="h-20 bg-sf-raised"></div>
 </div>
 </div>
 );
 }

 const getProviderLabel = (provider: string) => {
 const labels: { [key: string]: string } = {
 'ecb': 'ECB (Free)',
 'exchangerate-api': 'ExchangeRate-API',
 'fixer': 'Fixer.io'
 };
 return labels[provider] || provider;
 };

 return (
 <>
 {/* Delete Confirmation Modal */}
 <BaseModal isOpen={showDeleteModal} onClose={() => setShowDeleteModal(false)} size="md">
 <ModalHeader title={t('deleteModal.title')} />
 <ModalBody>
 <p className="text-sf-body">
 {t('deleteModal.description')}
 </p>
 </ModalBody>
 <ModalFooter>
 <Button onClick={() => setShowDeleteModal(false)} variant="secondary">
 {tCommon('cancel')}
 </Button>
 <Button onClick={handleDelete} variant="danger" loading={deleting}>
 {tCommon('delete')}
 </Button>
 </ModalFooter>
 </BaseModal>

 <div className="bg-sf-base border-2 border-sf-border-medium p-6">
 <div className="flex items-start justify-between mb-6">
 <div>
 <h2 className="text-xl font-semibold text-sf-heading mb-2">
 {t('title')}
 </h2>
 <p className="text-sm text-sf-body">
 {t('subtitle')}
 </p>
 </div>
 <DollarSign className="w-8 h-8 text-sf-success" />
 </div>

 {/* Info Banner - Exchange rates are approximate */}
 <div className="mb-6 bg-sf-accent-soft border border-sf-accent/20 p-4">
 <div className="flex items-start gap-3">
 <Info className="w-5 h-5 text-sf-accent mt-0.5 flex-shrink-0" />
 <div className="flex-1">
 <p className="text-sm font-medium text-sf-heading mb-1">
 {t('info.title')}
 </p>
 <p className="text-sm text-sf-body">
 {t('info.description')}
 </p>
 </div>
 </div>
 </div>

 {/* Configuration Source Info - ALWAYS SHOWN */}
 {config && (
 <div className={`mb-6 p-4 border ${
 config.configuredIn === 'both'
 ? 'bg-sf-accent-soft border-sf-border-accent'
 : config.configuredIn === 'database'
 ? 'bg-sf-success-soft border-sf-success/20'
 : config.configuredIn === 'env'
 ? 'bg-sf-warning-soft border-sf-warning/20'
 : 'bg-sf-raised border-sf-border'
 }`}>
 <div className="flex items-start gap-3">
 {config.configuredIn === 'both' ? (
 <CheckCircle2 className="w-5 h-5 text-sf-accent mt-0.5 flex-shrink-0" />
 ) : config.configuredIn === 'database' ? (
 <CheckCircle2 className="w-5 h-5 text-sf-success mt-0.5 flex-shrink-0" />
 ) : config.configuredIn === 'env' ? (
 <AlertCircle className="w-5 h-5 text-sf-warning mt-0.5 flex-shrink-0" />
 ) : (
 <Info className="w-5 h-5 text-sf-body mt-0.5 flex-shrink-0" />
 )}
 <div className="flex-1">
 <p className="text-sm font-medium text-sf-heading mb-1">
 {t('status.currentProvider')}: <span className="font-semibold">{getProviderLabel(config.provider)}</span>
 </p>
 <p className="text-sm text-sf-body">
 {config.configuredIn === 'both'
 ? t('status.configuredBothDescription')
 : config.configuredIn === 'database'
 ? t('status.configuredDatabaseDescription')
 : config.configuredIn === 'env'
 ? t('status.configuredEnvDescription')
 : t('status.defaultDescription')}
 </p>
 </div>
 </div>
 </div>
 )}

 {/* Configuration Form */}
 <div className="space-y-4">
 {/* Provider Selection */}
 <div>
 <label htmlFor="provider" className="block text-sm font-medium text-sf-body mb-2">
 {t('providerLabel')}
 </label>
 <select
 id="provider"
 value={provider}
 onChange={(e) => setProvider(e.target.value as any)}
 className="w-full px-4 py-2.5 bg-sf-input border-2 border-sf-border-medium text-sf-heading focus:outline-none focus:ring-2 focus:ring-sf-accent focus:border-transparent"
 >
 <option value="ecb">{t('providers.ecb')}</option>
 <option value="exchangerate-api">{t('providers.exchangerateApi')}</option>
 <option value="fixer">{t('providers.fixer')}</option>
 </select>
 <p className="mt-2 text-xs text-sf-muted">
 {provider === 'ecb' && t('providerHelp.ecb')}
 {provider === 'exchangerate-api' && t('providerHelp.exchangerateApi')}
 {provider === 'fixer' && t('providerHelp.fixer')}
 </p>
 </div>

 {/* API Key Input - Only for exchangerate-api and fixer */}
 {providerNeedsKey && (
 <div>
 <label htmlFor="currency-api-key" className="block text-sm font-medium text-sf-body mb-2">
 {t('apiKeyLabel')}
 </label>
 <input
 type="password"
 id="currency-api-key"
 value={apiKey}
 onChange={(e) => setApiKey(e.target.value)}
 placeholder={config?.hasDatabaseConfig ? '••••••••••••••••' : t('apiKeyPlaceholder')}
 className="w-full px-4 py-2.5 bg-sf-input border-2 border-sf-border-medium text-sf-heading placeholder-sf-muted focus:outline-none focus:ring-2 focus:ring-sf-accent focus:border-transparent"
 />
 <p className="mt-2 text-xs text-sf-muted">
 {provider === 'exchangerate-api' && (
 <>
 {t('apiKeyHelp.exchangerateApi')}{' '}
 <a
 href="https://www.exchangerate-api.com/"
 target="_blank"
 rel="noopener noreferrer"
 className="text-sf-accent underline hover:no-underline inline-flex items-center gap-1"
 >
 {t('getApiKey')}
 <ExternalLink className="w-3 h-3" />
 </a>
 </>
 )}
 {provider === 'fixer' && (
 <>
 {t('apiKeyHelp.fixer')}{' '}
 <a
 href="https://fixer.io/"
 target="_blank"
 rel="noopener noreferrer"
 className="text-sf-accent underline hover:no-underline inline-flex items-center gap-1"
 >
 {t('getApiKey')}
 <ExternalLink className="w-3 h-3" />
 </a>
 </>
 )}
 </p>
 </div>
 )}

 {/* Actions */}
 <div className="flex items-center gap-3 pt-2">
 <button
 onClick={handleSave}
 disabled={saving || deleting}
 className="px-6 py-2.5 bg-sf-accent-bg hover:bg-sf-accent-hover disabled:bg-sf-muted text-white font-medium transition-colors disabled:cursor-not-allowed flex items-center gap-2"
 >
 {saving && <Loader2 className="w-4 h-4 animate-spin" />}
 {t('saveButton')}
 </button>

 {config?.hasDatabaseConfig && (
 <button
 onClick={() => setShowDeleteModal(true)}
 disabled={saving || deleting}
 className="px-6 py-2.5 bg-sf-danger-bg hover:opacity-90 disabled:bg-sf-muted text-sf-inverse font-medium transition-colors disabled:cursor-not-allowed flex items-center gap-2"
 >
 {deleting && <Loader2 className="w-4 h-4 animate-spin" />}
 {t('deleteButton')}
 </button>
 )}
 </div>
 </div>

 {/* Exchange Rates Display - Collapsible */}
 <div className="mt-6 border-t border-sf-border pt-6">
 <button
 onClick={fetchExchangeRates}
 className="flex items-center justify-between w-full text-left group"
 >
 <div className="flex items-center gap-2">
 <DollarSign className="w-5 h-5 text-sf-body" />
 <span className="text-sm font-medium text-sf-heading group-hover:text-sf-accent transition-colors">
 {t('exchangeRates.title')}
 </span>
 </div>
 {showRates ? (
 <ChevronUp className="w-5 h-5 text-sf-body group-hover:text-sf-accent transition-colors" />
 ) : (
 <ChevronDown className="w-5 h-5 text-sf-body group-hover:text-sf-accent transition-colors" />
 )}
 </button>

 {showRates && (
 <div className="mt-4 space-y-3">
 {loadingRates && (
 <div className="flex items-center justify-center py-8">
 <Loader2 className="w-6 h-6 animate-spin text-sf-accent" />
 <span className="ml-2 text-sm text-sf-body">
 {t('exchangeRates.loading')}
 </span>
 </div>
 )}

 {ratesError && (
 <div className="bg-sf-danger-soft border border-sf-danger/20 p-4">
 <p className="text-sm text-sf-danger">
 {t('exchangeRates.error')}
 </p>
 </div>
 )}

 {rates && !loadingRates && (
 <>
 <div className="grid grid-cols-2 gap-x-6 gap-y-2 mb-3 text-xs bg-sf-raised p-3">
 <div>
 <span className="text-sf-body">{t('exchangeRates.baseCurrency')}:</span>{' '}
 <span className="font-medium text-sf-heading">{baseCurrency}</span>
 </div>
 <div>
 <span className="text-sf-body">{t('exchangeRates.provider', { provider: '' })}</span>{' '}
 <span className="font-medium text-sf-heading">{getProviderLabel(config?.provider || 'ecb')}</span>
 </div>
 <div>
 <span className="text-sf-body">{t('exchangeRates.apiDate')}:</span>{' '}
 <span className="font-medium text-sf-heading">
 {new Date(rates.timestamp).toLocaleString(locale === 'pl' ? 'pl-PL' : 'en-US', {
 year: 'numeric',
 month: '2-digit',
 day: '2-digit',
 hour: '2-digit',
 minute: '2-digit'
 })}
 </span>
 </div>
 <div>
 <span className="text-sf-body">{t('exchangeRates.cacheExpires')}:</span>{' '}
 <span className="font-medium text-sf-warning">
 💾 {new Date(ratesFetchedAt + 3600000).toLocaleString(locale === 'pl' ? 'pl-PL' : 'en-US', {
 year: 'numeric',
 month: '2-digit',
 day: '2-digit',
 hour: '2-digit',
 minute: '2-digit'
 })}
 </span>
 </div>
 </div>
 <pre className="bg-sf-deep text-green-400 p-4 overflow-x-auto text-xs font-mono border-2 border-sf-border-medium">
 {JSON.stringify(rates, null, 2)}
 </pre>
 </>
 )}
 </div>
 )}
 </div>
 </div>
 </>
 );
}
