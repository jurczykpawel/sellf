/** License settings copy matches what Sellf does. @see components/settings/LicenseKeysSettings.tsx, components/settings/LicenseHowToUseModal.tsx */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';

const copy = { en: en.settings.licenseKeys, pl: pl.settings.licenseKeys };

describe.each(Object.entries(copy))('license settings copy (%s)', (_locale, t) => {
  it('says a key change retires the old key and earlier licenses keep working', () => {
    expect(t.rotateWarning).toMatch(/retired|wycofany/);
    expect(t.rotateWarning).toMatch(/JWKS/);
    expect(t.modal.rotationBody).toMatch(/retired/);
    expect(t.modal.rotationBody).not.toMatch(/only serves the active key|zwraca tylko aktywny/);
    expect(t.modal.rotationFix).not.toMatch(/hardcoded|zachowaj stary klucz publiczny/i);
  });

  it('describes delivery as it is: licenses[] in the webhook and email when buyer emails are on', () => {
    const delivery = `${t.modal.flowText} ${t.modal.deliveryBody}`;
    expect(delivery).toContain('licenses[]');
    expect(delivery).not.toContain('license.token');
    expect(delivery).not.toMatch(/does not email|nie wysyła licencji/);
    expect(t.modal.deliveryBody).toMatch(/Buyer emails|Maile do kupujących/);
    expect(t.modal.deliveryBody).toContain('Mailstack');
  });
});

it('shows the key status field in the JWKS example of the how-to window', () => {
  const source = readFileSync('src/components/settings/LicenseHowToUseModal.tsx', 'utf8');
  expect(source).toContain('keys = [{ kid, alg, pem, status }');
});
