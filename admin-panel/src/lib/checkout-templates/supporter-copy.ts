// Emoji → i18n key dispatcher for the recent supporters renderer.
//
// Renderer composes:
//   `${anonymizedName} ${t(getSupporterActionKey(product.icon))}`
//   → "Jan postawił kawę" / "Jan bought a coffee"
//
// Add a new emoji = one entry below + matching pl + en messages key
// (admin-panel/src/messages/{pl,en}.json under `supporterActions`).

const ICON_TO_ACTION: Record<string, string> = {
  '☕': 'supporterActions.coffee',
  '🥙': 'supporterActions.kebab',
  '🍕': 'supporterActions.pizza',
  '🍻': 'supporterActions.beer',
  '🍺': 'supporterActions.pint',
  '🍷': 'supporterActions.wine',
  '🍩': 'supporterActions.donut',
  '🌮': 'supporterActions.taco',
  '🥨': 'supporterActions.pretzel',
  '🥐': 'supporterActions.croissant',
  '❤️': 'supporterActions.heart',
  '💛': 'supporterActions.heart',
  '🎁': 'supporterActions.gift',
  '🎮': 'supporterActions.game',
  '🙏': 'supporterActions.pray',
  '⚡': 'supporterActions.zap',
  '☁️': 'supporterActions.cloud',
  '🖥️': 'supporterActions.desktop',
};

export function getSupporterActionKey(icon: string | null | undefined): string {
  if (!icon) return 'supporterActions.default';
  return ICON_TO_ACTION[icon] ?? 'supporterActions.default';
}

export const SUPPORTER_ACTION_KEYS: readonly string[] = Array.from(
  new Set<string>([...Object.values(ICON_TO_ACTION), 'supporterActions.default']),
);
