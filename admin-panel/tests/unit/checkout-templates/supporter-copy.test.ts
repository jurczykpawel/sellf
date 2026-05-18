import { describe, it, expect } from 'vitest';
import {
  getSupporterActionKey,
  SUPPORTER_ACTION_KEYS,
} from '@/lib/checkout-templates/supporter-copy';

// Recent supporters renderer takes the product's icon (emoji) and resolves
// it to an i18n key — `t(key)` then yields the locale-appropriate verb
// phrase ("postawił kawę" / "bought a coffee"). The mapping table itself is
// the source of truth here; renderer is a thin call site.
//
// Forward-compat: emoji unknown → 'supporterActions.default'. Adding a new
// emoji = single entry in SUPPORTER_ACTION_KEYS + matching pl/en messages.

describe('supporter copy emoji mapping', () => {
  it('maps coffee, kebab, pizza, beer, pint to dedicated keys', () => {
    expect(getSupporterActionKey('☕')).toBe('supporterActions.coffee');
    expect(getSupporterActionKey('🥙')).toBe('supporterActions.kebab');
    expect(getSupporterActionKey('🍕')).toBe('supporterActions.pizza');
    expect(getSupporterActionKey('🍻')).toBe('supporterActions.beer');
    expect(getSupporterActionKey('🍺')).toBe('supporterActions.pint');
  });

  it('maps wine, donut, taco, pretzel, croissant', () => {
    expect(getSupporterActionKey('🍷')).toBe('supporterActions.wine');
    expect(getSupporterActionKey('🍩')).toBe('supporterActions.donut');
    expect(getSupporterActionKey('🌮')).toBe('supporterActions.taco');
    expect(getSupporterActionKey('🥨')).toBe('supporterActions.pretzel');
    expect(getSupporterActionKey('🥐')).toBe('supporterActions.croissant');
  });

  it('maps hearts, gift, game, pray, lightning, cloud, desktop', () => {
    expect(getSupporterActionKey('❤️')).toBe('supporterActions.heart');
    expect(getSupporterActionKey('💛')).toBe('supporterActions.heart');
    expect(getSupporterActionKey('🎁')).toBe('supporterActions.gift');
    expect(getSupporterActionKey('🎮')).toBe('supporterActions.game');
    expect(getSupporterActionKey('🙏')).toBe('supporterActions.pray');
    expect(getSupporterActionKey('⚡')).toBe('supporterActions.zap');
    expect(getSupporterActionKey('☁️')).toBe('supporterActions.cloud');
    expect(getSupporterActionKey('🖥️')).toBe('supporterActions.desktop');
  });

  it('returns the default key for unknown or null icons', () => {
    expect(getSupporterActionKey('🦄')).toBe('supporterActions.default');
    expect(getSupporterActionKey(undefined)).toBe('supporterActions.default');
    expect(getSupporterActionKey('')).toBe('supporterActions.default');
  });

  it('SUPPORTER_ACTION_KEYS exposes a stable enumeration for i18n coverage', () => {
    // Every value used in mapping must be enumerable so messages/{pl,en}.json
    // smoke tests (Phase 7) can iterate and assert every key resolves.
    expect(SUPPORTER_ACTION_KEYS.length).toBeGreaterThan(10);
    for (const key of SUPPORTER_ACTION_KEYS) {
      expect(key.startsWith('supporterActions.')).toBe(true);
    }
    expect(SUPPORTER_ACTION_KEYS).toContain('supporterActions.default');
  });
});
