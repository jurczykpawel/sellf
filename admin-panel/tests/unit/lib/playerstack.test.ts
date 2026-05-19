import { describe, expect, it } from 'vitest';
import {
  buildPlayerstackRenderConfig,
  getVideoValidationMessage,
  isPlayerstackPlatform,
  PLAYERSTACK_SCRIPT_SRC,
  PLAYERSTACK_SCRIPT_INTEGRITY,
} from '@/lib/playerstack';

describe('playerstack integration helpers', () => {
  it('serves Playerstack from a same-origin path so npm/CDN compromise cannot reach checkout', () => {
    expect(PLAYERSTACK_SCRIPT_SRC.startsWith('/vendor/playerstack/')).toBe(true);
    expect(PLAYERSTACK_SCRIPT_SRC).toMatch(/playerstack-[a-f0-9]{12}\.min\.js$/);
    expect(PLAYERSTACK_SCRIPT_SRC).not.toMatch(/^https?:\/\//);
  });

  it('pins the Playerstack bundle with an SRI hash so a swapped artifact will not execute', () => {
    expect(PLAYERSTACK_SCRIPT_INTEGRITY).toMatch(/^sha(256|384|512)-[A-Za-z0-9+/=]{32,}$/);
  });

  it('builds a safe YouTube render config without remote trust or endpoint fields', () => {
    const result = buildPlayerstackRenderConfig({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'Intro lesson',
      config: {
        autoplay: false,
        loop: true,
        muted: true,
        controls: true,
        // @ts-expect-error security regression guard for legacy/unsafe fields
        trustRemote: true,
        endpoints: { config: 'https://evil.example/config.json' },
        analytics: { endpoint: 'https://evil.example/collect' },
        emailGate: { webhookUrl: 'https://evil.example/webhook' },
        trustedCss: ['https://evil.example/style.css'],
        embed_code: '<script>alert(1)</script>',
      },
    });

    expect(result).not.toBeNull();
    expect(result!.src).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ');
    expect(result!.platform).toBe('youtube');

    const dataConfig = JSON.parse(result!.dataConfig);
    expect(dataConfig).toMatchObject({
      src: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
      title: 'Intro lesson',
      loop: true,
      muted: true,
      brandedThumb: {
        enabled: true,
        clickToLoad: true,
      },
    });
    expect(JSON.stringify(dataConfig)).not.toContain('trustRemote');
    expect(JSON.stringify(dataConfig)).not.toContain('endpoints');
    expect(JSON.stringify(dataConfig)).not.toContain('analytics');
    expect(JSON.stringify(dataConfig)).not.toContain('emailGate');
    expect(JSON.stringify(dataConfig)).not.toContain('trustedCss');
    expect(JSON.stringify(dataConfig)).not.toContain('embed_code');
  });

  it('uses preview mode for autoplay instead of click-to-load thumbnail mode', () => {
    const result = buildPlayerstackRenderConfig({
      url: 'https://vimeo.com/76979871',
      config: { autoplay: true, loop: true },
    });

    const dataConfig = JSON.parse(result!.dataConfig);
    expect(dataConfig.preview).toEqual({
      enabled: true,
      loopUntilInteraction: true,
    });
    expect(dataConfig.brandedThumb).toBeUndefined();
  });

  it('enables saved-position plugin when config.saved_position is true', () => {
    const result = buildPlayerstackRenderConfig({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      config: { saved_position: true },
    });

    const dataConfig = JSON.parse(result!.dataConfig);
    expect(dataConfig.savedPosition).toEqual({ enabled: true });
  });

  it('does not emit savedPosition when saved_position is falsy', () => {
    const noConfig = buildPlayerstackRenderConfig({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    });
    const explicitFalse = buildPlayerstackRenderConfig({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      config: { saved_position: false },
    });

    expect(JSON.parse(noConfig!.dataConfig).savedPosition).toBeUndefined();
    expect(JSON.parse(explicitFalse!.dataConfig).savedPosition).toBeUndefined();
  });

  it('limits controls through config when controls are disabled', () => {
    const result = buildPlayerstackRenderConfig({
      url: 'https://vimeo.com/76979871',
      config: { controls: false },
    });

    const dataConfig = JSON.parse(result!.dataConfig);
    expect(dataConfig.controls).toEqual({ show: ['play'] });
  });

  it('keeps only HTTPS posters', () => {
    const accepted = buildPlayerstackRenderConfig({
      url: 'https://company.wistia.com/medias/abc123',
      poster: 'https://cdn.example.com/poster.jpg',
    });
    const rejected = buildPlayerstackRenderConfig({
      url: 'https://company.wistia.com/medias/abc123',
      poster: 'http://cdn.example.com/poster.jpg',
    });

    expect(accepted!.poster).toBe('https://cdn.example.com/poster.jpg');
    expect(JSON.parse(accepted!.dataConfig).poster).toBe('https://cdn.example.com/poster.jpg');
    expect(rejected!.poster).toBeUndefined();
    expect(JSON.parse(rejected!.dataConfig).poster).toBeUndefined();
  });

  it('adds Twitch parent from the runtime hostname only', () => {
    const result = buildPlayerstackRenderConfig({
      url: 'https://www.twitch.tv/videos/2321733225',
      twitchParent: 'sellf.techskills.academy',
    });

    const dataConfig = JSON.parse(result!.dataConfig);
    expect(dataConfig.twitch).toEqual({ parent: 'sellf.techskills.academy' });
  });

  it('accepts Bunny HLS and MP4 sources', () => {
    expect(buildPlayerstackRenderConfig({
      url: 'https://vz-12345678.b-cdn.net/course/playlist.m3u8',
    })!.platform).toBe('bunny');

    expect(buildPlayerstackRenderConfig({
      url: 'https://videos.example.b-cdn.net/course/lesson.mp4',
    })!.platform).toBe('bunny');
  });

  it('rejects Bunny iframe embeds before rendering Playerstack', () => {
    const url = 'https://iframe.mediadelivery.net/embed/12345/abc-def';
    expect(buildPlayerstackRenderConfig({ url })).toBeNull();
    expect(getVideoValidationMessage(url)).toBe('bunnyIframeUnsupported');
  });

  it('rejects removed providers', () => {
    expect(buildPlayerstackRenderConfig({ url: 'https://www.loom.com/share/abc123' })).toBeNull();
    expect(buildPlayerstackRenderConfig({ url: 'https://www.dailymotion.com/video/x8abc123' })).toBeNull();
    expect(getVideoValidationMessage('https://www.loom.com/share/abc123')).toBe('unsupportedVideoPlatform');
    expect(getVideoValidationMessage('https://www.dailymotion.com/video/x8abc123')).toBe('unsupportedVideoPlatform');
  });

  it('recognizes only supported Playerstack platforms', () => {
    expect(isPlayerstackPlatform('youtube')).toBe(true);
    expect(isPlayerstackPlatform('vimeo')).toBe(true);
    expect(isPlayerstackPlatform('wistia')).toBe(true);
    expect(isPlayerstackPlatform('bunny')).toBe(true);
    expect(isPlayerstackPlatform('twitch')).toBe(true);
    expect(isPlayerstackPlatform('unknown')).toBe(false);
  });

  it('refuses to render Twitch without a validated parent hostname', () => {
    expect(buildPlayerstackRenderConfig({ url: 'https://www.twitch.tv/videos/2321733225' })).toBeNull();
    expect(buildPlayerstackRenderConfig({
      url: 'https://www.twitch.tv/videos/2321733225',
      twitchParent: '',
    })).toBeNull();
    expect(buildPlayerstackRenderConfig({
      url: 'https://www.twitch.tv/videos/2321733225',
      twitchParent: 'evil host with spaces',
    })).toBeNull();
    expect(buildPlayerstackRenderConfig({
      url: 'https://www.twitch.tv/videos/2321733225',
      twitchParent: 'a".onerror="alert(1)',
    })).toBeNull();
  });

  it('strips HTML markers and control characters from titles without dropping legitimate characters', () => {
    const result = buildPlayerstackRenderConfig({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'Lesson 123: <img src=x onerror=alert(1)> intro\u0000\u001f\u007f',
    });

    const dataConfig = JSON.parse(result!.dataConfig);
    expect(dataConfig.title).toContain('Lesson 123');
    expect(dataConfig.title).not.toContain('<');
    expect(dataConfig.title).not.toContain('>');
    expect(dataConfig.title).not.toMatch(/[\u0000-\u001F\u007F]/);
  });

  it('drops titles that become empty after sanitization', () => {
    const result = buildPlayerstackRenderConfig({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: '<<<>>>',
    });

    expect(result!.title).toBeUndefined();
    expect(JSON.parse(result!.dataConfig).title).toBeUndefined();
  });

  it('rejects Wistia URLs that are not media share links', () => {
    expect(buildPlayerstackRenderConfig({ url: 'https://company.wistia.com/about' })).toBeNull();
    expect(buildPlayerstackRenderConfig({ url: 'https://company.wistia.com/' })).toBeNull();
    expect(getVideoValidationMessage('https://company.wistia.com/about')).toBe('unsupportedVideoPlatform');
  });

  it('does not emit unexpected configuration fields that could activate dangerous plugins', () => {
    const result = buildPlayerstackRenderConfig({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'intro',
      poster: 'https://cdn.example.com/poster.jpg',
      config: { autoplay: false, loop: false, muted: false, controls: true },
    });

    const dataConfig = JSON.parse(result!.dataConfig);
    const allowedKeys = new Set([
      'src', 'poster', 'title', 'loop', 'muted', 'controls', 'brandedThumb', 'preview', 'twitch', 'savedPosition',
    ]);
    for (const key of Object.keys(dataConfig)) {
      expect(allowedKeys.has(key)).toBe(true);
    }
  });
});
