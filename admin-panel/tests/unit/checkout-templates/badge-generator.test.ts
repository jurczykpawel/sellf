import { describe, it, expect } from 'vitest';
import { generateBadgeHtml } from '@/lib/checkout-templates/generate-badge-html';
import { BADGE_PRESETS } from '@/lib/checkout-templates/badge-presets';

const base = {
  presetSlug: 'classic-yellow' as const,
  siteUrl: 'https://shop.example.com',
  productSlug: 'tip-jar-1',
  productName: 'Postaw mi kebaba',
  productIcon: '🥙',
};

describe('generateBadgeHtml', () => {
  it('produces a single <a> tag with inline style and the product page URL', () => {
    const html = generateBadgeHtml(base);
    expect(html.startsWith('<a ')).toBe(true);
    expect(html).toContain('href="https://shop.example.com/p/tip-jar-1"');
    expect(html).toMatch(/style="[^"]+"/);
    expect(html).toContain('Postaw mi kebaba');
    expect(html).toContain('🥙');
    expect(html.match(/<a /g)!.length).toBe(1);
  });

  it('never emits <script>, <style>, inline event handlers, or unsafe href protocols', () => {
    const html = generateBadgeHtml({ ...base, productName: '<script>alert(1)</script>' });
    expect(html.toLowerCase()).not.toContain('<script');
    expect(html.toLowerCase()).not.toContain('<style');
    expect(html).not.toMatch(/ on[a-z]+\s*=/i);
    expect(html).not.toMatch(/href="\s*javascript:/i);
    expect(html).not.toMatch(/href="\s*data:/i);
    // XSS escaping check — script tags become entities
    expect(html).toContain('&lt;script&gt;');
  });

  it('rejects non-http(s) siteUrl', () => {
    expect(() =>
      generateBadgeHtml({ ...base, siteUrl: 'javascript:alert(1)' }),
    ).toThrow(/http/);
  });

  it('URL-encodes utm params via URLSearchParams', () => {
    const html = generateBadgeHtml({
      ...base,
      utm: {
        source: 'sellf badge',
        medium: 'website',
        campaign: 'tip-jar',
        content: 'top of page',
      },
    });
    expect(html).toContain('utm_source=sellf+badge');
    expect(html).toContain('utm_medium=website');
    expect(html).toContain('utm_campaign=tip-jar');
    expect(html).toContain('utm_content=top+of+page');
  });

  it('exposes 4 presets that each produce a distinct style', () => {
    expect(BADGE_PRESETS.length).toBe(4);
    const slugs = BADGE_PRESETS.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(4);
    const styles = BADGE_PRESETS.map((p) => p.getStyle());
    expect(new Set(styles).size).toBe(4);
  });

  it('branded preset uses the provided accent color', () => {
    const html = generateBadgeHtml({
      ...base,
      presetSlug: 'branded',
      accentColor: '#FF0000',
    });
    expect(html).toContain('background:#FF0000');
  });
});
