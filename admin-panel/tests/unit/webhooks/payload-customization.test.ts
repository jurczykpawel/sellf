import { describe, it, expect } from 'vitest';
import { selectDataFields, renderTemplate, buildEndpointBody } from '@/lib/webhooks/payload-customization';

describe('selectDataFields', () => {
  const data = { email: 'a@b.com', amount: 10, secret_note: 'x' };
  it('returns all when selection is null', () => {
    expect(selectDataFields(data, null)).toEqual(data);
  });
  it('keeps only selected keys', () => {
    expect(selectDataFields(data, ['email'])).toEqual({ email: 'a@b.com' });
  });
  it('ignores unknown selected keys', () => {
    expect(selectDataFields(data, ['email', 'nope'])).toEqual({ email: 'a@b.com' });
  });
});

describe('renderTemplate', () => {
  const ctx = { email: 'a@b.com', amount: '10.00' };
  it('substitutes placeholders at string leaves', () => {
    expect(renderTemplate({ to: '{{email}}', label: 'fixed' }, ctx))
      .toEqual({ to: 'a@b.com', label: 'fixed' });
  });
  it('unknown placeholder becomes empty string', () => {
    expect(renderTemplate({ x: '{{nope}}' }, ctx)).toEqual({ x: '' });
  });
  it('a hostile value cannot inject JSON structure', () => {
    const out = renderTemplate({ to: '{{name}}' }, { name: '","admin":true' });
    expect(out).toEqual({ to: '","admin":true' });
    expect(JSON.parse(JSON.stringify(out))).toEqual({ to: '","admin":true' });
  });
});

describe('buildEndpointBody', () => {
  it('wraps selected data + merges rendered extra fields', () => {
    const base = { event: 'purchase.completed', timestamp: 't', data: { email: 'a@b.com', amount: 10 } };
    const out = buildEndpointBody(base, {
      payload_field_selection: ['email'],
      custom_payload_fields: { brand: 'tsa', to: '{{email}}' },
    }, { email: 'a@b.com' });
    expect(out).toEqual({
      event: 'purchase.completed', timestamp: 't',
      data: { email: 'a@b.com' },
      brand: 'tsa', to: 'a@b.com',
    });
  });
});
