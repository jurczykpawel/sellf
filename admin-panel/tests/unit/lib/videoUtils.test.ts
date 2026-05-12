/**
 * Video Utilities Unit Tests
 *
 * Tests for video URL parsing and embed URL generation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  extractYouTubeVideoId,
  extractVimeoVideoId,
  isBunnyStreamUrl,
  parseTwitchVideoId,
  parseVideoUrl,
  isTrustedVideoPlatform,
  addEmbedOptions,
  getEmbedUrl,
} from '@/lib/videoUtils';

describe('Video Utilities', () => {
  describe('extractYouTubeVideoId', () => {
    it('should extract ID from watch URL', () => {
      expect(extractYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    });

    it('should extract ID from short URL', () => {
      expect(extractYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    });

    it('should extract ID from embed URL', () => {
      expect(extractYouTubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    });

    it('should extract ID from v/ URL', () => {
      expect(extractYouTubeVideoId('https://www.youtube.com/v/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    });

    it('should handle mobile URLs', () => {
      expect(extractYouTubeVideoId('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    });

    it('should handle URLs with additional parameters', () => {
      expect(extractYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=120')).toBe('dQw4w9WgXcQ');
    });

    it('should handle short URL with query params', () => {
      expect(extractYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ?t=30')).toBe('dQw4w9WgXcQ');
    });

    it('should return null for invalid URLs', () => {
      expect(extractYouTubeVideoId('not-a-url')).toBe(null);
      expect(extractYouTubeVideoId('https://youtube.com/channel/abc')).toBe(null);
      expect(extractYouTubeVideoId('')).toBe(null);
    });
  });

  describe('extractVimeoVideoId', () => {
    it('should extract ID from standard URL', () => {
      expect(extractVimeoVideoId('https://vimeo.com/123456789')).toBe('123456789');
    });

    it('should extract ID from player URL', () => {
      expect(extractVimeoVideoId('https://player.vimeo.com/video/123456789')).toBe('123456789');
    });

    it('should return null for channel URLs', () => {
      expect(extractVimeoVideoId('https://vimeo.com/channels/staffpicks')).toBe(null);
    });

    it('should return null for invalid URLs', () => {
      expect(extractVimeoVideoId('not-a-url')).toBe(null);
      expect(extractVimeoVideoId('')).toBe(null);
    });
  });

  describe('isBunnyStreamUrl', () => {
    it('should accept Bunny Stream HLS URLs', () => {
      expect(isBunnyStreamUrl('https://vz-12345678-abc.b-cdn.net/abc-def/playlist.m3u8')).toBe(true);
    });

    it('should accept Bunny pull zone MP4 URLs', () => {
      expect(isBunnyStreamUrl('https://videos.example.b-cdn.net/course/lesson-1.mp4')).toBe(true);
    });

    it('should reject Bunny iframe embeds', () => {
      expect(isBunnyStreamUrl('https://iframe.mediadelivery.net/embed/12345/abc-def-ghi')).toBe(false);
    });

    it('should reject non-Bunny URLs', () => {
      expect(isBunnyStreamUrl('https://youtube.com/watch?v=abc')).toBe(false);
    });
  });

  describe('parseTwitchVideoId', () => {
    it('should parse Twitch VOD URLs', () => {
      expect(parseTwitchVideoId('https://www.twitch.tv/videos/2321733225')).toBe('2321733225');
    });

    it('should parse Twitch channel URLs', () => {
      expect(parseTwitchVideoId('https://www.twitch.tv/somestreamer')).toBe('somestreamer');
    });

    it('should parse Twitch clip URLs', () => {
      expect(parseTwitchVideoId('https://clips.twitch.tv/PoliteSlugHere')).toBe('PoliteSlugHere');
    });
  });

  describe('parseVideoUrl', () => {
    it('should parse YouTube URLs', () => {
      const result = parseVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      expect(result.platform).toBe('youtube');
      expect(result.videoId).toBe('dQw4w9WgXcQ');
      expect(result.embedUrl).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ');
      expect(result.isValid).toBe(true);
    });

    it('should parse Vimeo URLs', () => {
      const result = parseVideoUrl('https://vimeo.com/123456789');
      expect(result.platform).toBe('vimeo');
      expect(result.videoId).toBe('123456789');
      expect(result.embedUrl).toBe('https://player.vimeo.com/video/123456789');
      expect(result.isValid).toBe(true);
    });

    it('should parse Bunny.net HLS URLs', () => {
      const url = 'https://vz-12345678-abc.b-cdn.net/abc-def/playlist.m3u8';
      const result = parseVideoUrl(url);
      expect(result.platform).toBe('bunny');
      expect(result.videoId).toBe('abc-def/playlist.m3u8');
      expect(result.embedUrl).toBe(url);
      expect(result.isValid).toBe(true);
    });

    it('should parse Bunny.net MP4 URLs', () => {
      const url = 'https://videos.example.b-cdn.net/course/lesson-1.mp4';
      const result = parseVideoUrl(url);
      expect(result.platform).toBe('bunny');
      expect(result.videoId).toBe('course/lesson-1.mp4');
      expect(result.embedUrl).toBe(url);
      expect(result.isValid).toBe(true);
    });

    it('should parse Wistia media URLs', () => {
      const result = parseVideoUrl('https://company.wistia.com/medias/abc123');
      expect(result.platform).toBe('wistia');
      expect(result.videoId).toBe('abc123');
      expect(result.embedUrl).toBe('https://company.wistia.com/medias/abc123');
      expect(result.isValid).toBe(true);
    });

    it('should parse Twitch URLs', () => {
      const result = parseVideoUrl('https://www.twitch.tv/videos/2321733225');
      expect(result.platform).toBe('twitch');
      expect(result.videoId).toBe('2321733225');
      expect(result.embedUrl).toBe('https://www.twitch.tv/videos/2321733225');
      expect(result.isValid).toBe(true);
    });

    it('should reject Bunny iframe embeds with a specific reason', () => {
      const result = parseVideoUrl('https://iframe.mediadelivery.net/embed/12345/abc-def');
      expect(result.platform).toBe('bunny');
      expect(result.isValid).toBe(false);
      expect(result.rejectionReason).toBe('bunny_iframe_unsupported');
    });

    it('should reject Loom URLs', () => {
      const result = parseVideoUrl('https://www.loom.com/share/abc123xyz');
      expect(result.platform).toBe('unknown');
      expect(result.isValid).toBe(false);
      expect(result.rejectionReason).toBe('unsupported_platform');
    });

    it('should reject DailyMotion URLs', () => {
      const result = parseVideoUrl('https://www.dailymotion.com/video/x8abc123');
      expect(result.platform).toBe('unknown');
      expect(result.isValid).toBe(false);
      expect(result.rejectionReason).toBe('unsupported_platform');
    });

    it('should return invalid for empty URL', () => {
      const result = parseVideoUrl('');
      expect(result.isValid).toBe(false);
      expect(result.platform).toBe('unknown');
    });

    it('should return invalid for malformed URL', () => {
      const result = parseVideoUrl('not-a-url');
      expect(result.isValid).toBe(false);
    });

    it('should accept already-embed URLs from known platforms', () => {
      const result = parseVideoUrl('https://player.vimeo.com/video/123456');
      expect(result.isValid).toBe(true);
    });
  });

  describe('isTrustedVideoPlatform', () => {
    it('should return true for YouTube', () => {
      expect(isTrustedVideoPlatform('https://www.youtube.com/watch?v=abc')).toBe(true);
      expect(isTrustedVideoPlatform('https://youtu.be/abc')).toBe(true);
    });

    it('should return true for Vimeo', () => {
      expect(isTrustedVideoPlatform('https://vimeo.com/123')).toBe(true);
    });

    it('should return true for Bunny.net stream files', () => {
      expect(isTrustedVideoPlatform('https://vz-12345678.b-cdn.net/video/playlist.m3u8')).toBe(true);
      expect(isTrustedVideoPlatform('https://videos.example.b-cdn.net/video.mp4')).toBe(true);
    });

    it('should return false for Bunny iframe embeds', () => {
      expect(isTrustedVideoPlatform('https://iframe.mediadelivery.net/embed/123/abc')).toBe(false);
    });

    it('should return true for Wistia', () => {
      expect(isTrustedVideoPlatform('https://company.wistia.com/medias/abc')).toBe(true);
      expect(isTrustedVideoPlatform('https://fast.wistia.net/embed/iframe/abc')).toBe(true);
    });

    it('should return true for Twitch', () => {
      expect(isTrustedVideoPlatform('https://www.twitch.tv/videos/2321733225')).toBe(true);
      expect(isTrustedVideoPlatform('https://clips.twitch.tv/PoliteSlugHere')).toBe(true);
    });

    it('should return false for removed providers', () => {
      expect(isTrustedVideoPlatform('https://www.loom.com/share/abc')).toBe(false);
      expect(isTrustedVideoPlatform('https://www.dailymotion.com/video/x8abc123')).toBe(false);
    });

    it('should return false for untrusted domains', () => {
      expect(isTrustedVideoPlatform('https://malicious-site.com/video')).toBe(false);
      expect(isTrustedVideoPlatform('https://fake-video.net/watch?v=abc')).toBe(false);
    });

    it('should return false for empty/invalid URLs', () => {
      expect(isTrustedVideoPlatform('')).toBe(false);
      expect(isTrustedVideoPlatform('not-a-url')).toBe(false);
    });
  });

  describe('addEmbedOptions', () => {
    it('should add YouTube options', () => {
      const url = addEmbedOptions('https://www.youtube.com/embed/abc', { autoplay: true, muted: true });
      expect(url).toContain('autoplay=1');
      expect(url).toContain('mute=1');
    });

    it('should add Vimeo options', () => {
      const url = addEmbedOptions('https://player.vimeo.com/video/123', { autoplay: true, loop: true });
      expect(url).toContain('autoplay=1');
      expect(url).toContain('loop=1');
    });

    it('should leave non-iframe Playerstack sources unchanged', () => {
      const url = addEmbedOptions('https://vz-12345678.b-cdn.net/video/playlist.m3u8', {
        autoplay: true,
        muted: true,
      });
      expect(url).toBe('https://vz-12345678.b-cdn.net/video/playlist.m3u8');
    });

    it('should leave Wistia options to Playerstack config', () => {
      const url = addEmbedOptions('https://fast.wistia.net/embed/iframe/abc', { autoplay: true, muted: true });
      expect(url).toBe('https://fast.wistia.net/embed/iframe/abc');
    });

    it('should return original URL for empty input', () => {
      expect(addEmbedOptions('', {})).toBe('');
    });

    it('should return original URL for invalid URL', () => {
      expect(addEmbedOptions('not-a-url', { autoplay: true })).toBe('not-a-url');
    });

    it('should handle controls=false', () => {
      const ytUrl = addEmbedOptions('https://www.youtube.com/embed/abc', { controls: false });
      expect(ytUrl).toContain('controls=0');

      const vimeoUrl = addEmbedOptions('https://player.vimeo.com/video/123', { controls: false });
      expect(vimeoUrl).toContain('controls=0');
    });
  });

  describe('getEmbedUrl', () => {
    it('should return embed URL for valid video', () => {
      const result = getEmbedUrl('https://www.youtube.com/watch?v=abc123');
      expect(result).toBe('https://www.youtube.com/embed/abc123');
    });

    it('should apply options when provided', () => {
      const result = getEmbedUrl('https://www.youtube.com/watch?v=abc123', { autoplay: true });
      expect(result).toContain('autoplay=1');
    });

    it('should return null for invalid URL', () => {
      expect(getEmbedUrl('not-a-url')).toBe(null);
      expect(getEmbedUrl('')).toBe(null);
    });

    it('should return null for rejected Bunny iframe embeds', () => {
      expect(getEmbedUrl('https://iframe.mediadelivery.net/embed/12345/abc-def')).toBe(null);
    });

    it('should return null for non-video platforms', () => {
      expect(getEmbedUrl('https://unknown-platform.com/video/123')).toBe(null);
    });
  });

  describe('domain spoofing prevention', () => {
    it('should reject hostname that contains trusted domain as substring', () => {
      expect(isTrustedVideoPlatform('https://notyoutube.com/watch?v=abc')).toBe(false);
      expect(isTrustedVideoPlatform('https://notvimeo.com/12345')).toBe(false);
      expect(isTrustedVideoPlatform('https://notloom.com/share/abc')).toBe(false);
      expect(isTrustedVideoPlatform('https://nottwitch.tv/videos/123')).toBe(false);
    });

    it('should reject trusted domain used as subdomain of attacker', () => {
      expect(isTrustedVideoPlatform('https://youtube.com.evil.com/watch?v=abc')).toBe(false);
      expect(isTrustedVideoPlatform('https://vimeo.com.attacker.com/12345')).toBe(false);
    });

    it('should accept legitimate subdomains', () => {
      expect(isTrustedVideoPlatform('https://www.youtube.com/watch?v=abc')).toBe(true);
      expect(isTrustedVideoPlatform('https://m.youtube.com/watch?v=abc')).toBe(true);
      expect(isTrustedVideoPlatform('https://player.vimeo.com/video/12345')).toBe(true);
    });

    it('should reject embed URL from attacker domain with path spoofing', () => {
      const result = parseVideoUrl('https://evil.com/youtube.com/embed/malicious');
      expect(result.isValid).toBe(false);
    });

    it('should reject embed URL from spoofed hostname', () => {
      const result = parseVideoUrl('https://notyoutube.com/embed/abc123');
      expect(result.isValid).toBe(false);
    });
  });
});
