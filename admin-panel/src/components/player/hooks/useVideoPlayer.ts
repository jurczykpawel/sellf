'use client';

/**
 * useVideoPlayer — adapter selector hook
 *
 * Selects the appropriate platform adapter based on the parsed video platform.
 * All UI components depend only on the returned PlayerAdapter interface.
 *
 * @see types.ts          — PlayerAdapter interface
 * @see useYouTubeAdapter — YouTube IFrame API
 * @see useVimeoAdapter   — Vimeo stub (fallback)
 * @see useWistiaAdapter  — Wistia stub (fallback)
 * @see useFallbackAdapter — plain iframe, no controls
 */

import type { ParsedVideoUrl } from '@/lib/videoUtils';
import type { PlayerAdapter, PlayerOptions } from '../adapters/types';
import { useYouTubeAdapter } from '../adapters/useYouTubeAdapter';
import { useVimeoAdapter } from '../adapters/useVimeoAdapter';
import { useWistiaAdapter } from '../adapters/useWistiaAdapter';
import { useFallbackAdapter } from '../adapters/useFallbackAdapter';

interface UseVideoPlayerArgs {
  parsed: ParsedVideoUrl;
  options?: PlayerOptions;
}

/**
 * Selects and initialises the correct adapter for the given parsed video URL.
 * Always returns a PlayerAdapter — falls back to the no-control adapter for
 * unknown or unsupported platforms.
 */
export function useVideoPlayer({ parsed, options = {} }: UseVideoPlayerArgs): PlayerAdapter {
  const embedUrl = parsed.embedUrl ?? '';
  const videoId  = parsed.videoId  ?? '';

  const youTube  = useYouTubeAdapter(videoId,  options);
  const vimeo    = useVimeoAdapter(embedUrl,   options);
  const wistia   = useWistiaAdapter(embedUrl,  options);
  const fallback = useFallbackAdapter(embedUrl, options);

  switch (parsed.platform) {
    case 'youtube':  return youTube;
    case 'vimeo':    return vimeo;
    case 'wistia':   return wistia;
    default:         return fallback;
  }
}
