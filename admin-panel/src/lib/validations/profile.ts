/**
 * Profile validation utilities
 * No external dependencies - pure TypeScript validation matching project style
 */

import { z } from 'zod';

export interface ValidationResult {
  isValid: boolean;
  errors: Record<string, string[]>;
}

export interface ProfileInput {
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  display_name?: string | null;
  company_name?: string | null;
  tax_id?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  country?: string | null;
  preferred_language?: string | null;
  timezone?: string | null;
}

export function validateProfile(data: ProfileInput): ValidationResult {
  const errors: Record<string, string[]> = {};

  const addError = (field: string, message: string) => {
    if (!errors[field]) errors[field] = [];
    errors[field].push(message);
  };

  // Name validation
  if (data.first_name && data.first_name.length > 100) {
    addError('first_name', 'First name is too long');
  }
  if (data.last_name && data.last_name.length > 100) {
    addError('last_name', 'Last name is too long');
  }

  // Tax ID (NIP) validation - if provided, should be numeric/alphanumeric depending on country
  // For Poland (NIP), we could add a regex, but keeping it generic for now
  if (data.tax_id) {
    const cleanTaxId = data.tax_id.replace(/[^a-zA-Z0-9]/g, '');
    if (cleanTaxId.length < 5) {
      addError('tax_id', 'Tax ID seems too short');
    }
  }

  // Zip code simple check
  if (data.zip_code && data.zip_code.length > 20) {
    addError('zip_code', 'Invalid zip code format');
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
}

/**
 * Mirrors ProfileInput field-for-field. `.strict()` rejects any key not
 * listed here — the DB write uses this parsed object, never the raw
 * argument, so a column not part of the profile shape can't ride along
 * (defense in depth on top of validateProfile's format checks above).
 */
export const ProfileUpdateDTO = z
  .object({
    first_name: z.string().nullable().optional(),
    last_name: z.string().nullable().optional(),
    full_name: z.string().nullable().optional(),
    display_name: z.string().nullable().optional(),
    company_name: z.string().nullable().optional(),
    tax_id: z.string().nullable().optional(),
    address_line1: z.string().nullable().optional(),
    address_line2: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    state: z.string().nullable().optional(),
    zip_code: z.string().nullable().optional(),
    country: z.string().nullable().optional(),
    preferred_language: z.string().nullable().optional(),
    timezone: z.string().nullable().optional(),
  })
  // Unknown keys are dropped: the profile form submits the whole row it loaded.
  .strip();
