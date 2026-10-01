/**
 * ThemeScript inline-script escaping.
 *
 * `checkout_theme` (adminTheme) is admin-configured and only type-checked
 * as `string` at the TS layer — nothing currently stops it from being
 * something other than 'light' | 'dark' | 'system' at the DB layer. When
 * it isn't exactly 'light' or 'dark', ThemeScript embeds it as JSON inside
 * an inline <script> tag, so it must not be able to break out of that tag.
 *
 * @see src/components/providers/theme-provider.tsx
 */
import { describe, it, expect } from 'vitest';
import { escapeForInlineScript } from '@/components/providers/theme-provider';

describe('escapeForInlineScript', () => {
  it('escapes every "<" so no tag-like sequence can appear literally', () => {
    const value = JSON.stringify('</script><script>x()</script>');
    const escaped = escapeForInlineScript(value);

    expect(escaped).not.toContain('<');
    expect(escaped).toContain('\\u003cscript>');
  });

  it('also escapes a bare "<" (not just "</"), unlike a </-only escape', () => {
    const withComment = JSON.stringify('<!--<script>-->');
    const escaped = escapeForInlineScript(withComment);

    expect(escaped).not.toContain('<');
  });

  it('leaves ordinary values untouched', () => {
    expect(escapeForInlineScript(JSON.stringify('dark'))).toBe('"dark"');
    expect(escapeForInlineScript(JSON.stringify(null))).toBe('null');
  });
});
