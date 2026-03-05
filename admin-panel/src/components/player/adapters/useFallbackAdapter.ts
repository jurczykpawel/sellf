'use client';

/**
 * Fallback adapter — used for platforms without a JS control API (Bunny.net, Loom, etc.)
 * and as a safe default for unknown platforms.
 *
 * Renders a plain iframe with native platform controls. supportsControl === false
 * signals VideoPlayer to skip the thumbnail/overlay entirely.
 */

import { useRef } from 'react';
import type { PlayerAdapter, PlayerOptions } from './types';

export function useFallbackAdapter(
  _embedUrl: string,
  _options: PlayerOptions = {}
): PlayerAdapter {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const noop = () => {};

  return {
    iframeRef,
    state: 'unstarted',
    currentTime: 0,
    duration: 0,
    muted: false,
    supportsControl: false,
    play: noop,
    pause: noop,
    seek: noop,
    toggleMute: noop,
    requestFullscreen: noop,
  };
}
