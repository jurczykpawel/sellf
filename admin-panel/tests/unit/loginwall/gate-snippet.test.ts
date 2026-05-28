import { describe, it, expect } from 'vitest';

import {
  buildGateSnippet,
  buildGateScript,
  gateVariableHash,
} from '@/lib/loginwall/gate-snippet';

const ORIGIN = 'https://sellf.example';

describe('buildGateSnippet', () => {
  it('references the gate runtime, the products, and the gate redirect', () => {
    const html = buildGateSnippet({ slugs: ['pro-kit', 'addon'], sellfOrigin: ORIGIN });
    expect(html).toContain(`${ORIGIN}/api/loginwall/gate.js?products=pro-kit,addon`);
    expect(html).toContain(`${ORIGIN}/loginwall/gate?products=pro-kit,addon&redirect=`);
    expect(html).toContain('<noscript>');
  });

  it('uses the per-snippet variable flag so it no-ops on return', () => {
    const hash = gateVariableHash(['pro-kit', 'addon']);
    const html = buildGateSnippet({ slugs: ['pro-kit', 'addon'], sellfOrigin: ORIGIN });
    expect(html).toContain(`window._SF_GATE_${hash}`);
  });

  it('rejects an empty slug list', () => {
    expect(() => buildGateSnippet({ slugs: [], sellfOrigin: ORIGIN })).toThrow();
  });

  it('rejects more than 20 slugs', () => {
    const many = Array.from({ length: 21 }, (_, i) => `s${i}`);
    expect(() => buildGateSnippet({ slugs: many, sellfOrigin: ORIGIN })).toThrow();
  });

  it('rejects an invalid slug', () => {
    expect(() => buildGateSnippet({ slugs: ['BadSlug!'], sellfOrigin: ORIGIN })).toThrow();
  });

  it('rejects a missing origin', () => {
    expect(() => buildGateSnippet({ slugs: ['pro-kit'], sellfOrigin: '' })).toThrow();
  });
});

describe('gateVariableHash', () => {
  it('is deterministic and order-independent', () => {
    expect(gateVariableHash(['a', 'b'])).toBe(gateVariableHash(['b', 'a']));
  });

  it('differs for different slug sets', () => {
    expect(gateVariableHash(['a', 'b'])).not.toBe(gateVariableHash(['a', 'c']));
  });
});

describe('buildGateScript', () => {
  it('returns an IIFE string referencing the verify endpoint and SellfGate', () => {
    const js = buildGateScript({ slugs: ['pro-kit'], sellfOrigin: ORIGIN });
    expect(js).toContain('_sf_token');
    expect(js).toContain('SellfGate');
    expect(js).toContain(`${ORIGIN}/api/loginwall/verify`);
  });
});
