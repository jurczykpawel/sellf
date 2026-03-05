'use client';

/**
 * Wistia adapter stub
 *
 * Delegates to the fallback adapter (plain iframe, no custom controls).
 * Implement using Wistia E-v1.js when Wistia support is needed.
 *
 * @see useFallbackAdapter.ts — current implementation
 * @see https://wistia.com/support/developers/player-api — future implementation
 */

import type { PlayerAdapter, PlayerOptions } from './types';
import { useFallbackAdapter } from './useFallbackAdapter';

export function useWistiaAdapter(
  embedUrl: string,
  options: PlayerOptions = {}
): PlayerAdapter {
  return useFallbackAdapter(embedUrl, options);
}
