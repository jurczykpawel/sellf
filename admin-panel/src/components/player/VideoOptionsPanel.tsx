'use client';

import React from 'react';
import { Tooltip } from '@/components/ui/Tooltip';

export type VideoOptionKey = 'autoplay' | 'loop' | 'muted' | 'controls' | 'saved_position';

const PLATFORM_SUPPORTED_OPTIONS: Record<string, VideoOptionKey[]> = {
  YouTube: ['autoplay', 'loop', 'muted', 'controls'],
  Vimeo: ['autoplay', 'loop', 'muted', 'controls'],
  Wistia: ['autoplay', 'loop', 'muted', 'controls'],
  'Bunny.net': ['autoplay', 'loop', 'muted', 'controls'],
  Twitch: ['autoplay', 'loop', 'muted', 'controls'],
};

export const PREVIEW_OPTIONS: VideoOptionKey[] = ['autoplay', 'loop', 'muted', 'controls'];
export const CONTENT_OPTIONS: VideoOptionKey[] = ['autoplay', 'loop', 'muted', 'controls', 'saved_position'];

export const PREVIEW_DEFAULTS: VideoOptionsConfig = {
  autoplay: true,
  loop: true,
  muted: true,
  controls: false,
};

export function readVideoOptionChecked(
  option: VideoOptionKey,
  config: VideoOptionsConfig | null | undefined,
): boolean {
  if (option === 'controls') {
    return config?.controls !== false;
  }
  return Boolean(config?.[option]);
}

export type VideoOptionsConfig = Partial<Record<VideoOptionKey, boolean>>;

type TranslationFunction = (key: string, values?: Record<string, string>) => string;

export interface VideoOptionsPanelProps {
  mode: 'preview' | 'content';
  config: VideoOptionsConfig | null | undefined;
  platform?: string | null;
  t: TranslationFunction;
  onOptionChange: (option: VideoOptionKey, checked: boolean) => void;
  testId?: string;
}

export function VideoOptionsPanel({
  mode,
  config,
  platform,
  t,
  onOptionChange,
  testId,
}: VideoOptionsPanelProps) {
  const options = mode === 'preview' ? PREVIEW_OPTIONS : CONTENT_OPTIONS;

  const platformInfoText = platform
    ? t('platformSupports', {
        platform,
        options: (PLATFORM_SUPPORTED_OPTIONS[platform] ?? ['autoplay'])
          .map((k) => t(k).toLowerCase())
          .join(', '),
      })
    : t('videoOptionsNote');

  return (
    <div className="mt-3 pt-3 border-t border-sf-border" data-testid={testId}>
      <div className="text-xs font-medium text-sf-body mb-2">{t('videoOptions')}</div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {options.map((option) => {
          const checked = readVideoOptionChecked(option, config);
          return (
            <Tooltip key={option} content={t(`${option}Tooltip`)} side="bottom">
              <label className="inline-flex items-center space-x-1 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => onOptionChange(option, e.target.checked)}
                  className="h-3 w-3 text-sf-accent focus:ring-sf-accent border-sf-border rounded"
                  data-testid={testId ? `${testId}-${option}` : undefined}
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

