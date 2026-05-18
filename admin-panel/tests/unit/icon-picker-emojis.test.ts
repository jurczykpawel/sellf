import { describe, it, expect } from 'vitest';
import { PRODUCT_ICONS } from '@/utils/themeUtils';

// Tip-jar / digital-goods icon picker must cover the obvious "support me"
// emojis admins will want without dropping back to "Custom". Each entry maps
// a stable id (used in URLs / DB if we ever persist by id) to the literal
// emoji that ends up in product.icon.
describe('PRODUCT_ICONS picker covers tip-jar essentials', () => {
  const required: Array<[string, string]> = [
    ['coffee', '☕'],
    ['pizza', '🍕'],
    ['heart', '❤️'],
    ['beer', '🍻'],
    ['pint', '🍺'],
    ['game', '🎮'],
    ['gift', '🎁'],
    ['donut', '🍩'],
    ['wine', '🍷'],
    ['taco', '🌮'],
    ['pretzel', '🥨'],
    ['kebab', '🥙'],
    ['croissant', '🥐'],
    ['desktop', '🖥️'],
    ['cloud', '☁️'],
    ['yellow-heart', '💛'],
    ['pray', '🙏'],
  ];

  for (const [id, emoji] of required) {
    it(`exposes ${emoji} under id "${id}"`, () => {
      expect(PRODUCT_ICONS[id]).toBe(emoji);
    });
  }
});
