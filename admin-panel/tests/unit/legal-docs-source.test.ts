import { describe, it, expect } from 'vitest'

import { resolveDocUrl, resolveLegalDocsSource } from '@/lib/legal/legal-docs-source'

describe('resolveDocUrl', () => {
  it('uses the DB value when set and env is unset → source "db"', () => {
    expect(resolveDocUrl('https://shop/terms', undefined)).toEqual({
      value: 'https://shop/terms',
      source: 'db',
      envValue: null,
    })
  })

  it('DB value wins over env, but still reports the env value as also-set', () => {
    expect(resolveDocUrl('https://shop/terms', 'https://env/terms')).toEqual({
      value: 'https://shop/terms',
      source: 'db',
      envValue: 'https://env/terms',
    })
  })

  it('falls back to env when DB is null → source "env"', () => {
    expect(resolveDocUrl(null, 'https://env/terms')).toEqual({
      value: 'https://env/terms',
      source: 'env',
      envValue: 'https://env/terms',
    })
  })

  it('treats an empty / whitespace-only DB string as unset', () => {
    expect(resolveDocUrl('', 'https://env/terms').source).toBe('env')
    expect(resolveDocUrl('   ', 'https://env/terms').source).toBe('env')
  })

  it('treats an empty / whitespace-only env value as unset', () => {
    expect(resolveDocUrl(null, '   ')).toEqual({ value: null, source: 'default', envValue: null })
  })

  it('returns "default" when neither DB nor env is set', () => {
    expect(resolveDocUrl(null, undefined)).toEqual({ value: null, source: 'default', envValue: null })
  })

  it('trims the env value', () => {
    expect(resolveDocUrl(null, '  https://env/terms  ')).toEqual({
      value: 'https://env/terms',
      source: 'env',
      envValue: 'https://env/terms',
    })
  })
})

describe('resolveLegalDocsSource', () => {
  it('resolves terms and privacy independently', () => {
    const r = resolveLegalDocsSource(
      { terms_of_service_url: 'https://db/terms', privacy_policy_url: null },
      { terms: undefined, privacy: 'https://env/privacy' },
    )
    expect(r.terms).toEqual({ value: 'https://db/terms', source: 'db', envValue: null })
    expect(r.privacy).toEqual({ value: 'https://env/privacy', source: 'env', envValue: 'https://env/privacy' })
  })

  it('handles a null config (fresh install)', () => {
    const r = resolveLegalDocsSource(null, { terms: 'https://env/t', privacy: undefined })
    expect(r.terms.source).toBe('env')
    expect(r.privacy.source).toBe('default')
  })
})
