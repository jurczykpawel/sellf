import { describe, expect, it } from 'vitest';
import {
  PREVIEW_OPTIONS,
  CONTENT_OPTIONS,
  PREVIEW_DEFAULTS,
  readVideoOptionChecked,
} from '@/components/player/VideoOptionsPanel';

describe('VideoOptionsPanel helpers', () => {
  it('preview mode exposes 4 options without saved_position', () => {
    expect(PREVIEW_OPTIONS).toEqual(['autoplay', 'loop', 'muted', 'controls']);
    expect(PREVIEW_OPTIONS).not.toContain('saved_position');
  });

  it('content mode exposes 5 options including saved_position', () => {
    expect(CONTENT_OPTIONS).toEqual(['autoplay', 'loop', 'muted', 'controls', 'saved_position']);
  });

  it('preview defaults match autopreview teaser', () => {
    expect(PREVIEW_DEFAULTS).toEqual({
      autoplay: true,
      loop: true,
      muted: true,
      controls: false,
    });
  });

  describe('readVideoOptionChecked', () => {
    it('treats missing controls as ON (Playerstack default)', () => {
      expect(readVideoOptionChecked('controls', null)).toBe(true);
      expect(readVideoOptionChecked('controls', {})).toBe(true);
      expect(readVideoOptionChecked('controls', undefined)).toBe(true);
    });

    it('treats explicit false controls as OFF', () => {
      expect(readVideoOptionChecked('controls', { controls: false })).toBe(false);
    });

    it('treats explicit true controls as ON', () => {
      expect(readVideoOptionChecked('controls', { controls: true })).toBe(true);
    });

    it('treats other options as OFF unless explicitly true', () => {
      expect(readVideoOptionChecked('autoplay', null)).toBe(false);
      expect(readVideoOptionChecked('autoplay', { autoplay: true })).toBe(true);
      expect(readVideoOptionChecked('autoplay', { autoplay: false })).toBe(false);
      expect(readVideoOptionChecked('saved_position', { saved_position: true })).toBe(true);
    });
  });
});
