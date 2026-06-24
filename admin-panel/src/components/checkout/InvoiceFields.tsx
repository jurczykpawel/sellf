'use client';

import { useTranslations } from 'next-intl';
import type { InvoiceFieldsData } from '@/hooks/useInvoiceData';
import { shouldShowCompanyFields } from '@/lib/checkout/invoice-form-logic';
import { EU_COUNTRIES } from '@/lib/checkout/eu-countries';

interface InvoiceFieldsProps {
  invoice: InvoiceFieldsData;
  /**
   * Show the buyer-country selector. Only meaningful in Stripe Tax mode, where the buyer's
   * country drives the jurisdiction + EU B2B reverse charge. In Fixed-Rate (local) mode the
   * tax is a flat rate independent of the buyer's country, so the selector is hidden to keep
   * the form minimal.
   */
  showCountry?: boolean;
}


export default function InvoiceFields({ invoice, showCountry = false }: InvoiceFieldsProps) {
  const t = useTranslations('checkout');

  return (
    <div className="space-y-3">
      {/* NIP / Tax ID */}
      <div>
        <label htmlFor="nip" className="block text-sm font-medium text-sf-body mb-2">
          {t('nipLabel')}{' '}
          <span className="text-sf-muted text-xs">({t('optional', { defaultValue: 'optional' })})</span>
        </label>
        <div className="relative">
          <input
            type="text"
            id="nip"
            value={invoice.nip}
            onChange={(e) => {
              invoice.setNip(e.target.value);
              invoice.resetNipFeedback();
            }}
            onBlur={invoice.handleNIPBlur}
            placeholder={t('taxIdPlaceholder')}
            maxLength={20}
            className={`w-full px-3 py-2.5 bg-sf-input border ${
              invoice.nipError
                ? 'border-sf-danger/50'
                : invoice.gusSuccess
                ? 'border-sf-success/50'
                : 'border-sf-border'
            } rounded-lg text-sf-heading placeholder-sf-muted focus:outline-none focus:ring-2 focus:ring-sf-accent focus:border-transparent ${
              invoice.isLoadingGUS ? 'pr-10' : ''
            }`}
          />
          {invoice.isLoadingGUS && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <svg className="animate-spin h-5 w-5 text-sf-accent" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
          )}
        </div>
        {invoice.nipError && (
          <p className="mt-1 text-xs text-sf-danger">{invoice.nipError}</p>
        )}
        {invoice.gusError && (
          <p className="mt-1 text-xs text-sf-warning">⚠️ {invoice.gusError}</p>
        )}
        {invoice.gusSuccess && !invoice.isLoadingGUS && (
          <p className="mt-1 text-xs text-sf-success">✓ {t('gusDataFetched')}</p>
        )}
      </div>

      {/* Company fields — shown when NIP is long enough or GUS data loaded */}
      {shouldShowCompanyFields({ nip: invoice.nip, hasGusData: !!invoice.gusData, companyName: invoice.companyName }) && (
        <div className={`space-y-3 animate-in slide-in-from-top-2 duration-300 ${invoice.isLoadingGUS ? 'opacity-60 pointer-events-none' : ''}`}>
          <div>
            <label htmlFor="companyName" className="block text-sm font-medium text-sf-body mb-2">
              {t('companyNameLabel', { defaultValue: 'Company Name' })}
            </label>
            <input
              type="text"
              id="companyName"
              value={invoice.companyName}
              onChange={(e) => invoice.setCompanyName(e.target.value)}
              disabled={invoice.isLoadingGUS}
              placeholder={t('companyNamePlaceholder')}
              className="w-full px-3 py-2.5 bg-sf-input border border-sf-border rounded-lg text-sf-heading placeholder-sf-muted focus:outline-none focus:ring-2 focus:ring-sf-accent focus:border-transparent disabled:cursor-not-allowed"
            />
          </div>
          <div>
            <label htmlFor="address" className="block text-sm font-medium text-sf-body mb-2">
              {t('addressLabel')}
            </label>
            <input
              type="text"
              id="address"
              value={invoice.address}
              onChange={(e) => invoice.setAddress(e.target.value)}
              disabled={invoice.isLoadingGUS}
              placeholder={t('addressPlaceholder')}
              className="w-full px-3 py-2.5 bg-sf-input border border-sf-border rounded-lg text-sf-heading placeholder-sf-muted focus:outline-none focus:ring-2 focus:ring-sf-accent focus:border-transparent disabled:cursor-not-allowed"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="postalCode" className="block text-sm font-medium text-sf-body mb-2">
                {t('postalCodeLabel')}
              </label>
              <input
                type="text"
                id="postalCode"
                value={invoice.postalCode}
                onChange={(e) => invoice.setPostalCode(e.target.value)}
                disabled={invoice.isLoadingGUS}
                placeholder={t('postalCodePlaceholder')}
                className="w-full px-3 py-2.5 bg-sf-input border border-sf-border rounded-lg text-sf-heading placeholder-sf-muted focus:outline-none focus:ring-2 focus:ring-sf-accent focus:border-transparent disabled:cursor-not-allowed"
              />
            </div>
            <div>
              <label htmlFor="city" className="block text-sm font-medium text-sf-body mb-2">
                {t('cityLabel')}
              </label>
              <input
                type="text"
                id="city"
                value={invoice.city}
                onChange={(e) => invoice.setCity(e.target.value)}
                disabled={invoice.isLoadingGUS}
                placeholder={t('cityPlaceholder')}
                className="w-full px-3 py-2.5 bg-sf-input border border-sf-border rounded-lg text-sf-heading placeholder-sf-muted focus:outline-none focus:ring-2 focus:ring-sf-accent focus:border-transparent disabled:cursor-not-allowed"
              />
            </div>
          </div>
          {/* Buyer's country — drives Stripe Tax jurisdiction + EU B2B reverse charge. Shown
              only in Stripe Tax mode; in Fixed-Rate mode the rate is flat (country irrelevant). */}
          {showCountry && (
            <div>
              <label htmlFor="country" className="block text-sm font-medium text-sf-body mb-2">
                {t('countryLabel', { defaultValue: 'Country' })}
              </label>
              <select
                id="country"
                value={invoice.country}
                onChange={(e) => invoice.setCountry(e.target.value)}
                disabled={invoice.isLoadingGUS}
                className="w-full px-3 py-2.5 bg-sf-input border border-sf-border rounded-lg text-sf-heading focus:outline-none focus:ring-2 focus:ring-sf-accent focus:border-transparent disabled:cursor-not-allowed"
              >
                {EU_COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>{c.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
