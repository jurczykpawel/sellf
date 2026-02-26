import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect } from 'vitest'

/**
 * Regression guard for Stripe Dashboard URLs in the tax settings component.
 *
 * SOURCE_TEXT_VERIFY pattern: These tests read component source to ensure
 * hardcoded Stripe Dashboard URLs remain correct across refactors.
 * This is intentional — the URLs are not derived from any importable constant,
 * so source verification is the only way to catch accidental URL changes.
 */

describe('Stripe Tax Status', () => {
  describe('dashboard links', () => {
    const componentPath = join(__dirname, '../../src/components/settings/StripeTaxSettings.tsx')
    const componentSource = readFileSync(componentPath, 'utf-8')

    it('component contains Stripe Dashboard tax settings URL', () => {
      expect(componentSource).toContain('dashboard.stripe.com/settings/tax')
    })

    it('component contains tax registrations URL', () => {
      expect(componentSource).toContain('dashboard.stripe.com/tax/registrations')
    })

    it('component contains tax reporting URL', () => {
      expect(componentSource).toContain('dashboard.stripe.com/tax/reporting')
    })

    it('all dashboard URLs use HTTPS', () => {
      const urlPattern = /https?:\/\/dashboard\.stripe\.com\/[^\s'"]+/g
      const matches = componentSource.match(urlPattern) || []
      expect(matches.length).toBeGreaterThanOrEqual(3)

      for (const url of matches) {
        expect(url).toMatch(/^https:\/\//)
      }
    })
  })
})
