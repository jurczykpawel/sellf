import type { LegalCompany } from './types';

export function validateSeller(c: LegalCompany): { ok: true } | { ok: false; missing: string[] } {
  const missing: string[] = [];
  const required: (keyof LegalCompany)[] = ['name', 'legalForm', 'email', 'street', 'buildingNo', 'city', 'postal'];
  for (const k of required) if (!c[k] || String(c[k]).trim() === '') missing.push(k);
  if (c.postal && !/^\d{2}-\d{3}$/.test(c.postal)) { if (!missing.includes('postal')) missing.push('postal'); }
  if (c.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email)) missing.push('email');
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}
