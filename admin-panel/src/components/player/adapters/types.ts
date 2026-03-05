/**
 * Universal Video Player — Adapter interface
 *
 * Every platform adapter (YouTube, Vimeo, Wistia, fallback) must implement this contract.
 * UI components (PlayerControls, VideoPlayer) depend only on this interface — never on
 * a concrete platform implementation.
 *
 * @see useYouTubeAdapter.ts  — YouTube IFrame API implementation
 * @see useVimeoAdapter.ts    — Vimeo Player SDK (stub, implement when needed)
 * @see useWistiaAdapter.ts   — Wistia E-v1.js (stub, implement when needed)
 * @see useFallbackAdapter.ts — Plain iframe, no custom controls
 */

import type { Ref } from 'react';

export type PlayerState =
  | 'unstarted'   // Before first play — thumbnail shown
  | 'loading'     // Player initializing / buffering on first load
  | 'playing'
  | 'paused'
  | 'buffering'   // Mid-playback rebuffering
  | 'ended';

export interface PlayerAdapter {
  /**
   * Ref attached to the player mount element.
   * - YouTube: a <div> placeholder — YT.Player creates its own <iframe> inside it.
   * - Fallback adapters: the <iframe> element directly.
   */
  iframeRef: Ref<HTMLElement | null>;

  /** Current playback state */
  state: PlayerState;

  /** Current playback position in seconds */
  currentTime: number;

  /** Total video duration in seconds (0 if unknown) */
  duration: number;

  /** Whether audio is muted */
  muted: boolean;

  /**
   * Whether this adapter supports programmatic control.
   * false = fallback adapter — VideoPlayer renders a plain iframe without overlay.
   */
  supportsControl: boolean;

  /**
   * When true and supportsControl is true, the player uses native platform controls
   * instead of the custom overlay. VideoPlayer skips the custom controls bar.
   */
  useNativeControls?: boolean;

  // ── Playback controls (no-op when supportsControl === false) ──────────────
  play: () => void;
  pause: () => void;
  /** Seek to position in seconds */
  seek: (seconds: number) => void;
  toggleMute: () => void;
  /** Request native fullscreen on the provided container element */
  requestFullscreen: (containerEl: HTMLElement | null) => void;
}

/** Options forwarded from ContentItem.config to each adapter */
export interface PlayerOptions {
  autoplay?: boolean;
  loop?: boolean;
  muted?: boolean;
  preload?: boolean;
  /** When true, show native platform controls instead of custom overlay */
  controls?: boolean;
}
