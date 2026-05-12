/**
 * Video URL Utilities
 *
 * Helper functions for parsing and converting video URLs from various platforms
 * into proper embed URLs.
 */

/** Check if hostname matches domain exactly or is a subdomain */
function isHostnameMatch(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith('.' + domain);
}

export interface ParsedVideoUrl {
  platform: 'youtube' | 'vimeo' | 'wistia' | 'twitch' | 'bunny' | 'unknown';
  videoId: string | null;
  embedUrl: string | null;
  isValid: boolean;
  rejectionReason?: 'bunny_iframe_unsupported' | 'unsupported_platform';
}

/**
 * Extract YouTube video ID from various URL formats
 *
 * Supports:
 * - https://www.youtube.com/watch?v=VIDEO_ID
 * - https://youtu.be/VIDEO_ID
 * - https://www.youtube.com/embed/VIDEO_ID
 * - https://m.youtube.com/watch?v=VIDEO_ID
 * - https://www.youtube.com/v/VIDEO_ID
 */
export function extractYouTubeVideoId(url: string): string | null {
  try {
    const urlObj = new URL(url);

    // youtube.com/watch?v=VIDEO_ID
    if (isHostnameMatch(urlObj.hostname, 'youtube.com') && urlObj.searchParams.has('v')) {
      return urlObj.searchParams.get('v');
    }

    // youtu.be/VIDEO_ID
    if (urlObj.hostname === 'youtu.be') {
      return urlObj.pathname.slice(1).split('?')[0];
    }

    // youtube.com/embed/VIDEO_ID or youtube.com/v/VIDEO_ID
    if (isHostnameMatch(urlObj.hostname, 'youtube.com')) {
      const match = urlObj.pathname.match(/\/(embed|v)\/([^/?]+)/);
      if (match) {
        return match[2];
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Extract Vimeo video ID from various URL formats
 *
 * Supports:
 * - https://vimeo.com/VIDEO_ID
 * - https://player.vimeo.com/video/VIDEO_ID
 */
export function extractVimeoVideoId(url: string): string | null {
  try {
    const urlObj = new URL(url);

    // player.vimeo.com/video/VIDEO_ID
    if (urlObj.hostname === 'player.vimeo.com') {
      const match = urlObj.pathname.match(/\/video\/(\d+)/);
      if (match) {
        return match[1];
      }
    }

    // vimeo.com/VIDEO_ID
    if (urlObj.hostname === 'vimeo.com') {
      const match = urlObj.pathname.match(/\/(\d+)/);
      if (match) {
        return match[1];
      }
    }

    return null;
  } catch {
    return null;
  }
}

export function isBunnyStreamUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    const pathname = urlObj.pathname.toLowerCase();

    return (
      hostname.endsWith('.b-cdn.net') &&
      (pathname.endsWith('.m3u8') || pathname.endsWith('.mp4') || pathname.endsWith('.webm'))
    );
  } catch {
    return false;
  }
}

export function parseTwitchVideoId(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();

    if (isHostnameMatch(hostname, 'twitch.tv')) {
      const videoMatch = urlObj.pathname.match(/^\/videos\/(\d+)\/?$/);
      if (videoMatch) return videoMatch[1];

      const channelClipMatch = urlObj.pathname.match(/^\/[^/]+\/clip\/([A-Za-z0-9_-]+)\/?$/);
      if (channelClipMatch) return channelClipMatch[1];

      const channelMatch = urlObj.pathname.match(/^\/([A-Za-z0-9_]{3,25})\/?$/);
      if (channelMatch) return channelMatch[1];
    }

    if (hostname === 'clips.twitch.tv') {
      const slug = urlObj.pathname.replace(/^\/+/, '').split('/')[0];
      return slug || null;
    }

    if (hostname === 'player.twitch.tv') {
      return urlObj.searchParams.get('video')
        ?? urlObj.searchParams.get('channel')
        ?? urlObj.searchParams.get('clip');
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Parse any video URL and return structured information
 */
export function parseVideoUrl(url: string): ParsedVideoUrl {
  if (!url) {
    return {
      platform: 'unknown',
      videoId: null,
      embedUrl: null,
      isValid: false
    };
  }

  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();

    // YouTube
    if (isHostnameMatch(hostname, 'youtube.com') || hostname === 'youtu.be') {
      const videoId = extractYouTubeVideoId(url);
      if (videoId) {
        return {
          platform: 'youtube',
          videoId,
          embedUrl: `https://www.youtube.com/embed/${videoId}`,
          isValid: true
        };
      }
    }

    // Vimeo
    if (isHostnameMatch(hostname, 'vimeo.com')) {
      const videoId = extractVimeoVideoId(url);
      if (videoId) {
        return {
          platform: 'vimeo',
          videoId,
          embedUrl: `https://player.vimeo.com/video/${videoId}`,
          isValid: true
        };
      }
    }

    // Bunny Stream: use HLS or MP4/WebM from a Bunny CDN pull zone.
    if (hostname === 'iframe.mediadelivery.net') {
      return {
        platform: 'bunny',
        videoId: null,
        embedUrl: null,
        isValid: false,
        rejectionReason: 'bunny_iframe_unsupported'
      };
    }

    if (isBunnyStreamUrl(url)) {
      return {
        platform: 'bunny',
        videoId: urlObj.pathname.replace(/^\/+/, ''),
        embedUrl: url,
        isValid: true
      };
    }

    // Wistia
    if (isHostnameMatch(hostname, 'wistia.com') || isHostnameMatch(hostname, 'wistia.net')) {
      // Check if already embed URL
      if (urlObj.pathname.includes('/embed/iframe/')) {
        const match = urlObj.pathname.match(/\/embed\/iframe\/([a-zA-Z0-9]+)/);
        if (match) {
          return {
            platform: 'wistia',
            videoId: match[1],
            embedUrl: url,
            isValid: true
          };
        }
      }

      if (urlObj.pathname.includes('/medias/')) {
        const match = urlObj.pathname.match(/\/medias\/([a-zA-Z0-9]+)/);
        if (match) {
          const videoId = match[1];
          return {
            platform: 'wistia',
            videoId,
            embedUrl: url,
            isValid: true
          };
        }
      }

      return {
        platform: 'wistia',
        videoId: null,
        embedUrl: null,
        isValid: false,
        rejectionReason: 'unsupported_platform'
      };
    }

    // Twitch
    if (isHostnameMatch(hostname, 'twitch.tv') || hostname === 'clips.twitch.tv' || hostname === 'player.twitch.tv') {
      const videoId = parseTwitchVideoId(url);
      return {
        platform: 'twitch',
        videoId,
        embedUrl: url,
        isValid: Boolean(videoId)
      };
    }

    if (isHostnameMatch(hostname, 'loom.com') || isHostnameMatch(hostname, 'dailymotion.com')) {
      return {
        platform: 'unknown',
        videoId: null,
        embedUrl: null,
        isValid: false,
        rejectionReason: 'unsupported_platform'
      };
    }

    // If URL matches allowed embed domains but we couldn't parse a video ID,
    // assume it's already a valid embed URL
    const allowedEmbedPatterns = [
      { domain: 'youtube.com', pathPrefix: '/embed' },
      { domain: 'player.vimeo.com', pathPrefix: '' },
      { domain: 'fast.wistia.com', pathPrefix: '' },
      { domain: 'player.twitch.tv', pathPrefix: '' },
    ];

    if (allowedEmbedPatterns.some(({ domain, pathPrefix }) =>
      isHostnameMatch(hostname, domain) && (!pathPrefix || urlObj.pathname.startsWith(pathPrefix))
    )) {
      return {
        platform: 'unknown',
        videoId: null,
        embedUrl: url,
        isValid: true
      };
    }

  } catch {
    // Invalid URL
  }

  return {
    platform: 'unknown',
    videoId: null,
    embedUrl: null,
    isValid: false
  };
}

/**
 * Check if a URL is from a trusted video platform
 */
export function isTrustedVideoPlatform(url: string): boolean {
  if (!url) return false;

  const trustedDomains = [
    'youtube.com',
    'youtu.be',
    'vimeo.com',
    'b-cdn.net', // Bunny Stream HLS/MP4 pull zones
    'wistia.com',
    'wistia.net',
    'twitch.tv',
    'clips.twitch.tv',
    'player.twitch.tv'
  ];

  try {
    const urlObj = new URL(url);
    if (isHostnameMatch(urlObj.hostname, 'b-cdn.net')) {
      return isBunnyStreamUrl(url);
    }

    return trustedDomains.some(domain => isHostnameMatch(urlObj.hostname, domain));
  } catch {
    return false;
  }
}

/**
 * Video embed options
 */
export interface VideoEmbedOptions {
  autoplay?: boolean;
  loop?: boolean;
  muted?: boolean;
  controls?: boolean;
}

/**
 * Add query parameters to embed URL based on platform and options
 */
export function addEmbedOptions(embedUrl: string, options: VideoEmbedOptions = {}): string {
  if (!embedUrl) return embedUrl;

  try {
    const url = new URL(embedUrl);
    const hostname = url.hostname.toLowerCase();

    // YouTube parameters
    if (isHostnameMatch(hostname, 'youtube.com')) {
      if (options.autoplay) url.searchParams.set('autoplay', '1');
      if (options.loop) url.searchParams.set('loop', '1');
      if (options.muted) url.searchParams.set('mute', '1');
      if (options.controls === false) url.searchParams.set('controls', '0');
    }

    // Vimeo parameters
    else if (isHostnameMatch(hostname, 'vimeo.com')) {
      if (options.autoplay) url.searchParams.set('autoplay', '1');
      if (options.loop) url.searchParams.set('loop', '1');
      if (options.muted) url.searchParams.set('muted', '1');
      if (options.controls === false) url.searchParams.set('controls', '0');
    }

    return url.toString();
  } catch {
    return embedUrl;
  }
}

/**
 * Get embed URL from any video URL
 * Returns null if URL is invalid or not from a trusted platform
 */
export function getEmbedUrl(url: string, options?: VideoEmbedOptions): string | null {
  const parsed = parseVideoUrl(url);
  if (!parsed.isValid || !parsed.embedUrl) return null;

  return options ? addEmbedOptions(parsed.embedUrl, options) : parsed.embedUrl;
}
