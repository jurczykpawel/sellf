'use client';

/**
 * YouTube IFrame API adapter
 *
 * Implements PlayerAdapter using the YouTube IFrame Player API.
 * Uses lazy initialization: the API is NOT loaded on mount — it loads only
 * when the user calls play(). This avoids the classic race condition where
 * the API resolves before the element is in the DOM.
 *
 * Mount point — <div>, not <iframe>:
 *   When YT.Player receives a div element ID it creates its own <iframe>
 *   with the correct YouTube embed src. Passing an existing <iframe src="about:blank">
 *   causes postMessage to target an 'about:' origin, which throws a SyntaxError
 *   and prevents onReady from ever firing (black screen).
 *
 * Initialization gate (tryInit):
 *   Both conditions must be true before YT.Player is created:
 *   1. YT API script has loaded (apiReadyRef === true)
 *   2. The container div is in the DOM (containerElRef.current !== null)
 *   Whichever condition is satisfied last fires tryInit() — guaranteed safe.
 *
 * Callback ref pattern:
 *   Instead of useRef, the adapter exposes a callback ref (iframeRef).
 *   VideoPlayer attaches it to the <div> placeholder. When the div
 *   mounts/unmounts, React calls the callback, allowing us to react to
 *   DOM availability.
 *
 * CSS overscan trick (from Presto Player):
 *   The YT-created <iframe> inside the container div is styled to height 200%,
 *   top -50% so YouTube's native chrome is clipped out of the visible area.
 *   The container has overflow: hidden. The overscan styles are applied to the
 *   inner iframe via onReady (queried from the container). The outer container
 *   sizing/positioning is handled in VideoPlayer.tsx.
 *
 * @see https://developers.google.com/youtube/iframe_api_reference
 */

import { useRef, useState, useEffect, useCallback } from 'react';
import type { PlayerAdapter, PlayerOptions, PlayerState } from './types';

// ── YouTube IFrame API type declarations ──────────────────────────────────────

declare global {
  interface Window {
    YT: typeof YT;
    onYouTubeIframeAPIReady: () => void;
    _ytApiLoading?: boolean;
    _ytApiReady?: boolean;
    _ytApiCallbacks?: Array<() => void>;
  }
}

declare namespace YT {
  enum PlayerState {
    UNSTARTED = -1,
    ENDED = 0,
    PLAYING = 1,
    PAUSED = 2,
    BUFFERING = 3,
    CUED = 5,
  }

  interface PlayerOptions {
    videoId: string;
    playerVars?: Record<string, string | number>;
    events?: {
      onReady?: (event: PlayerEvent) => void;
      onStateChange?: (event: OnStateChangeEvent) => void;
    };
  }

  interface PlayerEvent {
    target: Player;
  }

  interface OnStateChangeEvent {
    target: Player;
    data: PlayerState;
  }

  class Player {
    constructor(elementId: string, options: PlayerOptions);
    playVideo(): void;
    pauseVideo(): void;
    seekTo(seconds: number, allowSeekAhead: boolean): void;
    mute(): void;
    unMute(): void;
    isMuted(): boolean;
    getCurrentTime(): number;
    getDuration(): number;
    destroy(): void;
  }
}

// ── Singleton YT API loader ───────────────────────────────────────────────────

const YT_API_TIMEOUT_MS = 15_000;

function loadYouTubeApi(): Promise<void> {
  // Already loaded
  if (window._ytApiReady) return Promise.resolve();

  return new Promise((resolve, reject) => {
    if (!window._ytApiCallbacks) window._ytApiCallbacks = [];
    window._ytApiCallbacks.push(resolve);

    if (!window._ytApiLoading) {
      window._ytApiLoading = true;

      const timeout = setTimeout(() => {
        window._ytApiLoading = false;
        window._ytApiCallbacks = [];
        reject(new Error('YouTube IFrame API failed to load within timeout'));
      }, YT_API_TIMEOUT_MS);

      const prevReady = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        clearTimeout(timeout);
        window._ytApiReady = true;
        if (prevReady) prevReady();
        window._ytApiCallbacks?.forEach((cb) => cb());
        window._ytApiCallbacks = [];
      };

      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.onerror = () => {
        clearTimeout(timeout);
        window._ytApiLoading = false;
        window._ytApiCallbacks?.forEach((cb) => cb());
        window._ytApiCallbacks = [];
        reject(new Error('Failed to load YouTube IFrame API script'));
      };
      document.head.appendChild(script);
    }
  });
}

// ── YT state → PlayerState mapping ───────────────────────────────────────────

function ytStateToPlayerState(ytState: YT.PlayerState): PlayerState {
  switch (ytState) {
    case YT.PlayerState.PLAYING:   return 'playing';
    case YT.PlayerState.PAUSED:    return 'paused';
    case YT.PlayerState.BUFFERING: return 'buffering';
    case YT.PlayerState.ENDED:     return 'ended';
    default:                        return 'unstarted';
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useYouTubeAdapter(
  videoId: string,
  options: PlayerOptions = {}
): PlayerAdapter {
  // DOM ref — updated via callback ref (iframeRef below)
  const containerElRef = useRef<HTMLElement | null>(null);
  const playerRef      = useRef<YT.Player | null>(null);
  // Lazy init keeps Math.random() out of the render body. The id is captured
  // once per hook instance and is stable across re-renders.
  const [containerId] = useState(() => `yt-player-${videoId}-${Math.random().toString(36).slice(2, 7)}`);

  // Gate flags — tryInit runs only when both are true
  const apiReadyRef    = useRef(false);
  const pendingPlayRef = useRef(false);
  const mountedRef     = useRef(false);

  // Capture latest options in a ref so callbacks always see current values
  // without needing to be listed as useCallback dependencies
  const optionsRef = useRef(options);
  useEffect(() => { optionsRef.current = options; });

  const [state, setState] = useState<PlayerState>('unstarted');
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(options.muted ?? false);

  // Tick current time while playing
  useEffect(() => {
    if (state !== 'playing') return;
    const interval = setInterval(() => {
      if (playerRef.current) {
        setCurrentTime(playerRef.current.getCurrentTime());
      }
    }, 500);
    return () => clearInterval(interval);
  }, [state]);

  // ── Core init ─────────────────────────────────────────────────────────────

  /**
   * Creates the YT.Player instance. Both gates must be open:
   *   - apiReadyRef.current === true   (YT script loaded)
   *   - containerElRef.current !== null (container div in DOM)
   * Called from either gate-completion site (whichever is last).
   *
   * We pass the container div's ID to YT.Player. The API then creates its own
   * <iframe> inside the div with a proper YouTube embed src — this avoids the
   * postMessage/invalid-origin error that occurs when passing an existing
   * <iframe src="about:blank"> element.
   */
  const tryInit = useCallback(() => {
    if (!apiReadyRef.current || !containerElRef.current || playerRef.current) return;

    const container = containerElRef.current;
    container.id = containerId;

    const opts = optionsRef.current;

    playerRef.current = new window.YT.Player(containerId, {
      videoId,
      playerVars: {
        controls: opts.controls ? 1 : 0,
        disablekb: opts.controls ? 0 : 1,
        rel: 0,
        showinfo: 0,
        modestbranding: 1,
        iv_load_policy: 3,
        playsinline: 1,
        enablejsapi: 1,
        autoplay: opts.autoplay ? 1 : 0,
        loop: opts.loop ? 1 : 0,
        mute: opts.muted ? 1 : 0,
        ...(opts.loop ? { playlist: videoId } : {}),
      },
      events: {
        onReady: (event) => {
          // Apply overscan styles to the YT-created iframe inside our container div.
          // When useNativeControls is false (custom controls mode), clip YT chrome.
          if (!optionsRef.current.controls) {
            const ytIframe = containerElRef.current?.querySelector('iframe');
            if (ytIframe) {
              ytIframe.style.position = 'absolute';
              ytIframe.style.left = '0';
              ytIframe.style.width = '100%';
              ytIframe.style.height = '200%';
              ytIframe.style.top = '-50%';
              ytIframe.style.pointerEvents = 'none';
            }
          }
          setDuration(event.target.getDuration());
          setMuted(event.target.isMuted());
          if (opts.autoplay || pendingPlayRef.current) {
            pendingPlayRef.current = false;
            event.target.playVideo();
            setState('playing');
          }
        },
        onStateChange: (event) => {
          setState(ytStateToPlayerState(event.data));
          setDuration(event.target.getDuration());
        },
      },
    });
  }, [videoId, containerId]); // both stable per player instance; options read via optionsRef

  /**
   * Callback ref — React calls this whenever the container <div> mounts or unmounts.
   * On mount: store the element, open the container gate, attempt init.
   * On unmount: clear the element ref so tryInit stays blocked.
   */
  const iframeRef = useCallback((el: HTMLElement | null) => {
    containerElRef.current = el;
    if (el) {
      // Container gate opens — try to init (succeeds only if API is also ready)
      tryInit();
    }
  }, [tryInit]);

  // Track mount state — survives StrictMode mount/unmount/remount cycle
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (playerRef.current) {
        try { playerRef.current.destroy(); } catch { /* ignore */ }
        playerRef.current = null;
      }
      apiReadyRef.current = false;
      pendingPlayRef.current = false;
    };
  }, []);

  // ── Controls ─────────────────────────────────────────────────────────────

  const play = useCallback(() => {
    if (playerRef.current) {
      // Player already initialised — just play
      playerRef.current.playVideo();
      setState('playing');
      return;
    }

    // Mark intent so onReady auto-plays once the player is initialised
    pendingPlayRef.current = true;

    // Lazy-load the YT API, then open the API gate and attempt init.
    // If the container div is already in the DOM (containerElRef set by callback ref),
    // tryInit will create the player immediately.
    // If the container hasn't mounted yet (React batched the setStarted re-render),
    // tryInit will be a no-op here and will fire again from the callback ref
    // once React flushes the render and the container div enters the DOM.
    loadYouTubeApi().then(() => {
      if (!mountedRef.current) return;
      apiReadyRef.current = true;
      tryInit();
    }).catch((err) => {
      if (!mountedRef.current) return;
      pendingPlayRef.current = false;
      setError(err instanceof Error ? err.message : 'Failed to load YouTube player');
      setState('ended');
    });
  }, [tryInit]);

  const pause = useCallback(() => {
    playerRef.current?.pauseVideo();
    setState('paused');
  }, []);

  const seek = useCallback((seconds: number) => {
    playerRef.current?.seekTo(seconds, true);
    setCurrentTime(seconds);
  }, []);

  const toggleMute = useCallback(() => {
    if (!playerRef.current) return;
    if (playerRef.current.isMuted()) {
      playerRef.current.unMute();
      setMuted(false);
    } else {
      playerRef.current.mute();
      setMuted(true);
    }
  }, []);

  const requestFullscreen = useCallback((containerEl: HTMLElement | null) => {
    const target = containerEl ?? containerElRef.current;
    if (!target) return;
    if (target.requestFullscreen) {
      target.requestFullscreen().catch(() => { /* ignore */ });
    }
  }, []);

  return {
    iframeRef,
    state,
    currentTime,
    duration,
    muted,
    error,
    supportsControl: true,
    useNativeControls: options.controls === true,
    play,
    pause,
    seek,
    toggleMute,
    requestFullscreen,
  };
}
