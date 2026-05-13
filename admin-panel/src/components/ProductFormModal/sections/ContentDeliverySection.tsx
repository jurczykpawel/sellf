'use client';

import React from 'react';
import { ModalSection } from '@/components/ui/Modal';
import { Tooltip } from '@/components/ui/Tooltip';
import type { ProductContentConfig, ContentItemConfig } from '@/types';
import type { ContentDeliverySectionProps, UrlValidation, TranslationFunction } from '../types';

// ── Constants ──────────────────────────────────────────────────────────────────

/** Which video options each platform actually supports (used for info text) */
const PLATFORM_SUPPORTED_OPTIONS: Record<string, string[]> = {
  YouTube: ['autoplay', 'loop', 'muted', 'controls'],
  Vimeo: ['autoplay', 'loop', 'muted', 'controls'],
  Wistia: ['autoplay', 'loop', 'muted', 'controls'],
  'Bunny.net': ['autoplay', 'loop', 'muted', 'controls'],
  Twitch: ['autoplay', 'loop', 'muted', 'controls'],
};

/** All video option keys in display order */
const VIDEO_OPTIONS = ['autoplay', 'loop', 'muted', 'controls'] as const;

// ── Small helpers ──────────────────────────────────────────────────────────────

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function WarningIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 15.5c-.77.833.192 2.5 1.732 2.5z" />
    </svg>
  );
}

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
    </svg>
  );
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
    </svg>
  );
}

// ── Info banners ───────────────────────────────────────────────────────────────

function InfoBanner({ icon, color, title, description, children }: {
  icon: React.ReactNode;
  color: 'accent' | 'success';
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  const colorClasses = color === 'accent'
    ? { bg: 'bg-sf-accent-soft', border: 'border-sf-accent/20', text: 'text-sf-accent' }
    : { bg: 'bg-sf-success-soft', border: 'border-sf-success/20', text: 'text-sf-success' };

  return (
    <div className={`mb-3 p-3 ${colorClasses.bg} border ${colorClasses.border}`}>
      <div className="flex items-start">
        <div className="flex-shrink-0">{icon}</div>
        <div className="ml-3">
          <h4 className={`text-sm font-medium ${colorClasses.text}`}>{title}</h4>
          <p className={`text-xs ${colorClasses.text} mt-1`}>{description}</p>
          {children && (
            <div className={`mt-2 text-xs ${colorClasses.text} leading-relaxed`}>{children}</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Validation message ─────────────────────────────────────────────────────────

function ValidationMessage({ validation, t }: { validation: UrlValidation; t: TranslationFunction }) {
  return (
    <div className={`mt-2 text-xs flex items-start space-x-1 ${
      validation.isValid ? 'text-sf-success' : 'text-sf-danger'
    }`}>
      {validation.isValid
        ? <CheckIcon className="w-3 h-3 mt-0.5 flex-shrink-0" />
        : <WarningIcon className="w-3 h-3 mt-0.5 flex-shrink-0" />
      }
      <span>
        {validation.isValid && validation.platform
          ? t('videoDetected', { platform: validation.platform })
          : t(validation.message)}
      </span>
    </div>
  );
}

// ── Video options panel ────────────────────────────────────────────────────────

function VideoOptionsPanel({ item, index, validation, t, onOptionChange }: {
  item: { config: ContentItemConfig };
  index: number;
  validation?: UrlValidation;
  t: TranslationFunction;
  onOptionChange: (index: number, option: string, checked: boolean) => void;
}) {
  const platform = validation?.platform;

  const platformInfoText = platform
    ? t('platformSupports', {
        platform,
        options: (PLATFORM_SUPPORTED_OPTIONS[platform] ?? ['autoplay'])
          .map(k => t(k).toLowerCase())
          .join(', '),
      })
    : t('videoOptionsNote');

  return (
    <div className="mt-3 pt-3 border-t border-sf-border">
      <div className="text-xs font-medium text-sf-body mb-2">{t('videoOptions')}</div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {VIDEO_OPTIONS.map(option => {
          const isControls = option === 'controls';
          const checked = isControls
            ? item.config?.controls !== false
            : Boolean(item.config?.[option]);

          return (
            <Tooltip key={option} content={t(`${option}Tooltip`)} side="bottom">
              <label className="inline-flex items-center space-x-1 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => onOptionChange(index, option, e.target.checked)}
                  className="h-3 w-3 text-sf-accent focus:ring-sf-accent border-sf-border rounded"
                />
                <span className="text-sf-body">{t(option)}</span>
              </label>
            </Tooltip>
          );
        })}
      </div>

      <div className="mt-2 text-xs text-sf-muted">{platformInfoText}</div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function ContentDeliverySection({
  formData,
  setFormData,
  t,
  urlValidation,
  setUrlValidation,
  validateContentItemUrl,
}: ContentDeliverySectionProps) {
  const contentItems = (formData.content_config as ProductContentConfig)?.content_items || [];
  const hasVideoEmbeds = contentItems.some(item => item.type === 'video_embed');
  const hasDownloadLinks = contentItems.some(item => item.type === 'download_link');

  // ── Handlers ───────────────────────────────────────────────────────────────

  const updateContentItems = (updater: (items: typeof contentItems) => typeof contentItems) => {
    setFormData(prev => ({
      ...prev,
      content_config: { ...prev.content_config, content_items: updater(contentItems) },
    }));
  };

  const handleContentTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setFormData(prev => ({
      ...prev,
      content_delivery_type: e.target.value as 'redirect' | 'content',
    }));
  };

  const handleRedirectUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({
      ...prev,
      content_config: { redirect_url: e.target.value },
    }));
  };

  const handleItemTypeChange = (index: number, newType: 'video_embed' | 'download_link') => {
    updateContentItems(items => items.map((item, i) =>
      i === index ? { ...item, type: newType } : item
    ));
    setUrlValidation(prev => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
  };

  const handleItemFieldChange = (index: number, field: string, value: string) => {
    updateContentItems(items => items.map((item, i) =>
      i === index ? { ...item, [field]: value } : item
    ));
  };

  const handleItemUrlChange = (index: number, url: string) => {
    const configKey = contentItems[index].type === 'video_embed' ? 'embed_url' : 'download_url';
    updateContentItems(items => items.map((item, i) =>
      i === index ? { ...item, config: { ...item.config, [configKey]: url } } : item
    ));
  };

  const handleItemUrlBlur = (index: number, url: string, type: 'video_embed' | 'download_link') => {
    if (url) {
      setUrlValidation(prev => ({ ...prev, [index]: validateContentItemUrl(url, type) }));
    } else {
      setUrlValidation(prev => {
        const next = { ...prev };
        delete next[index];
        return next;
      });
    }
  };

  const handleVideoOptionChange = (index: number, option: string, checked: boolean) => {
    updateContentItems(items => items.map((item, i) =>
      i === index ? { ...item, config: { ...item.config, [option]: checked } } : item
    ));
  };

  const handleRemoveItem = (index: number) => {
    updateContentItems(items => items.filter((_, i) => i !== index));
    setUrlValidation(prev => {
      const next: Record<number, UrlValidation> = {};
      Object.entries(prev).forEach(([key, val]) => {
        const idx = parseInt(key);
        if (idx < index) next[idx] = val;
        else if (idx > index) next[idx - 1] = val;
      });
      return next;
    });
  };

  const handleAddItem = () => {
    updateContentItems(items => [...items, {
      id: `temp-${Date.now()}`,
      type: 'video_embed' as const,
      title: '',
      config: { embed_url: '' },
      order: items.length + 1,
      is_active: true,
    }]);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <ModalSection title={t('contentDelivery')} collapsible defaultExpanded={true}>
      <div className="space-y-4">
        {/* Delivery type selector */}
        <div>
          <label className="block text-sm font-medium text-sf-body mb-2">
            {t('contentDeliveryType')}
          </label>
          <select
            value={formData.content_delivery_type}
            onChange={handleContentTypeChange}
            className="w-full px-3 py-2.5 border-2 border-sf-border-medium focus:outline-none focus:ring-2 focus:ring-sf-accent focus:border-transparent bg-sf-input text-sf-heading"
          >
            <option value="content">{t('contentItems')}</option>
            <option value="redirect">{t('redirect')}</option>
          </select>
        </div>

        {/* Redirect URL input */}
        {formData.content_delivery_type === 'redirect' && (
          <div>
            <label className="block text-sm font-medium text-sf-body mb-2">
              {t('redirectUrl')}
            </label>
            <input
              type="text"
              placeholder={t('redirectPlaceholder')}
              value={(formData.content_config as { redirect_url?: string })?.redirect_url || ''}
              onChange={handleRedirectUrlChange}
              className="w-full px-3 py-2.5 border-2 border-sf-border-medium focus:outline-none focus:ring-2 focus:ring-sf-accent focus:border-transparent bg-sf-input text-sf-heading"
            />
            <p className="mt-1 text-xs text-sf-muted">{t('redirectDescription')}</p>
          </div>
        )}

        {/* Content items list */}
        {formData.content_delivery_type === 'content' && (
          <div>
            <label className="block text-sm font-medium text-sf-body mb-2">
              {t('contentItems')}
            </label>

            {hasVideoEmbeds && (
              <InfoBanner
                icon={<InfoIcon className="h-5 w-5 text-sf-accent" />}
                color="accent"
                title={t('supportedVideoPlatforms')}
                description={t('supportedVideoPlatformsDesc')}
              >
                {t('supportedVideoPlatformsList')}
              </InfoBanner>
            )}

            {hasDownloadLinks && (
              <InfoBanner
                icon={<ShieldIcon className="h-5 w-5 text-sf-success" />}
                color="success"
                title={t('trustedStorageProviders')}
                description={t('trustedStorageProvidersDesc')}
              >
                <div>{t('storageCloudProviders')}</div>
                <div>{t('storagePersonalProviders')}</div>
                <div>{t('storageCdnProviders')}</div>
                <div>{t('storageFileSharingProviders')}</div>
              </InfoBanner>
            )}

            <div className="space-y-3">
              {contentItems.map((item, index) => (
                <div key={index} data-testid="content-item" className="p-3 bg-sf-raised border-2 border-sf-border-medium">
                  {/* Item header: type, title, URL, remove */}
                  <div className="flex items-center space-x-2 mb-2">
                    <select
                      value={item.type}
                      onChange={(e) => handleItemTypeChange(index, e.target.value as 'video_embed' | 'download_link')}
                      className="px-2 py-1 border-2 border-sf-border-medium text-sm bg-sf-input text-sf-heading"
                    >
                      <option value="video_embed">{t('videoEmbed')}</option>
                      <option value="download_link">{t('downloadLink')}</option>
                    </select>
                    <input
                      type="text"
                      placeholder={t('title')}
                      value={item.title}
                      onChange={(e) => handleItemFieldChange(index, 'title', e.target.value)}
                      className="flex-1 px-2 py-1 border-2 border-sf-border-medium text-sm bg-sf-input text-sf-heading"
                    />
                    <div className="flex-1 relative">
                      <input
                        type="text"
                        placeholder={t('url')}
                        value={item.config?.embed_url || item.config?.download_url || ''}
                        onChange={(e) => handleItemUrlChange(index, e.target.value)}
                        onBlur={(e) => handleItemUrlBlur(index, e.target.value, item.type as 'video_embed' | 'download_link')}
                        className={`w-full px-2 py-1 pr-8 border text-sm bg-sf-input text-sf-heading ${
                          urlValidation[index]
                            ? urlValidation[index].isValid ? 'border-green-500' : 'border-red-500'
                            : 'border-sf-border'
                        }`}
                      />
                      {urlValidation[index] && (
                        <div className="absolute right-2 top-1/2 transform -translate-y-1/2">
                          {urlValidation[index].isValid
                            ? <CheckIcon className="w-4 h-4 text-green-500" />
                            : <XIcon className="w-4 h-4 text-red-500" />
                          }
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveItem(index)}
                      className="px-2 py-1 text-sf-danger hover:text-sf-danger"
                    >
                      {t('remove')}
                    </button>
                  </div>

                  {urlValidation[index] && (
                    <ValidationMessage validation={urlValidation[index]} t={t} />
                  )}

                  {item.type === 'video_embed' && (
                    <VideoOptionsPanel
                      item={item}
                      index={index}
                      validation={urlValidation[index]}
                      t={t}
                      onOptionChange={handleVideoOptionChange}
                    />
                  )}
                </div>
              ))}

              <button
                type="button"
                onClick={handleAddItem}
                className="px-3 py-1 text-sm bg-sf-accent-bg text-white hover:bg-sf-accent-hover"
              >
                {t('addContentItem')}
              </button>
            </div>
          </div>
        )}
      </div>
    </ModalSection>
  );
}
