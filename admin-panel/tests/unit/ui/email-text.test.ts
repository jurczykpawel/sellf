import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { EmailText } from '@/components/ui/EmailText';

// EmailText must render nothing during SSR so Cloudflare Email Obfuscation
// never sees the address in the initial HTML (which would cause React hydration
// Error #418 on CF-proxied deployments).

describe('EmailText — SSR safety', () => {
  it('renders nothing for a valid email during SSR', () => {
    const html = renderToString(React.createElement(EmailText, { email: 'contact@example.com' }));
    expect(html).toBe('');
  });

  it('renders nothing for null email during SSR', () => {
    const html = renderToString(React.createElement(EmailText, { email: null }));
    expect(html).toBe('');
  });

  it('renders nothing for undefined email during SSR', () => {
    const html = renderToString(React.createElement(EmailText, { email: undefined }));
    expect(html).toBe('');
  });
});
