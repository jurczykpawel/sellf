'use client';

/**
 * PlayerThumbnail
 *
 * Displays a YouTube thumbnail (maxresdefault → hqdefault fallback) with a
 * centred play button overlay. Clicking calls onPlay to hand off to the iframe.
 *
 * Only used when the adapter supportsControl === true (i.e. YouTube).
 */

import { useState } from 'react';
import Image from 'next/image';

interface PlayerThumbnailProps {
  videoId: string;
  title: string;
  onPlay: () => void;
}

export default function PlayerThumbnail({ videoId, title, onPlay }: PlayerThumbnailProps) {
  // YouTube serves maxresdefault for most videos; fall back to hqdefault for older ones.
  const [src, setSrc] = useState(
    `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
  );

  return (
    <button
      type="button"
      onClick={onPlay}
      aria-label={`Play ${title}`}
      data-testid="player-thumbnail"
      className="relative w-full h-full group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sf-accent"
    >
      {/* Thumbnail image */}
      <Image
        src={src}
        alt={title}
        fill
        sizes="(max-width: 768px) 100vw, 800px"
        className="object-cover"
        onError={() => setSrc(`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`)}
        priority
      />

      {/* Dark overlay on hover */}
      <span className="absolute inset-0 bg-black/20 group-hover:bg-black/40 transition-colors" aria-hidden />

      {/* Play button */}
      <span
        className="absolute inset-0 flex items-center justify-center"
        aria-hidden
      >
        <span className="w-16 h-16 rounded-full bg-black/70 group-hover:bg-black/90 flex items-center justify-center transition-colors shadow-xl">
          <svg
            className="w-7 h-7 text-white translate-x-0.5"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
      </span>
    </button>
  );
}
