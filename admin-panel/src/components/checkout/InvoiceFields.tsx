'use client';

import { useTranslations } from 'next-intl';
import type { InvoiceFieldsData } from '@/hooks/useInvoiceData';

interface InvoiceFieldsProps {
  invoice: InvoiceFieldsData;
}

// The BUYER's country (not the shop's). Stripe Tax derives the jurisdiction from it, and EU
// B2B reverse charge needs the buyer's EU country + VAT-ID. EU-27 only — a non-EU buyer simply
// won't trigger reverse charge (correct). PL is the default for the primary market.
const EU_COUNTRY_OPTIONS = [
  { code: 'PL', name: 'Polska' },
  { code: 'AT', name: 'Austria' }, { code: 'BE', name: 'Belgia' }, { code: 'BG', name: 'Bułgaria' },
  { code: 'HR', name: 'Chorwacja' }, { code: 'CY', name: 'Cypr' }, { code: 'CZ', name: 'Czechy' },
  { code: 'DK', name: 'Dania' }, { code: 'EE', name: 'Estonia' }, { code: 'FI', name: 'Finlandia' },
  { code: 'FR', name: 'Francja' }, { code: 'GR', name: 'Grecja' }, { code: 'ES', name: 'Hiszpania' },
  { code: 'NL', name: 'Holandia' }, { code: 'IE', name: 'Irlandia' }, { code: 'LT', name: 'Litwa' },
  { code: 'LU', name: 'Luksemburg' }, { code: 'LV', name: 'Łotwa' }, { code: 'MT', name: 'Malta' },
  { code: 'DE', name: 'Niemcy' }, { code: 'PT', name: 'Portugalia' }, { code: 'RO', name: 'Rumunia' },
  { code: 'SK', name: 'Słowacja' }, { code: 'SI', name: 'Słowenia' }, { code: 'SE', name: 'Szwecja' },
  { code: 'HU', name: 'Węgry' }, { code: 'IT', name: 'Włochy' },
] as const;

export default function InvoiceFields({ invoice }: InvoiceFieldsProps) {
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
      {(invoice.nip.length === 10 || invoice.gusData || invoice.companyName) && (
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
          {/* Buyer's country — drives Stripe Tax jurisdiction + EU B2B reverse charge. */}
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
              {EU_COUNTRY_OPTIONS.map((c) => (
                <option key={c.code} value={c.code}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
