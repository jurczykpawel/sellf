import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = join(__dirname, '..', '..', '..', '..', 'src')
const internalConfigPath = join(root, 'lib', 'stripe', 'internal-config.ts')
const stripeConfigPath = join(root, 'lib', 'actions', 'stripe-config.ts')

describe('internal-config isolation (anti-regression for use-server exposure)', () => {
  it('lib/stripe/internal-config.ts exists', () => {
    expect(existsSync(internalConfigPath)).toBe(true)
  })

  it('lib/stripe/internal-config.ts imports server-only', () => {
    const source = readFileSync(internalConfigPath, 'utf-8')
    expect(source).toMatch(/import\s+['"]server-only['"]/)
  })

  it('lib/stripe/internal-config.ts has no use server directive', () => {
    const source = readFileSync(internalConfigPath, 'utf-8')
    expect(source).not.toMatch(/['"]use server['"]/)
  })

  it('stripe-config.ts does not export *Internal helpers (must live in internal-config.ts)', () => {
    const source = readFileSync(stripeConfigPath, 'utf-8')
    expect(source).not.toMatch(/^export\s+async\s+function\s+getDecryptedStripeKeyInternal/m)
    expect(source).not.toMatch(/^export\s+async\s+function\s+getDecryptedWebhookSecretInternal/m)
    expect(source).not.toMatch(/^export\s+async\s+function\s+getActiveStripeConfigInternal/m)
  })

  it('stripe-config.ts does not define unused admin wrappers (dead code removed)', () => {
    const source = readFileSync(stripeConfigPath, 'utf-8')
    expect(source).not.toMatch(/^export\s+async\s+function\s+getDecryptedStripeKey\s*\(/m)
    expect(source).not.toMatch(/^export\s+async\s+function\s+getDecryptedWebhookSecret\s*\(/m)
    expect(source).not.toMatch(/^export\s+async\s+function\s+getActiveStripeConfig\s*\(/m)
  })
})
