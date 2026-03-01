'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { ContentItem } from '@/types';
import { parseVideoUrl, isTrustedVideoPlatform, addEmbedOptions } from '@/lib/videoUtils';

interface DigitalContentRendererProps {
  contentItems: ContentItem[];
  productName: string;
}

export default function DigitalContentRenderer({ contentItems, productName }: DigitalContentRendererProps) {
  const t = useTranslations('digitalContent');
  const sortedItems = contentItems
    .filter(item => item.is_active)
    .sort((a, b) => a.order - b.order);

  const renderContentItem = (item: ContentItem) => {
    switch (item.type) {
      case 'video_embed':
        return (
          <div key={item.id} className="bg-white/10 border border-white/10 rounded-lg p-6 mb-6">
            <div className="flex items-start mb-4">
              <div className="bg-gf-accent-soft p-3 rounded-lg mr-4">
                <svg className="w-6 h-6 text-gf-accent" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="text-white font-medium text-lg mb-2">{item.title}</h3>
                {item.description && (
                  <p className="text-gf-muted text-sm mb-4">{item.description}</p>
                )}
                {item.config.duration && (
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-500/20 text-blue-300 border border-blue-500/30">
                    <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {item.config.duration}
                  </span>
                )}
              </div>
            </div>
            
            {item.config.embed_url && (
              <div className="aspect-video bg-black/20 rounded-lg overflow-hidden">
                {(() => {
                  const url = item.config.embed_url;

                  // Parse and validate the video URL
                  const parsed = parseVideoUrl(url);

                  if (!parsed.isValid || !parsed.embedUrl) {
                    return (
                      <div className="flex items-center justify-center h-full p-4">
                        <div className="text-center">
                          <div className="text-red-500 font-bold mb-2">⚠️ {t('invalidVideoUrl')}</div>
                          <div className="text-sm text-gf-muted mb-2">
                            {!isTrustedVideoPlatform(url)
                              ? t('trustedPlatformsOnly')
                              : t('unableToParseUrl')}
                          </div>
                          <div className="text-xs text-gray-600 font-mono bg-gray-800 p-2 rounded">
                            {url}
                          </div>
                        </div>
                      </div>
                    );
                  }

                  // Show platform badge
                  const platformBadge = parsed.platform !== 'unknown' && (
                    <div className="absolute top-2 right-2 z-10">
                      <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-black/50 text-white backdrop-blur-sm">
                        {parsed.platform === 'youtube' && '📺 YouTube'}
                        {parsed.platform === 'vimeo' && '🎬 Vimeo'}
                        {parsed.platform === 'bunny' && '🐰 Bunny.net'}
                        {parsed.platform === 'loom' && '🎥 Loom'}
                        {parsed.platform === 'wistia' && '📹 Wistia'}
                        {parsed.platform === 'dailymotion' && '🎞️ DailyMotion'}
                        {parsed.platform === 'twitch' && '🎮 Twitch'}
                      </span>
                    </div>
                  );

                  // Apply embed options (autoplay, loop, muted, etc.)
                  const embedUrlWithOptions = addEmbedOptions(parsed.embedUrl, {
                    autoplay: item.config.autoplay,
                    loop: item.config.loop,
                    muted: item.config.muted,
                    preload: item.config.preload,
                    controls: item.config.controls
                  });

                  return (
                    <div className="relative">
                      {platformBadge}
                      <iframe
                        src={embedUrlWithOptions}
                        className="w-full h-full"
                        frameBorder="0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        title={item.title}
                        sandbox="allow-scripts allow-same-origin allow-presentation"
                      />
                    </div>
                  );
                })()}
              </div>
            )}
            
            {item.config.embed_code && !item.config.embed_url && (
              <div className="aspect-video bg-black/20 rounded-lg overflow-hidden p-4">
                <div className="text-red-500 font-bold">
                  ⚠️ {t('securityEmbedDisabled')}
                </div>
                <div className="text-sm text-gf-muted mt-2">
                  {t('useIframeInstead')}
                </div>
              </div>
            )}
          </div>
        );

      case 'download_link':
        return (
          <div key={item.id} className="bg-white/10 border border-white/10 rounded-lg p-6 mb-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center flex-1">
                <div className="bg-blue-500/20 p-3 rounded-lg mr-4">
                  <svg className="w-6 h-6 text-blue-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h3 className="text-white font-medium text-lg mb-1">{item.title}</h3>
                  {item.description && (
                    <p className="text-gf-muted text-sm mb-2">{item.description}</p>
                  )}
                  <div className="flex items-center gap-3 text-sm text-gf-muted">
                    {item.config.file_name && (
                      <span className="flex items-center">
                        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        {item.config.file_name}
                      </span>
                    )}
                    {item.config.file_size && (
                      <span className="flex items-center">
                        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                        </svg>
                        {item.config.file_size}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              
              {item.config.download_url && (
                (() => {
                  const url = item.config.download_url;
                  // Validate download URL to prevent malicious downloads
                  const isValidUrl = url && (
                    url.startsWith('https://') &&
                    (url.includes('amazonaws.com') || 
                     url.includes('googleapis.com') ||
                     url.includes('supabase.co') ||
                     url.includes('cdn.') ||
                     url.includes('storage.'))
                  );
                  
                  if (!isValidUrl) {
                    return (
                      <div className="inline-flex items-center px-4 py-2 bg-red-500/20 text-red-400 font-medium rounded-lg border border-red-500/30">
                        <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 15.5c-.77.833.192 2.5 1.732 2.5z" />
                        </svg>
                        {t('invalidUrl')}
                      </div>
                    );
                  }
                  
                  return (
                    <a
                      href={url}
                      className="inline-flex items-center px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg transition-colors"
                      download
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      {t('download')}
                    </a>
                  );
                })()
              )}
            </div>
          </div>
        );

      case 'hosted_video':
        // Future implementation for self-hosted videos
        return (
          <div key={item.id} className="bg-white/10 border border-white/10 rounded-lg p-6 mb-6">
            <div className="flex items-center justify-center py-8">
              <div className="text-center">
                <div className="bg-gf-accent-soft p-4 rounded-lg mb-4 mx-auto w-16 h-16 flex items-center justify-center">
                  <svg className="w-8 h-8 text-gf-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className="text-white font-medium text-lg mb-2">{item.title}</h3>
                <p className="text-gf-muted text-sm">{t('hostedVideoComingSoon')}</p>
              </div>
            </div>
          </div>
        );

      case 'hosted_file':
        // Future implementation for self-hosted files
        return (
          <div key={item.id} className="bg-white/10 border border-white/10 rounded-lg p-6 mb-6">
            <div className="flex items-center justify-center py-8">
              <div className="text-center">
                <div className="bg-blue-500/20 p-4 rounded-lg mb-4 mx-auto w-16 h-16 flex items-center justify-center">
                  <svg className="w-8 h-8 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h3 className="text-white font-medium text-lg mb-2">{item.title}</h3>
                <p className="text-gf-muted text-sm">{t('hostedFileComingSoon')}</p>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  if (sortedItems.length === 0) {
    return (
      <div className="bg-white/10 border border-white/10 rounded-lg p-8 text-center">
        <div className="w-16 h-16 mx-auto mb-4 bg-gray-500/20 rounded-full flex items-center justify-center">
          <svg className="w-8 h-8 text-gf-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-4.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
          </svg>
        </div>
        <h3 className="text-white font-medium text-lg mb-2">{t('noContent')}</h3>
        <p className="text-gf-muted text-sm">{t('noContentMessage')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-white mb-2">{t('sectionTitle')}</h2>
        <p className="text-gf-muted text-sm">{t('accessYourContent', { productName })}</p>
      </div>
      
      {sortedItems.map(renderContentItem)}
    </div>
  );
}
