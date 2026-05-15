// List of emoji icons for products. The bottom block covers tip-jar /
// "buy me a ___" presets so admins picking the tip-jar checkout template
// can land on a sensible icon without typing one in.
export const PRODUCT_ICONS: Record<string, string> = {
  'rocket': '🚀',
  'gem': '💎',
  'hammer': '🛠️',
  'building': '🏢',
  'zap': '⚡',
  'books': '📚',
  'bulb': '💡',
  'chart': '📊',
  'star': '⭐',
  'money': '💰',
  'lock': '🔒',
  'globe': '🌎',
  'check': '✅',
  'laptop': '💻',
  'phone': '📱',
  'camera': '📸',
  'coffee': '☕',
  'pizza': '🍕',
  'heart': '❤️',
  'beer': '🍻',
  'game': '🎮',
  'gift': '🎁',
  'donut': '🍩',
  'wine': '🍷',
  'taco': '🌮',
  'pretzel': '🥨',
  'kebab': '🥙',
  'pint': '🍺',
  'croissant': '🥐',
  'desktop': '🖥️',
  'cloud': '☁️',
  'yellow-heart': '💛',
  'pray': '🙏',
};

// Get the emoji for an icon id
export function getIconEmoji(iconId?: string): string {
  return PRODUCT_ICONS[iconId || 'rocket'] || PRODUCT_ICONS.rocket;
}
