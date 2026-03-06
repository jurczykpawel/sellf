'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { ContentItem } from '@/types';
import { parseVideoUrl, isTrustedVideoPlatform } from '@/lib/videoUtils';
import { VideoPlayer } from '@/components/player';
import { isTrustedDownloadUrl } from '@/lib/trustedDownloadProviders';

interface DigitalContentRendererProps {
  contentItems: ContentItem[];
  productName: string;
}

// Detect file type from filename for styled icons
function getFileType(filename?: string | null): { label: string; color: string; bg: string } {
  const ext = filename?.split('.').pop()?.toLowerCase() ?? '';
  if (['pdf'].includes(ext))                    return { label: 'PDF', color: 'text-red-500',    bg: 'bg-red-500/10' };
  if (['zip', 'rar', '7z', 'tar'].includes(ext)) return { label: ext.toUpperCase(), color: 'text-amber-500', bg: 'bg-amber-500/10' };
  if (['mp4', 'mov', 'avi', 'mkv'].includes(ext)) return { label: 'VID', color: 'text-blue-500',  bg: 'bg-blue-500/10' };
  if (['mp3', 'wav', 'm4a'].includes(ext))      return { label: 'AUD', color: 'text-purple-500', bg: 'bg-purple-500/10' };
  if (['doc', 'docx'].includes(ext))            return { label: 'DOC', color: 'text-sky-500',    bg: 'bg-sky-500/10' };
  if (['xls', 'xlsx', 'csv'].includes(ext))     return { label: 'XLS', color: 'text-emerald-500', bg: 'bg-emerald-500/10' };
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) return { label: 'IMG', color: 'text-violet-500', bg: 'bg-violet-500/10' };
  return { label: 'FILE', color: 'text-sf-muted', bg: 'bg-sf-raised' };
}

const PLATFORM_LABELS: Record<string, string> = {
  youtube:     'YouTube',
  vimeo:       'Vimeo',
  bunny:       'Bunny.net',
  loom:        'Loom',
  wistia:      'Wistia',
  dailymotion: 'DailyMotion',
  twitch:      'Twitch',
};

export default function DigitalContentRenderer({ contentItems, productName }: DigitalContentRendererProps) {
  const t = useTranslations('digitalContent');
  const sortedItems = contentItems
    .filter(item => item.is_active)
    .sort((a, b) => a.order - b.order);

  const renderContentItem = (item: ContentItem, index: number) => {
    if (!item.config) return null;

    switch (item.type) {

      // ── Video ──────────────────────────────────────────────────────────────
      case 'video_embed': {
        const url = item.config.embed_url;
        const parsed = url ? parseVideoUrl(url) : null;
        const platformLabel = parsed?.platform ? PLATFORM_LABELS[parsed.platform] : null;
        const embedUrl = parsed?.isValid ? parsed.embedUrl : null;

        return (
          <div key={item.id} className="rounded-xl border border-sf-border bg-sf-float overflow-hidden">
            {/* Card header */}
            <div className="px-5 pt-4 pb-3 flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <div className="mt-0.5 shrink-0 w-7 h-7 rounded-lg bg-sf-accent-soft flex items-center justify-center">
                  <svg className="w-4 h-4 text-sf-accent" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sf-heading font-semibold text-sm leading-snug" id={`content-item-${item.id}`}>{item.title}</h3>
                    {item.config.duration && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-sf-raised border border-sf-border text-sf-body">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        {item.config.duration}
                      </span>
                    )}
                  </div>
                  {item.description && (
                    <p className="text-sf-body text-xs mt-1 leading-relaxed">{item.description}</p>
                  )}
                </div>
              </div>
              {platformLabel && (
                <span className="shrink-0 text-xs font-medium text-sf-body bg-sf-raised border border-sf-border rounded-md px-2 py-1">
                  {platformLabel}
                </span>
              )}
            </div>

            {/* Video embed */}
            {url && (
              <div className="px-5 pb-5">
                <div className="aspect-video bg-black rounded-lg overflow-hidden">
                  {embedUrl && parsed ? (
                    <VideoPlayer
                      parsed={parsed}
                      title={item.title}
                      options={{
                        autoplay: item.config.autoplay,
                        loop: item.config.loop,
                        muted: item.config.muted,
                        preload: item.config.preload,
                        controls: item.config.controls,
                        useCustomPlayer: item.config.useCustomPlayer,
                      }}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full gap-2 text-center p-6">
                      <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
                      <p className="text-sm font-medium text-sf-body">
                        {!url || (parsed && !isTrustedVideoPlatform(url))
                          ? t('trustedPlatformsOnly')
                          : t('unableToParseUrl')}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {item.config.embed_code && !url && (
              <div className="px-5 pb-5">
                <div className="aspect-video bg-sf-raised rounded-lg flex flex-col items-center justify-center gap-2 text-center p-6">
                  <svg className="w-8 h-8 text-sf-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>
                  <p className="text-sm font-medium text-sf-body">{t('securityEmbedDisabled')}</p>
                  <p className="text-xs text-sf-body">{t('useIframeInstead')}</p>
                </div>
              </div>
            )}
          </div>
        );
      }

      // ── Download link ──────────────────────────────────────────────────────
      case 'download_link': {
        const url = item.config.download_url;
        const isValid = url ? isTrustedDownloadUrl(url) : false;
        const fileType = getFileType(item.config.file_name);

        return (
          <div key={item.id} className="rounded-xl border border-sf-border bg-sf-float px-5 py-4 flex items-center gap-4">
            {/* File type badge */}
            <div className={`shrink-0 w-11 h-11 rounded-xl ${fileType.bg} flex flex-col items-center justify-center`}>
              <svg className={`w-5 h-5 ${fileType.color}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className={`text-[9px] font-bold leading-none mt-0.5 ${fileType.color}`}>{fileType.label}</span>
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <p className="text-sf-heading font-semibold text-sm truncate">{item.title}</p>
              {item.description && (
                <p className="text-sf-body text-xs mt-0.5 truncate">{item.description}</p>
              )}
              {(item.config.file_name || item.config.file_size) && (
                <div className="flex items-center gap-2 mt-1 text-xs text-sf-body">
                  {item.config.file_name && <span className="truncate max-w-[160px]">{item.config.file_name}</span>}
                  {item.config.file_name && item.config.file_size && <span className="shrink-0">·</span>}
                  {item.config.file_size && <span className="shrink-0">{item.config.file_size}</span>}
                </div>
              )}
            </div>

            {/* Action */}
            {url ? (
              isValid ? (
                <a
                  href={url}
                  download
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-sf-accent-bg hover:bg-sf-accent-hover text-white text-sm font-semibold transition-colors active:scale-[0.97]"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                  {t('download')}
                </a>
              ) : (
                <div className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sf-danger-soft border border-sf-danger/30 text-sf-danger text-xs font-medium">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
                  {t('invalidUrl')}
                </div>
              )
            ) : null}
          </div>
        );
      }

      // ── Hosted video / file (future) ───────────────────────────────────────
      case 'hosted_video':
      case 'hosted_file': {
        const isVideo = item.type === 'hosted_video';
        return (
          <div key={item.id} className="rounded-xl border border-sf-border border-dashed bg-sf-float px-5 py-6 flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-sf-raised flex items-center justify-center shrink-0">
              {isVideo ? (
                <svg className="w-5 h-5 text-sf-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
              ) : (
                <svg className="w-5 h-5 text-sf-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              )}
            </div>
            <div>
              <p className="text-sf-heading font-semibold text-sm">{item.title}</p>
              <p className="text-xs text-sf-body mt-0.5">{isVideo ? t('hostedVideoComingSoon') : t('hostedFileComingSoon')}</p>
            </div>
          </div>
        );
      }

      default:
        return null;
    }
  };

  // ── Empty state ──────────────────────────────────────────────────────────
  if (sortedItems.length === 0) {
    return (
      <div className="rounded-xl border border-sf-border border-dashed py-12 flex flex-col items-center justify-center text-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-sf-raised flex items-center justify-center">
          <svg className="w-6 h-6 text-sf-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-4.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold text-sf-heading">{t('noContent')}</p>
          <p className="text-xs text-sf-body mt-1">{t('noContentMessage')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {sortedItems.map((item, i) => renderContentItem(item, i))}
    </div>
  );
}
