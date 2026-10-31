import AxeBuilder from '@axe-core/playwright';
import { Page, expect } from '@playwright/test';

/** Known violation rules to exclude across all pages */
const GLOBAL_EXCLUDED_RULES: string[] = [
  // Add rule IDs here as you discover persistent false positives
];

interface A11yCheckOptions {
  /** Additional rules to exclude for this specific page */
  excludeRules?: string[];
  /** CSS selectors to exclude from analysis (e.g., third-party widgets) */
  excludeSelectors?: string[];
  /** Specific WCAG tags to test (defaults to wcag2a + wcag2aa) */
  tags?: string[];
}

/**
 * Run axe-core WCAG 2.x AA analysis on the current page state.
 * Returns the full AxeResults for optional further inspection.
 */
export async function checkAccessibility(page: Page, options: A11yCheckOptions = {}) {
  const {
    excludeRules = [],
    excludeSelectors = [],
    tags = ['wcag2a', 'wcag2aa'],
  } = options;

  let builder = new AxeBuilder({ page })
    .withTags(tags)
    .disableRules([...GLOBAL_EXCLUDED_RULES, ...excludeRules]);

  for (const selector of excludeSelectors) {
    builder = builder.exclude(selector);
  }

  await expect.poll(() => page.evaluate(() => document.getAnimations()
    .filter(animation => animation instanceof CSSTransition && animation.playState === 'running').length), { timeout: 10000 }).toBe(0);
  const results = await builder.analyze();

  const violationSummary = results.violations.map(v => ({
    id: v.id,
    impact: v.impact,
    description: v.description,
    nodes: v.nodes.length,
    help: v.helpUrl,
  }));

  expect(
    results.violations,
    `Accessibility violations found:\n${JSON.stringify(violationSummary, null, 2)}`
  ).toEqual([]);

  return results;
}
