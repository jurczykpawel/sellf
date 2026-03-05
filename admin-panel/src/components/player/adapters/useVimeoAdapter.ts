'use client';

/**
 * Vimeo adapter stub
 *
 * Delegates to the fallback adapter (plain iframe, no custom controls).
 * Implement using @vimeo/player SDK when Vimeo Pro+ support is needed.
 *
 * @see useFallbackAdapter.ts — current implementation
 * @see https://github.com/vimeo/player.js — future implementation
 */

import type { PlayerAdapter, PlayerOptions } from './types';
import { useFallbackAdapter } from './useFallbackAdapter';

export function useVimeoAdapter(
  embedUrl: string,
  options: PlayerOptions = {}
): PlayerAdapter {
  return useFallbackAdapter(embedUrl, options);
}
