import type { ContentItemConfig } from '@/types';
import type { ParsedVideoUrl } from '@/lib/videoUtils';
import { parseVideoUrl } from '@/lib/videoUtils';

export const PLAYERSTACK_SCRIPT_SRC = '/vendor/playerstack/playerstack-6e679251cbfb.min.js';
export const PLAYERSTACK_SCRIPT_INTEGRITY =
  'sha384-dqCTFihhXn9nwxfGbeTqUP3yKlmli1ZhI1upL1X9rM8R7Bo6qQuJlO7MD3Jpkc9d';
export const PLAYERSTACK_COMMIT_SHA = 'c40cf5296dfea8569e21fc9b06a1f99876e3be53';

export type PlayerstackPlatform = 'youtube' | 'vimeo' | 'wistia' | 'twitch' | 'bunny';

export interface PlayerstackRenderConfig {
  src: string;
  poster?: string;
  title?: string;
  dataConfig: string;
  platform: PlayerstackPlatform;
}

interface BuildPlayerstackConfigInput {
  url: string;
  title?: string;
  config?: ContentItemConfig | null;
  poster?: string | null;
  twitchParent?: string | null;
}

type PlayerstackConfigJson = {
  src: string;
  poster?: string;
  title?: string;
  loop?: boolean;
  muted?: boolean;
  controls?: {
    show?: Array<'play' | 'progress' | 'time' | 'volume' | 'fullscreen' | 'speed'>;
  };
  brandedThumb?: {
    enabled: boolean;
    clickToLoad?: boolean;
    playButtonStyle?: 'circle' | 'box';
  };
  preview?: {
    enabled: boolean;
    loopUntilInteraction?: boolean;
  };
  twitch?: {
    parent: string;
  };
};

const PLAYERSTACK_PLATFORMS = new Set<ParsedVideoUrl['platform']>([
  'youtube',
  'vimeo',
  'wistia',
  'twitch',
  'bunny',
]);

const HOSTNAME_PATTERN = /^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

export function isPlayerstackPlatform(platform: ParsedVideoUrl['platform']): platform is PlayerstackPlatform {
  return PLAYERSTACK_PLATFORMS.has(platform);
}

export function getTwitchParent(): string | null {
  if (typeof window === 'undefined') return null;
  const hostname = window.location.hostname;
  if (!hostname) return null;
  if (!HOSTNAME_PATTERN.test(hostname)) return null;
  return hostname.toLowerCase();
}

export function buildPlayerstackRenderConfig({
  url,
  title,
  config,
  poster,
  twitchParent,
}: BuildPlayerstackConfigInput): PlayerstackRenderConfig | null {
  const parsed = parseVideoUrl(url);
  if (!parsed.isValid || !parsed.embedUrl || !isPlayerstackPlatform(parsed.platform)) {
    return null;
  }

  if (parsed.platform === 'twitch' && (!twitchParent || !HOSTNAME_PATTERN.test(twitchParent))) {
    return null;
  }

  const normalizedPoster = safeOptionalHttpUrl(poster || config?.thumbnail_url);
  const playerConfig: PlayerstackConfigJson = {
    src: parsed.embedUrl,
  };

  const normalizedTitle = safeOptionalTitle(title);
  if (normalizedTitle) {
    playerConfig.title = normalizedTitle;
  }

  if (normalizedPoster) {
    playerConfig.poster = normalizedPoster;
  }

  if (config?.loop) {
    playerConfig.loop = true;
  }

  if (config?.muted) {
    playerConfig.muted = true;
  }

  if (config?.controls === false) {
    playerConfig.controls = { show: ['play'] };
  }

  if (config?.autoplay) {
    playerConfig.preview = {
      enabled: true,
      loopUntilInteraction: config.loop !== false,
    };
  } else {
    playerConfig.brandedThumb = {
      enabled: true,
      clickToLoad: true,
      playButtonStyle: 'circle',
    };
  }

  if (parsed.platform === 'twitch' && twitchParent) {
    playerConfig.twitch = { parent: twitchParent.toLowerCase() };
  }

  return {
    src: playerConfig.src,
    poster: playerConfig.poster,
    title: playerConfig.title,
    dataConfig: JSON.stringify(playerConfig),
    platform: parsed.platform,
  };
}

export function getVideoValidationMessage(url: string): 'ok' | 'bunnyIframeUnsupported' | 'unsupportedVideoPlatform' | 'invalidVideoUrl' {
  const parsed = parseVideoUrl(url);

  if (parsed.isValid && isPlayerstackPlatform(parsed.platform)) {
    return 'ok';
  }

  if (parsed.rejectionReason === 'bunny_iframe_unsupported') {
    return 'bunnyIframeUnsupported';
  }

  if (parsed.rejectionReason === 'unsupported_platform' || parsed.platform === 'unknown') {
    return 'unsupportedVideoPlatform';
  }

  return 'invalidVideoUrl';
}

function safeOptionalHttpUrl(value?: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

const TITLE_STRIP_PATTERN = /[\u0000-\u001F\u007F<>"'`]/g;

function safeOptionalTitle(value?: string | null): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(TITLE_STRIP_PATTERN, '').trim();
  if (!normalized) return undefined;
  return truncate(normalized, 200);
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}
