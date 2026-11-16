'use client';

import { useState, useEffect } from 'react';

/**
 * Buyer data saved in the signed-in buyer's profile (name, company, address). The invoice section
 * (standard checkout and checkout profile) takes the company from here once; the company lookup
 * and the tax id rules live in useInvoiceSection.
 * @see ./useInvoiceSection.ts
 */
export interface InvoiceFieldsData {
  nip: string;
  companyName: string;
  address: string;
  city: string;
  postalCode: string;
  country: string;
  setCountry: (v: string) => void;
}

export interface UseInvoiceDataReturn extends InvoiceFieldsData {
  /** Whether profile data is being loaded from server */
  isLoadingProfile: boolean;
  /** Full name pre-filled from user profile */
  fullName: string;
  setFullName: (v: string) => void;
}

export interface UseInvoiceDataOptions {
  /** Seed value for the fullName field (e.g. from a funnel URL ?name=...). */
  initialFullName?: string;
}

export function useInvoiceData(
  email: string | undefined,
  options: UseInvoiceDataOptions = {},
): UseInvoiceDataReturn {

  const { initialFullName } = options;

  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [fullName, setFullName] = useState(initialFullName ?? '');
  const [nip, setNip] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [country, setCountry] = useState('PL');

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

  return { isLoadingProfile, fullName, setFullName, nip, companyName, address, city, postalCode, country, setCountry };
}
