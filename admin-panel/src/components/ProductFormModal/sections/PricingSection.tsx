'use client';

import React, { useState } from 'react';
import { ModalSection } from '@/components/ui/Modal';
import IconSelector from '@/components/IconSelector';
import { PricingSectionProps } from '../types';
import { getVideoValidationMessage } from '@/lib/playerstack';
import { parseVideoUrl } from '@/lib/videoUtils';
import {
  VideoOptionsPanel,
  PREVIEW_DEFAULTS,
  type VideoOptionKey,
  type VideoOptionsConfig,
} from '@/components/player/VideoOptionsPanel';

const PLATFORM_LABELS: Record<string, string> = {
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  wistia: 'Wistia',
  bunny: 'Bunny.net',
  twitch: 'Twitch',
};

interface VisualSectionProps {
  formData: PricingSectionProps['formData'];
  setFormData: PricingSectionProps['setFormData'];
  t: PricingSectionProps['t'];
  onIconSelect: (icon: string) => void;
}

export function PricingSection({
  formData,
  setFormData,
  t,
  onIconSelect,
}: VisualSectionProps) {
  const [videoUrlError, setVideoUrlError] = useState<string | null>(null);

  const handleImageUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({
      ...prev,
      image_url: e.target.value || null
    }));
  };

  const handleVideoUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value || null;

    if (value) {
      const validationMessage = getVideoValidationMessage(value);
      if (validationMessage !== 'ok') {
        setVideoUrlError(t('previewVideoUrlUnsupported', { defaultValue: 'Unsupported platform. Use YouTube, Vimeo, Wistia, Bunny Stream HLS/MP4, or Twitch.' }));
        setFormData(prev => ({ ...prev, preview_video_url: null }));
        return;
      }
      setVideoUrlError(null);
    } else {
      setVideoUrlError(null);
    }

    setFormData(prev => ({
      ...prev,
      preview_video_url: value,
      // First time a valid URL appears, seed autopreview defaults so the
      // checkbox row is meaningful out of the gate. Existing configs are kept.
      preview_video_config: value && !hasAnyConfig(prev.preview_video_config)
        ? { ...PREVIEW_DEFAULTS }
        : prev.preview_video_config,
    }));
  };

  const handleVideoOptionChange = (option: VideoOptionKey, checked: boolean) => {
    setFormData(prev => ({
      ...prev,
      preview_video_config: {
        ...(prev.preview_video_config ?? {}),
        [option]: checked,
      },
    }));
  };

  const previewPlatformLabel = formData.preview_video_url
    ? PLATFORM_LABELS[parseVideoUrl(formData.preview_video_url).platform] ?? null
    : null;

  return (
    <ModalSection title={t('visual')}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-sf-body mb-2">
            {t('productIcon')}
          </label>
          <IconSelector
            selectedIcon={formData.icon}
            onSelectIcon={onIconSelect}
          />
        </div>
      </div>

      <div className="mt-6">
        <label htmlFor="image_url" className="block text-sm font-medium text-sf-body mb-2">
          {t('imageUrl')}
        </label>
        <input
          type="url"
          id="image_url"
          name="image_url"
          value={formData.image_url || ''}
          onChange={handleImageUrlChange}
          className="w-full px-4 py-2 border-2 border-sf-border-medium bg-sf-input text-sf-heading focus:ring-2 focus:ring-sf-accent focus:border-transparent"
          placeholder={t('imageUrlPlaceholder')}
        />
        <p className="mt-2 text-xs text-sf-muted">
          {t('imageUrlHelp')}
        </p>
      </div>

      <div className="mt-6">
        <label htmlFor="preview_video_url" className="block text-sm font-medium text-sf-body mb-2">
          {t('previewVideoUrl', { defaultValue: 'Preview Video URL' })}
        </label>
        <input
          type="url"
          id="preview_video_url"
          name="preview_video_url"
          value={formData.preview_video_url || ''}
          onChange={handleVideoUrlChange}
          className="w-full px-4 py-2 border-2 border-sf-border-medium bg-sf-input text-sf-heading focus:ring-2 focus:ring-sf-accent focus:border-transparent"
          placeholder={t('previewVideoUrlPlaceholder', { defaultValue: 'https://youtube.com/watch?v=... or https://vimeo.com/...' })}
        />
        {videoUrlError && (
          <p className="mt-2 text-xs text-red-500">
            {videoUrlError}
          </p>
        )}
        <p className="mt-2 text-xs text-sf-muted">
          {t('previewVideoUrlHelp', { defaultValue: 'Video shown on checkout page. Takes priority over image. Supports YouTube, Vimeo, Wistia, Bunny Stream HLS/MP4, and Twitch.' })}
        </p>

        {formData.preview_video_url && !videoUrlError && (
          <VideoOptionsPanel
            mode="preview"
            config={formData.preview_video_config}
            platform={previewPlatformLabel}
            t={t}
            onOptionChange={handleVideoOptionChange}
            testId="preview-video-options"
          />
        )}
      </div>
    </ModalSection>
  );
}

function hasAnyConfig(config: VideoOptionsConfig | null | undefined): boolean {
  return Boolean(config && Object.keys(config).length > 0);
}
