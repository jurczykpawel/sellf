/** Outbound webhook setup follows the dashboard navigation. @see components/settings/LicenseHowToUseModal.tsx */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
it('points license delivery setup to Webhooks in the sidebar', () => {
  const source = readFileSync('src/components/settings/LicenseHowToUseModal.tsx', 'utf8');
  expect(source).toContain("t('deliverySidebarSetup')");
  expect(source).toContain('/dashboard/webhooks');
  expect(en.settings.licenseKeys.modal.deliverySidebarSetup).toContain('sidebar');
  expect(pl.settings.licenseKeys.modal.deliverySidebarSetup).toContain('menu bocznym');
});
