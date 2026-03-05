/**
 * Universal Video Player — public API
 *
 * Import VideoPlayer from here in application code.
 * Adapter internals are implementation details; import from adapters/ only when
 * writing new adapter implementations.
 */

export { default as VideoPlayer } from './VideoPlayer';
export { default as PlayerThumbnail } from './PlayerThumbnail';
export { default as PlayerControls } from './PlayerControls';
export { useVideoPlayer } from './hooks/useVideoPlayer';
export type { PlayerAdapter, PlayerOptions, PlayerState } from './adapters/types';
