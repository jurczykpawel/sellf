'use client';

/**
 * VideoPlayer — Universal video player component
 *
 * Three rendering modes:
 *
 * 1. supportsControl === true AND useCustomPlayer !== false (YouTube):
 *    - Shows PlayerThumbnail until user clicks Play (skipped when autoplay=true)
 *    - On play: thumbnail fades, div container + PlayerControls appear
 *    - YouTube adapter mounts a <div>; YT.Player creates its own <iframe> inside it
 *    - CSS overscan trick: adapter applies height:200% top:-50% to the YT-created
 *      iframe via onReady, clipping YouTube's native chrome out of the visible area
 *
 * 2. supportsControl === false (Vimeo stub, Bunny.net, Loom, unknown):
 *    - Renders a plain iframe with native platform controls
 *    - No thumbnail, no overlay
 *
 * 3. useCustomPlayer === false (any platform):
 *    - Forces plain iframe mode regardless of adapter capabilities
 *    - Useful when admin wants native platform UI instead of custom player
 *
 * @see useVideoPlayer.ts   — adapter selector
 * @see PlayerThumbnail.tsx — thumbnail + play button
 * @see PlayerControls.tsx  — custom control bar
 */

import { useEffect, useRef, useState } from 'react';
import type { Ref } from 'react';
import type { ParsedVideoUrl } from '@/lib/videoUtils';
import { addEmbedOptions } from '@/lib/videoUtils';
import type { PlayerOptions } from './adapters/types';
import { useVideoPlayer } from './hooks/useVideoPlayer';
import PlayerThumbnail from './PlayerThumbnail';
import PlayerControls from './PlayerControls';

interface VideoPlayerProps {
  parsed: ParsedVideoUrl;
  title: string;
  options?: PlayerOptions;
}

export default function VideoPlayer({ parsed, title, options }: VideoPlayerProps) {
  const adapter = useVideoPlayer({ parsed, options });
  // Pull primitive/ref fields off the adapter once so JSX doesn't repeatedly
  // do property access on a ref-bearing object (React Compiler flags that).
  const {
    iframeRef,
    supportsControl,
    useNativeControls = false,
    error: adapterError,
    play: adapterPlay,
  } = adapter;
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Whether the user has clicked play at least once (triggers iframe mount for YT).
  // When autoplay is enabled, skip the thumbnail and mount the player immediately.
  const autoplay = options?.autoplay === true;
  const [started, setStarted] = useState(autoplay);

  const handleThumbnailPlay = () => {
    setStarted(true);
    adapterPlay();
  };

  // When autoplay is enabled, trigger play() on mount to start API loading.
  // Read the latest adapter.play through a ref so we don't depend on the
  // adapter object (whose identity changes on every parent render).
  const adapterPlayRef = useRef(adapterPlay);
  useEffect(() => {
    adapterPlayRef.current = adapterPlay;
  });
  useEffect(() => {
    if (autoplay) adapterPlayRef.current();
  }, [autoplay]);

  // ── Fallback: plain iframe ────────────────────────────────────────────────
  // Render plain iframe when adapter has no control API OR when custom player
  // is explicitly disabled via useCustomPlayer === false.
  const forceNativePlayer = options?.useCustomPlayer === false;

  if (!supportsControl || forceNativePlayer) {
    const fallbackSrc = parsed.embedUrl
      ? addEmbedOptions(parsed.embedUrl, options ?? {})
      : '';
    return (
      <iframe
        src={fallbackSrc}
        className="w-full h-full"
        frameBorder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        title={title}
        sandbox="allow-scripts allow-same-origin allow-presentation"
      />
    );
  }

  // ── Controlled player (YouTube) ──────────────────────────────────────────
  const showThumbnail    = !started;
  const showControls     = started && !useNativeControls;
  // When using native controls, don't apply the overscan trick — let YT chrome show
  const useOverscan      = !useNativeControls;

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden bg-black"
      data-testid="video-player"
    >
      {/* Error overlay */}
      {adapterError && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/80">
          <p className="text-white/70 text-sm text-center px-4">Video unavailable</p>
        </div>
      )}

      {/* Thumbnail overlay — shown before first play */}
      {showThumbnail && parsed.videoId && !adapterError && (
        <div className="absolute inset-0 z-10">
          <PlayerThumbnail
            videoId={parsed.videoId}
            title={title}
            onPlay={handleThumbnailPlay}
          />
        </div>
      )}

      {/* Player container — always mounted once started so the API can attach.
          YouTube: iframeRef attaches to this <div>. YT.Player creates its own
          <iframe> inside it. The YT-created iframe gets overscan styles applied via
          onReady in useYouTubeAdapter (height 200%, top -50%) so YouTube's native
          chrome is clipped. This div fills the outer container (position absolute, full
          width/height). pointer-events-none when using custom controls so our overlay
          can receive clicks; enabled for native controls mode.
          No sandbox: the YT IFrame API communicates via cross-origin postMessage. */}
      {started && (
        <div
          ref={iframeRef as Ref<HTMLDivElement>}
          className={`absolute inset-0 overflow-hidden ${useOverscan ? 'pointer-events-none' : ''}`}
          data-testid="player-container"
        />
      )}

      {/* Custom control bar */}
      {showControls && (
        <div className="absolute inset-0 z-20 flex flex-col justify-end pointer-events-none">
          <div className="pointer-events-auto">
            <PlayerControls adapter={adapter} containerRef={containerRef} />
          </div>
        </div>
      )}
    </div>
  );
}
