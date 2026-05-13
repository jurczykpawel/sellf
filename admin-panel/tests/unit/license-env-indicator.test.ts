import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const integrationsActionSource = readFileSync(
  resolve(__dirname, '../../src/lib/actions/integrations.ts'),
  'utf-8'
);

const licenseSettingsSource = readFileSync(
  resolve(__dirname, '../../src/components/settings/LicenseSettings.tsx'),
  'utf-8'
);

const integrationsFormSource = readFileSync(
  resolve(__dirname, '../../src/components/IntegrationsForm.tsx'),
  'utf-8'
);

const integrationsPageSource = readFileSync(
  resolve(__dirname, '../../src/app/[locale]/dashboard/integrations/page.tsx'),
  'utf-8'
);

const enMessages = readFileSync(resolve(__dirname, '../../src/messages/en.json'), 'utf-8');
const plMessages = readFileSync(resolve(__dirname, '../../src/messages/pl.json'), 'utf-8');

describe('license env indicator', () => {
  it('exposes env license presence without returning the env license value', () => {
    expect(integrationsActionSource).toContain('Boolean(process.env.SELLF_LICENSE_KEY)');
    expect(integrationsActionSource).toContain('sellf_license_env_configured');
    expect(integrationsActionSource).not.toContain('sellf_license_env: process.env.SELLF_LICENSE_KEY');
  });

  it('shows an env fallback notice when database license is empty', () => {
    expect(licenseSettingsSource).toContain('envLicenseConfigured');
    expect(licenseSettingsSource).toContain('envConfiguredTitle');
    expect(licenseSettingsSource).toContain('!license && envLicenseConfigured');
    expect(enMessages).toContain('License configured via environment variable');
    expect(plMessages).toContain('Licencja skonfigurowana w zmiennej środowiskowej');
  });

  it('does not submit the env-only indicator through integrations settings saves', () => {
    expect(integrationsActionSource).toContain('EDITABLE_INTEGRATION_FIELDS');
    expect(integrationsActionSource).toContain('pickEditableIntegrations');
    expect(integrationsActionSource).toContain('sanitizedValues');
    expect(integrationsPageSource).toContain('sellf_license_env_configured');
    expect(integrationsPageSource).toContain('<IntegrationsForm initialData={formConfig} />');
  });

  it('submits only changed integrations form fields', () => {
    expect(integrationsFormSource).toContain('dirtyFields');
    expect(integrationsFormSource).toContain('changedData');
    expect(integrationsFormSource).toContain('updateIntegrationsConfig(changedData)');
    expect(integrationsFormSource).not.toContain('updateIntegrationsConfig(formData)');
  });
});
