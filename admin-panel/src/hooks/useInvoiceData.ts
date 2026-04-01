'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { validateTaxId } from '@/lib/validation/nip';

interface GUSCompanyData {
  nazwa: string;
  ulica: string;
  nrNieruchomosci: string;
  nrLokalu?: string;
  miejscowosc: string;
  kodPocztowy: string;
}

/** Narrow interface for InvoiceFields component — only what it needs */
export interface InvoiceFieldsData {
  nip: string;
  setNip: (v: string) => void;
  nipError: string | null;
  isLoadingGUS: boolean;
  gusError: string | null;
  gusSuccess: boolean;
  gusData: GUSCompanyData | null;
  companyName: string;
  setCompanyName: (v: string) => void;
  address: string;
  setAddress: (v: string) => void;
  city: string;
  setCity: (v: string) => void;
  postalCode: string;
  setPostalCode: (v: string) => void;
  country: string;
  setCountry: (v: string) => void;
  handleNIPBlur: () => Promise<void>;
  resetNipFeedback: () => void;
}

export interface UseInvoiceDataReturn extends InvoiceFieldsData {
  /** Whether profile data is being loaded from server */
  isLoadingProfile: boolean;
  /** Full name pre-filled from user profile */
  fullName: string;
  setFullName: (v: string) => void;
}

export function useInvoiceData(email: string | undefined): UseInvoiceDataReturn {
  const t = useTranslations('checkout');

  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [fullName, setFullName] = useState('');
  const [nip, setNip] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [country, setCountry] = useState('PL');
  const [nipError, setNipError] = useState<string | null>(null);
  const [isLoadingGUS, setIsLoadingGUS] = useState(false);
  const [gusError, setGusError] = useState<string | null>(null);
  const [gusSuccess, setGusSuccess] = useState(false);
  const [gusData, setGusData] = useState<GUSCompanyData | null>(null);

  // Auto-load profile for logged-in users
  useEffect(() => {
    const controller = new AbortController();
    let ignore = false;

    async function loadProfileData() {
      if (!email) {
        setIsLoadingProfile(false);
        return;
      }
      setIsLoadingProfile(true);
      try {
        const response = await fetch('/api/profile/get', {
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
        });
        if (response.ok && !ignore) {
          const { data } = await response.json();
          if (data) {
            if (data.full_name) setFullName(data.full_name);
            if (data.tax_id) setNip(data.tax_id);
            if (data.company_name) setCompanyName(data.company_name);
            if (data.address_line1) setAddress(data.address_line1);
            if (data.city) setCity(data.city);
            if (data.zip_code) setPostalCode(data.zip_code);
            if (data.country) setCountry(data.country);
          }
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
        console.error('[useInvoiceData] Failed to load profile data:', error);
        // Silent fail — user can enter manually
      } finally {
        if (!ignore) setIsLoadingProfile(false);
      }
    }

    loadProfileData();
    return () => { controller.abort(); ignore = true; };
  }, [email]);

  function translateNipError(error: string | undefined): string {
    if (!error) return t('nipValidation.invalidFormat');
    if (error.includes('Invalid Polish NIP checksum')) return t('nipValidation.invalidChecksum');
    if (error.includes('Polish NIP must be 10 digits')) return t('nipValidation.mustBe10Digits');
    if (error.includes('Tax ID is required')) return t('nipValidation.required');
    return t('nipValidation.invalidFormat');
  }

  const resetNipFeedback = useCallback(() => {
    setNipError(null);
    setGusError(null);
    setGusSuccess(false);
    setGusData(null);
  }, []);

  const handleNIPBlur = useCallback(async () => {
    if (!nip || nip.trim().length === 0) return;

    const validation = validateTaxId(nip, true);

    if (!validation.isValid) {
      setNipError(translateNipError(validation.error));
      setGusError(null);
      setGusSuccess(false);
      return;
    }

    setNipError(null);

    if (validation.isPolish && validation.normalized) {
      setIsLoadingGUS(true);
      setGusError(null);
      setGusSuccess(false);

      try {
        const response = await fetch('/api/gus/fetch-company-data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nip: validation.normalized }),
        });

        const result = await response.json();

        if (result.success && result.data) {
          setGusData(result.data);
          setCompanyName(result.data.nazwa);
          let addressStr = `${result.data.ulica} ${result.data.nrNieruchomosci}`;
          if (result.data.nrLokalu) addressStr += `/${result.data.nrLokalu}`;
          setAddress(addressStr.trim());
          setCity(result.data.miejscowosc);
          setPostalCode(result.data.kodPocztowy);
          setCountry('PL');
          setGusSuccess(true);
        } else {
          if (result.code === 'RATE_LIMIT_EXCEEDED') setGusError(t('gusRateLimitExceeded'));
          else if (result.code === 'NOT_FOUND') setGusError(t('gusNotFound'));
          else if (result.code === 'NOT_CONFIGURED') setGusError(null);
          else if (result.code === 'INVALID_ORIGIN') setGusError(t('gusSecurityError'));
          else setGusError(t('gusFetchError'));
        }
      } catch (error) {
        console.error('[useInvoiceData] GUS fetch error:', error);
        setGusError(t('gusFetchError'));
      } finally {
        setIsLoadingGUS(false);
      }
    } else if (!validation.isPolish) {
      setGusError(null);
      setGusSuccess(false);
    }
  }, [nip, t, setCompanyName, setAddress, setCity, setPostalCode, setCountry]);

  return {
    isLoadingProfile,
    fullName,
    setFullName,
    nip,
    setNip,
    nipError,
    isLoadingGUS,
    gusError,
    gusSuccess,
    gusData,
    companyName,
    setCompanyName,
    address,
    setAddress,
    city,
    setCity,
    postalCode,
    setPostalCode,
    country,
    setCountry,
    handleNIPBlur,
    resetNipFeedback,
  };
}
