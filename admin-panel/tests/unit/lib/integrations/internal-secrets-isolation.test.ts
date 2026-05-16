import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = join(__dirname, '..', '..', '..', '..', 'src')
const internalSecretsPath = join(root, 'lib', 'integrations', 'internal-secrets.ts')
const gusConfigPath = join(root, 'lib', 'actions', 'gus-config.ts')
const currencyConfigPath = join(root, 'lib', 'actions', 'currency-config.ts')

describe('internal-secrets isolation (anti-regression for use-server exposure)', () => {
  it('lib/integrations/internal-secrets.ts exists', () => {
    expect(existsSync(internalSecretsPath)).toBe(true)
  })

  it('lib/integrations/internal-secrets.ts imports server-only', () => {
    const source = readFileSync(internalSecretsPath, 'utf-8')
    expect(source).toMatch(/import\s+['"]server-only['"]/)
  })

  it('lib/integrations/internal-secrets.ts has no use server directive', () => {
    const source = readFileSync(internalSecretsPath, 'utf-8')
    expect(source).not.toMatch(/['"]use server['"]/)
  })

  it('gus-config.ts does not export getDecryptedGUSAPIKey (lives in internal-secrets.ts now)', () => {
    const source = readFileSync(gusConfigPath, 'utf-8')
    expect(source).not.toMatch(/^export\s+async\s+function\s+getDecryptedGUSAPIKey\s*\(/m)
  })

  it('currency-config.ts does not export getDecryptedCurrencyConfig (lives in internal-secrets.ts now)', () => {
    const source = readFileSync(currencyConfigPath, 'utf-8')
    expect(source).not.toMatch(/^export\s+async\s+function\s+getDecryptedCurrencyConfig\s*\(/m)
  })
})
