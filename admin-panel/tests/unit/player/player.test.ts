/**
 * Universal Video Player — Unit Tests
 *
 * Tests for pure logic in the player module:
 * - formatTime: MM:SS formatting
 * - parseVideoUrl platform detection (re-uses existing utility, verifies player-relevant outputs)
 *
 * Note: React hooks (useVideoPlayer, adapters) require a browser environment and
 * cannot be tested with vitest environment: 'node'. Integration testing is done
 * via the Playwright smoke test.
 */

import { describe, it, expect } from 'vitest';
import { formatTime } from '@/components/player/PlayerControls';
import { parseVideoUrl } from '@/lib/videoUtils';

// ── formatTime ────────────────────────────────────────────────────────────────

describe('formatTime', () => {
  it('formats zero as 0:00', () => {
    expect(formatTime(0)).toBe('0:00');
  });

  it('formats sub-minute seconds', () => {
    expect(formatTime(9)).toBe('0:09');
    expect(formatTime(59)).toBe('0:59');
  });

  it('formats exact minutes', () => {
    expect(formatTime(60)).toBe('1:00');
    expect(formatTime(120)).toBe('2:00');
  });

  it('formats minutes and seconds', () => {
    expect(formatTime(75)).toBe('1:15');
    expect(formatTime(3661)).toBe('61:01');
  });

  it('floors fractional seconds', () => {
    expect(formatTime(90.9)).toBe('1:30');
    expect(formatTime(1.99)).toBe('0:01');
  });

  it('clamps negative values to 0:00', () => {
    expect(formatTime(-5)).toBe('0:00');
  });
});

// ── parseVideoUrl — player-relevant platform detection ────────────────────────

describe('parseVideoUrl platform detection (player adapter selection)', () => {
  it('identifies YouTube watch URL', () => {
    const result = parseVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(result.platform).toBe('youtube');
    expect(result.videoId).toBe('dQw4w9WgXcQ');
    expect(result.isValid).toBe(true);
  });

  it('identifies YouTube short URL', () => {
    const result = parseVideoUrl('https://youtu.be/dQw4w9WgXcQ');
    expect(result.platform).toBe('youtube');
    expect(result.videoId).toBe('dQw4w9WgXcQ');
  });

  it('identifies Vimeo URL', () => {
    const result = parseVideoUrl('https://vimeo.com/123456789');
    expect(result.platform).toBe('vimeo');
    expect(result.isValid).toBe(true);
  });

  it('identifies Wistia medias URL', () => {
    const result = parseVideoUrl('https://home.wistia.com/medias/abc123xyz');
    expect(result.platform).toBe('wistia');
    expect(result.isValid).toBe(true);
  });

  it('identifies Bunny.net URL', () => {
    const result = parseVideoUrl('https://iframe.mediadelivery.net/embed/12345/abc-guid');
    expect(result.platform).toBe('bunny');
    expect(result.isValid).toBe(true);
  });

  it('returns isValid false for invalid URL', () => {
    const result = parseVideoUrl('not-a-url');
    expect(result.isValid).toBe(false);
    expect(result.platform).toBe('unknown');
  });

  it('returns isValid false for empty string', () => {
    const result = parseVideoUrl('');
    expect(result.isValid).toBe(false);
  });

  it('sets embedUrl for YouTube', () => {
    const result = parseVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(result.embedUrl).toContain('youtube.com/embed/dQw4w9WgXcQ');
  });
});
