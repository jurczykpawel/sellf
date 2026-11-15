'use client';

/**
 * State of the checkout invoice section (accepted mockup v3, owner 10.11). The single tax id field
 * decides the company country; a complete number fetches company data on its own (GUS for a Polish
 * NIP); the manual path takes buyers without a NIP and companies outside the EU. The address is
 * always the same block of separate fields. Validation is the shared one the server runs again.
 *
 * @see src/lib/checkout/invoice-section.ts
 * @see src/lib/checkout/invoice-company-lookup.ts
 * @see src/components/checkout/InvoiceSection.tsx
 */

import { useCallback, useRef, useState } from 'react';
import { detectTaxId, validateInvoiceSection } from '@/lib/checkout/invoice-section';
import { canLookUpCompany, lookupInvoiceCompany } from '@/lib/checkout/invoice-company-lookup';
import type { InvoiceFieldError, InvoiceSectionInput } from '@/lib/checkout/invoice-section';

export type InvoiceRole = 'buyer' | 'recipient';
export type InvoiceMode = 'tax_id' | 'manual';
export type LookupStatus = 'idle' | 'loading' | 'found' | 'not_found' | 'not_configured' | 'rate_limit' | 'unavailable' | 'unsupported';

export interface InvoicePartyFields {
  taxId: string;
  companyName: string;
  address: string;
  postalCode: string;
  city: string;
  country: string;
}

export interface InvoicePartyState {
  fields: InvoicePartyFields;
  lookup: LookupStatus;
  /** The buyer opened the company card for editing ("Edit details"). */
  editing: boolean;
}

export interface InvoiceSectionView {
  card: boolean;
  address: boolean;
  countryLocked: boolean;
}

const EMPTY: InvoicePartyFields = { taxId: '', companyName: '', address: '', postalCode: '', city: '', country: 'PL' };
const emptyParty = (): InvoicePartyState => ({ fields: { ...EMPTY }, lookup: 'idle', editing: false });
const ROLE_PREFIX: Record<InvoiceRole, string> = { buyer: 'invoice', recipient: 'recipient' };
const FIELD_KEYS: Record<keyof InvoicePartyFields, string> = {
  taxId: 'tax_id', companyName: 'company_name', address: 'address', postalCode: 'postal_code', city: 'city', country: 'country',
};

export interface UseInvoiceSectionOptions {
  recipientEnabled: boolean;
  /** Company data saved in the signed-in buyer's profile; applied once when it arrives. */
  prefill?: InvoicePartyFields | null;
}

export function useInvoiceSection({ recipientEnabled, prefill }: UseInvoiceSectionOptions) {
  const [want, setWantState] = useState(false);
  const [mode, setModeState] = useState<InvoiceMode>('tax_id');
  const [buyer, setBuyer] = useState<InvoicePartyState>(emptyParty);
  const [recipient, setRecipient] = useState<InvoicePartyState>(emptyParty);
  const [wantRecipient, setWantRecipientState] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const lookupSeq = useRef<Record<InvoiceRole, number>>({ buyer: 0, recipient: 0 });

  // Profile pre-fill happens once, when the profile answer arrives (state-during-render pattern).
  const [prefillApplied, setPrefillApplied] = useState(false);
  if (!prefillApplied && prefill && (prefill.taxId.trim() || prefill.companyName.trim())) {
    setPrefillApplied(true);
    const detected = detectTaxId(prefill.taxId);
    setWantState(true);
    setModeState(detected.status === 'valid' ? 'tax_id' : 'manual');
    setBuyer({
      fields: { ...prefill, country: detected.status === 'valid' ? detected.country : prefill.country || 'PL' },
      lookup: 'idle',
      editing: true,
    });
  }

  const setParty = useCallback((role: InvoiceRole, update: (party: InvoicePartyState) => InvoicePartyState) => {
    (role === 'buyer' ? setBuyer : setRecipient)(update);
  }, []);

  const clearError = useCallback((field: string) => {
    setErrors(current => {
      if (!(field in current)) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }, []);

  const setField = useCallback((role: InvoiceRole, key: keyof InvoicePartyFields, value: string) => {
    setParty(role, party => ({ ...party, fields: { ...party.fields, [key]: value } }));
    clearError(`${ROLE_PREFIX[role]}.${FIELD_KEYS[key]}`);
  }, [setParty, clearError]);

  const setTaxId = useCallback((role: InvoiceRole, value: string) => {
    clearError(`${ROLE_PREFIX[role]}.tax_id`);
    const seq = ++lookupSeq.current[role];
    const detected = detectTaxId(value, { allowEu: role === 'buyer' });
    if (detected.status !== 'valid') {
      setParty(role, party => ({ ...party, fields: { ...party.fields, taxId: value }, lookup: 'idle', editing: false }));
      return;
    }
    if (!canLookUpCompany(detected.type)) {
      setParty(role, party => ({ ...party, fields: { ...party.fields, taxId: value, country: detected.country }, lookup: 'unsupported', editing: false }));
      return;
    }
    setParty(role, party => ({ ...party, fields: { ...party.fields, taxId: value, country: detected.country }, lookup: 'loading', editing: false }));
    void lookupInvoiceCompany({ type: detected.type, normalized: detected.normalized }).then(result => {
      if (lookupSeq.current[role] !== seq) return;
      setParty(role, party => result.ok
        ? {
          ...party,
          lookup: 'found',
          fields: { ...party.fields, companyName: result.party.company_name, address: result.party.address, postalCode: result.party.postal_code, city: result.party.city, country: result.party.country },
        }
        : { ...party, lookup: result.code });
      if (result.ok) for (const key of ['company_name', 'address', 'postal_code', 'city']) clearError(`${ROLE_PREFIX[role]}.${key}`);
    });
  }, [setParty, clearError]);

  const blurTaxId = useCallback((role: InvoiceRole) => {
    const party = role === 'buyer' ? buyer : recipient;
    const detected = detectTaxId(party.fields.taxId, { allowEu: role === 'buyer' });
    if (detected.status === 'invalid') setErrors(current => ({ ...current, [`${ROLE_PREFIX[role]}.tax_id`]: detected.code }));
  }, [buyer, recipient]);

  const startEditing = useCallback((role: InvoiceRole) => setParty(role, party => ({ ...party, editing: true })), [setParty]);

  const setWant = useCallback((value: boolean) => { setWantState(value); setErrors({}); }, []);
  const setWantRecipient = useCallback((value: boolean) => {
    setWantRecipientState(value);
    setErrors(current => Object.fromEntries(Object.entries(current).filter(([field]) => !field.startsWith('recipient'))));
  }, []);
  const setMode = useCallback((value: InvoiceMode) => {
    setModeState(value);
    setErrors(current => Object.fromEntries(Object.entries(current).filter(([field]) => !field.startsWith('invoice'))));
    if (value === 'tax_id') {
      // Back on the NIP path the country follows the number again.
      setBuyer(party => {
        const detected = detectTaxId(party.fields.taxId);
        return detected.status === 'valid' ? { ...party, fields: { ...party.fields, country: detected.country }, editing: true } : party;
      });
    }
  }, []);

  const view = useCallback((role: InvoiceRole): InvoiceSectionView => {
    const party = role === 'buyer' ? buyer : recipient;
    if (role === 'buyer' && mode === 'manual') return { card: false, address: true, countryLocked: false };
    const card = party.lookup === 'found' && !party.editing;
    const address = party.editing || ['not_found', 'not_configured', 'rate_limit', 'unavailable', 'unsupported'].includes(party.lookup);
    return { card, address, countryLocked: true };
  }, [buyer, recipient, mode]);

  const toSubmit = useCallback((): InvoiceSectionInput => {
    const party = (p: InvoicePartyFields) => ({ tax_id: p.taxId, company_name: p.companyName, address: p.address, postal_code: p.postalCode, city: p.city });
    return {
      want,
      mode,
      buyer: { ...party(buyer.fields), country: buyer.fields.country },
      recipient: want && recipientEnabled && wantRecipient ? party(recipient.fields) : null,
    };
  }, [want, mode, buyer, recipient, wantRecipient, recipientEnabled]);

  const applyServerErrors = useCallback((list: InvoiceFieldError[] | { field: string; code: string }[]) => {
    setErrors(Object.fromEntries(list.filter(e => e.field.startsWith('invoice') || e.field.startsWith('recipient')).map(e => [e.field, e.code])));
  }, []);

  const validate = useCallback((): boolean => {
    const result = validateInvoiceSection(toSubmit(), { recipientEnabled });
    if (result.ok) { setErrors({}); return true; }
    applyServerErrors(result.errors);
    return false;
  }, [toSubmit, recipientEnabled, applyServerErrors]);

  return {
    want, setWant, mode, setMode, buyer, recipient, wantRecipient, setWantRecipient, recipientEnabled,
    errors, setField, setTaxId, blurTaxId, startEditing, view, toSubmit, validate, applyServerErrors,
  };
}

export type InvoiceSectionState = ReturnType<typeof useInvoiceSection>;
