/**
 * Buyer e-mail rule for license issuance, shared by the admin form (client) and
 * the issuance API so both reject the same addresses (W146 B1: `a@b`).
 * @see src/lib/license-keys/request.ts
 * @see src/components/settings/IssuedLicensesSettings.tsx
 */
import { z } from 'zod';

export const licenseEmailSchema = z.string().trim().email().max(254);
