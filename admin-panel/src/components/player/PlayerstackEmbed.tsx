'use client';

import { createElement, useEffect, useMemo, useState } from 'react';
import type { ContentItemConfig } from '@/types';
import {
  buildPlayerstackRenderConfig,
  getTwitchParent,
  PLAYERSTACK_SCRIPT_SRC,
  PLAYERSTACK_SCRIPT_INTEGRITY,
} from '@/lib/playerstack';

interface PlayerstackEmbedProps {
  url: string;
  title: string;
  config?: ContentItemConfig | null;
  poster?: string | null;
}

let playerstackScriptPromise: Promise<void> | null = null;

function removeStalePlayerstackScripts() {
  if (typeof document === 'undefined') return;
  document
    .querySelectorAll<HTMLScriptElement>('script[data-sellf-playerstack="true"]')
    .forEach((node) => node.remove());
}

function loadPlayerstackScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (customElements.get('player-stack')) return Promise.resolve();
  if (playerstackScriptPromise) return playerstackScriptPromise;

  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = PLAYERSTACK_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.integrity = PLAYERSTACK_SCRIPT_INTEGRITY;
    script.dataset.sellfPlayerstack = 'true';
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      reject(new Error('Failed to load Playerstack'));
    };
    document.head.appendChild(script);
  }).catch((err) => {
    removeStalePlayerstackScripts();
    playerstackScriptPromise = null;
    throw err;
  });

  playerstackScriptPromise = promise;
  return promise;
}

export default function PlayerstackEmbed({ url, title, config, poster }: PlayerstackEmbedProps) {
  const [scriptReady, setScriptReady] = useState(false);
  const [scriptError, setScriptError] = useState(false);
  const [twitchParent] = useState<string | null>(() => getTwitchParent());

  useEffect(() => {
    let cancelled = false;

    loadPlayerstackScript()
      .then(() => {
        if (!cancelled) setScriptReady(true);
      })
      .catch(() => {
        if (!cancelled) setScriptError(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const renderConfig = useMemo(
    () => buildPlayerstackRenderConfig({ url, title, config, poster, twitchParent }),
    [url, title, config, poster, twitchParent]
  );

  if (!renderConfig) {
    return null;
  }

  if (scriptError) {
    return (
      <div className="flex h-full min-h-[180px] items-center justify-center bg-black text-sm text-white/70">
        Video unavailable
      </div>
    );
  }

  if (!scriptReady) {
    return (
      <div
        className="flex h-full min-h-[180px] items-center justify-center bg-black text-sm text-white/70"
        data-testid="playerstack-loading"
      >
        Loading video...
      </div>
    );
  }

  return (
    <>
      {createElement('player-stack', {
        src: renderConfig.src,
        poster: renderConfig.poster,
        title: renderConfig.title,
        'data-config': renderConfig.dataConfig,
        'data-testid': 'playerstack-embed',
        className: 'block h-full w-full',
      })}
    </>
  );
}
