'use client';

/**
 * PlayerControls
 *
 * Minimal custom control bar rendered on top of the iframe overlay.
 * Includes: play/pause toggle, progress scrubber, elapsed/total time, fullscreen.
 *
 * Depends only on PlayerAdapter — no platform-specific code here.
 *
 * @see types.ts      — PlayerAdapter interface
 * @see VideoPlayer.tsx — renders this component above the iframe
 */

import type { PlayerAdapter } from './adapters/types';

interface PlayerControlsProps {
  adapter: PlayerAdapter;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

/** Format seconds to M:SS */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, '0')}`;
}

export default function PlayerControls({ adapter, containerRef }: PlayerControlsProps) {
  const { state, currentTime, duration, muted, play, pause, seek, toggleMute, requestFullscreen } = adapter;
  const isPlaying = state === 'playing' || state === 'buffering';
  const progress  = duration > 0 ? (currentTime / duration) * 100 : 0;

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    seek(Number(e.target.value));
  };

  const handleFullscreen = () => {
    requestFullscreen(containerRef.current);
  };

  return (
    <div
      className="absolute bottom-0 left-0 right-0 flex flex-col gap-1 px-3 pt-6 pb-2 bg-gradient-to-t from-black/80 to-transparent"
      data-testid="player-controls"
    >
      {/* Progress bar */}
      <input
        type="range"
        min={0}
        max={duration || 100}
        value={currentTime}
        step={0.5}
        onChange={handleScrub}
        aria-label="Seek"
        className="w-full h-1 accent-sf-accent cursor-pointer"
      />

      {/* Bottom row */}
      <div className="flex items-center gap-2">
        {/* Play / Pause */}
        <button
          type="button"
          onClick={isPlaying ? pause : play}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          className="shrink-0 w-8 h-8 flex items-center justify-center text-white hover:text-sf-accent transition-colors"
        >
          {isPlaying ? (
            /* Pause icon */
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
            </svg>
          ) : (
            /* Play icon */
            <svg className="w-5 h-5 translate-x-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        {/* Mute */}
        <button
          type="button"
          onClick={toggleMute}
          aria-label={muted ? 'Unmute' : 'Mute'}
          className="shrink-0 w-8 h-8 flex items-center justify-center text-white hover:text-sf-accent transition-colors"
        >
          {muted ? (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
            </svg>
          )}
        </button>

        {/* Time */}
        <span className="text-white text-xs tabular-nums select-none">
          {formatTime(currentTime)}
          {duration > 0 && (
            <span className="text-white/50"> / {formatTime(duration)}</span>
          )}
        </span>

        {/* Spacer */}
        <span className="flex-1" />

        {/* Fullscreen */}
        <button
          type="button"
          onClick={handleFullscreen}
          aria-label="Fullscreen"
          className="shrink-0 w-8 h-8 flex items-center justify-center text-white hover:text-sf-accent transition-colors"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
