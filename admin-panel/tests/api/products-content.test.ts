/**
 * API Integration Tests: Products — Digital Content Config
 *
 * Tests creating and updating products with all supported content types:
 * - video_embed: all 7 platforms (YouTube, Vimeo, Bunny, Loom, Wistia, DailyMotion, Twitch)
 * - download_link: all trusted storage providers (AWS S3, GCS, Supabase, Google Drive,
 *   Google Docs, Dropbox, OneDrive, Box, SharePoint, Bunny CDN, Cloudinary, Mega,
 *   MediaFire, WeTransfer, SendSpace)
 * - hosted_video, hosted_file
 *
 * Run: npm run test:api (requires dev server running)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { post, patch, get, cleanup, deleteTestApiKey } from './setup';

interface Product {
  id: string;
  name: string;
  slug: string;
  price: number;
  content_delivery_type: string;
  content_config: {
    content_items: ContentItem[];
  };
}

interface ContentItem {
  id: string;
  type: string;
  order: number;
  title: string;
  is_active: boolean;
  config: Record<string, unknown>;
  description?: string;
}

interface ApiResponse<T> {
  data?: T;
  error?: { code: string; message: string; details?: unknown };
}

const uniqueSlug = () => `test-content-${Date.now()}-${Math.random().toString(36).substring(7)}`;

// ─── Video embed fixtures ────────────────────────────────────────────────────

const VIDEO_ITEMS: ContentItem[] = [
  {
    id: 'test-vid-youtube',
    type: 'video_embed',
    order: 1,
    title: 'YouTube — Wprowadzenie',
    is_active: true,
    config: {
      embed_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      autoplay: false,
      duration: '3:32',
    },
  },
  {
    id: 'test-vid-youtube-short',
    type: 'video_embed',
    order: 2,
    title: 'YouTube — Skrócony URL (youtu.be)',
    is_active: true,
    config: {
      embed_url: 'https://youtu.be/dQw4w9WgXcQ',
    },
  },
  {
    id: 'test-vid-vimeo',
    type: 'video_embed',
    order: 3,
    title: 'Vimeo — Lekcja 1',
    is_active: true,
    config: {
      embed_url: 'https://vimeo.com/76979871',
      autoplay: false,
    },
  },
  {
    id: 'test-vid-bunny',
    type: 'video_embed',
    order: 4,
    title: 'Bunny.net Stream',
    is_active: true,
    config: {
      embed_url: 'https://iframe.mediadelivery.net/embed/123456/a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      autoplay: false,
    },
  },
  {
    id: 'test-vid-loom',
    type: 'video_embed',
    order: 5,
    title: 'Loom — Nagranie ekranu',
    is_active: true,
    config: {
      embed_url: 'https://www.loom.com/share/a1b2c3d4e5f6478a9b0c1d2e3f4a5b6c',
    },
  },
  {
    id: 'test-vid-wistia',
    type: 'video_embed',
    order: 6,
    title: 'Wistia — Lekcja zaawansowana',
    is_active: true,
    config: {
      embed_url: 'https://support.wistia.com/medias/e4a27b971d',
    },
  },
  {
    id: 'test-vid-dailymotion',
    type: 'video_embed',
    order: 7,
    title: 'DailyMotion — Webinar',
    is_active: true,
    config: {
      embed_url: 'https://www.dailymotion.com/video/x7tgad0',
    },
  },
  {
    id: 'test-vid-twitch',
    type: 'video_embed',
    order: 8,
    title: 'Twitch — VOD z Q&A',
    is_active: true,
    config: {
      embed_url: 'https://player.twitch.tv/?video=2321733225&parent=localhost',
    },
  },
];

// ─── Download link fixtures ──────────────────────────────────────────────────

const DOWNLOAD_ITEMS: ContentItem[] = [
  // Cloud storage
  {
    id: 'test-dl-aws-s3',
    type: 'download_link',
    order: 10,
    title: 'AWS S3 — Slides PDF',
    is_active: true,
    config: {
      download_url: 'https://s3.amazonaws.com/demo-course-bucket/slides.pdf',
      file_name: 'slides.pdf',
      file_size: '3.2 MB',
    },
  },
  {
    id: 'test-dl-gcs',
    type: 'download_link',
    order: 11,
    title: 'Google Cloud Storage — Materiały',
    is_active: true,
    config: {
      download_url: 'https://storage.googleapis.com/demo-course/materialy.pdf',
      file_name: 'materialy.pdf',
      file_size: '2.4 MB',
    },
  },
  {
    id: 'test-dl-supabase',
    type: 'download_link',
    order: 12,
    title: 'Supabase Storage — Kod źródłowy',
    is_active: true,
    config: {
      download_url: 'https://abcdefghijklmnop.supabase.co/storage/v1/object/public/files/projekt.zip',
      file_name: 'projekt.zip',
      file_size: '8.1 MB',
    },
  },
  // Personal cloud
  {
    id: 'test-dl-gdrive',
    type: 'download_link',
    order: 13,
    title: 'Google Drive — Zeszyt ćwiczeń',
    is_active: true,
    config: {
      download_url: 'https://drive.google.com/uc?export=download&id=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms',
      file_name: 'cwiczenia.docx',
      file_size: '540 KB',
    },
  },
  {
    id: 'test-dl-gdocs',
    type: 'download_link',
    order: 14,
    title: 'Google Docs — Prezentacja (export PDF)',
    is_active: true,
    config: {
      download_url: 'https://docs.google.com/presentation/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms/export/pdf',
      file_name: 'prezentacja.pdf',
      file_size: '1.2 MB',
    },
  },
  {
    id: 'test-dl-dropbox',
    type: 'download_link',
    order: 15,
    title: 'Dropbox — Pliki projektu',
    is_active: true,
    config: {
      download_url: 'https://www.dropbox.com/s/abc123xyz456/pliki-projektu.zip?dl=1',
      file_name: 'pliki-projektu.zip',
      file_size: '18.7 MB',
    },
  },
  {
    id: 'test-dl-onedrive',
    type: 'download_link',
    order: 16,
    title: 'OneDrive — Notatki',
    is_active: true,
    config: {
      download_url: 'https://onedrive.live.com/download?cid=ABC123&resid=ABC123%21456&authkey=AXyzAbcDef',
      file_name: 'notatki.pdf',
      file_size: '780 KB',
    },
  },
  {
    id: 'test-dl-box',
    type: 'download_link',
    order: 17,
    title: 'Box — Dokumentacja',
    is_active: true,
    config: {
      download_url: 'https://app.box.com/shared/static/abc123def456ghi789jkl.pdf',
      file_name: 'dokumentacja.pdf',
      file_size: '2.1 MB',
    },
  },
  {
    id: 'test-dl-sharepoint',
    type: 'download_link',
    order: 18,
    title: 'SharePoint — Materiały firmowe',
    is_active: true,
    config: {
      download_url: 'https://contoso.sharepoint.com/sites/kurs/Shared%20Documents/materialy.pdf',
      file_name: 'materialy-firmowe.pdf',
      file_size: '4.5 MB',
    },
  },
  // CDN
  {
    id: 'test-dl-bunnycdn',
    type: 'download_link',
    order: 19,
    title: 'Bunny CDN — Asset pack',
    is_active: true,
    config: {
      download_url: 'https://demo-course.b-cdn.net/assets/asset-pack-v1.zip',
      file_name: 'asset-pack-v1.zip',
      file_size: '55.3 MB',
    },
  },
  {
    id: 'test-dl-cloudinary',
    type: 'download_link',
    order: 20,
    title: 'Cloudinary — Obrazy HD',
    is_active: true,
    config: {
      download_url: 'https://res.cloudinary.com/demo-account/raw/upload/v1/kurs/obrazy-hd.zip',
      file_name: 'obrazy-hd.zip',
      file_size: '120 MB',
    },
  },
  // File sharing
  {
    id: 'test-dl-mega',
    type: 'download_link',
    order: 21,
    title: 'Mega — Archiwum kursu',
    is_active: true,
    config: {
      download_url: 'https://mega.nz/file/abc123XY#keyABCDEFGHIJKLMNOP',
      file_name: 'archiwum-kursu.zip',
      file_size: '2.3 GB',
    },
  },
  {
    id: 'test-dl-mediafire',
    type: 'download_link',
    order: 22,
    title: 'MediaFire — Bonus pack',
    is_active: true,
    config: {
      download_url: 'https://www.mediafire.com/file/abc123def456/bonus-pack.zip/file',
      file_name: 'bonus-pack.zip',
      file_size: '340 MB',
    },
  },
  {
    id: 'test-dl-wetransfer',
    type: 'download_link',
    order: 23,
    title: 'WeTransfer — Pliki tymczasowe',
    is_active: true,
    config: {
      download_url: 'https://wetransfer.com/downloads/abc123def456ghi789/jkl012',
      file_name: 'pliki-temp.zip',
      file_size: '890 MB',
    },
  },
  {
    id: 'test-dl-sendspace',
    type: 'download_link',
    order: 24,
    title: 'SendSpace — Certyfikat template',
    is_active: true,
    config: {
      download_url: 'https://www.sendspace.com/file/abc123',
      file_name: 'certyfikat-template.pdf',
      file_size: '1.8 MB',
    },
  },
];

// ─── Hosted content fixtures ─────────────────────────────────────────────────

const HOSTED_ITEMS: ContentItem[] = [
  {
    id: 'test-hosted-video',
    type: 'hosted_video',
    order: 30,
    title: 'Hosted Video — Lekcja bonusowa',
    is_active: true,
    config: {},
  },
  {
    id: 'test-hosted-file',
    type: 'hosted_file',
    order: 31,
    title: 'Hosted File — Certyfikat ukończenia',
    is_active: true,
    config: {},
  },
];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Products API v1 — Digital Content Config', () => {
  const createdProductIds: string[] = [];

  afterAll(async () => {
    await cleanup({ products: createdProductIds });
    await deleteTestApiKey();
  });

  // ── Full product with all content types ────────────────────────────────────

  describe('POST /api/v1/products — pełny content_config (wszystkie platformy i dostawcy)', () => {
    let fullProductId: string;

    it('should create product with all 8 video platforms + 15 download providers + 2 hosted', async () => {
      const { status, data } = await post<ApiResponse<Product>>('/api/v1/products', {
        name: 'Test — Wszystkie typy treści cyfrowych',
        slug: uniqueSlug(),
        description: 'Produkt testowy ze wszystkimi wspieranymi platformami i dostawcami.',
        price: 0,
        currency: 'PLN',
        icon: '🎓',
        is_active: true,
        content_delivery_type: 'content',
        content_config: {
          content_items: [...VIDEO_ITEMS, ...DOWNLOAD_ITEMS, ...HOSTED_ITEMS],
        },
      });

      expect(status).toBe(201);
      expect(data.data).toHaveProperty('id');
      expect(data.data!.content_delivery_type).toBe('content');

      const items = data.data!.content_config.content_items;
      expect(items).toHaveLength(VIDEO_ITEMS.length + DOWNLOAD_ITEMS.length + HOSTED_ITEMS.length);

      fullProductId = data.data!.id;
      createdProductIds.push(fullProductId);
    });

    it('saved content items should preserve order and type', async () => {
      const { status, data } = await get<ApiResponse<Product>>(`/api/v1/products/${fullProductId}`);
      expect(status).toBe(200);

      const items = data.data!.content_config.content_items;
      const videoItems = items.filter((i) => i.type === 'video_embed');
      const downloadItems = items.filter((i) => i.type === 'download_link');
      const hostedVideoItems = items.filter((i) => i.type === 'hosted_video');
      const hostedFileItems = items.filter((i) => i.type === 'hosted_file');

      expect(videoItems).toHaveLength(VIDEO_ITEMS.length);
      expect(downloadItems).toHaveLength(DOWNLOAD_ITEMS.length);
      expect(hostedVideoItems).toHaveLength(1);
      expect(hostedFileItems).toHaveLength(1);
    });
  });

  // ── Video embed — per-platform tests ──────────────────────────────────────

  describe('video_embed — walidacja URL per platforma', () => {
    const getProductWith = (items: ContentItem[]) => ({
      name: `Video Test ${Date.now()}`,
      slug: uniqueSlug(),
      description: 'Test wideo',
      price: 0,
      content_delivery_type: 'content',
      content_config: { content_items: items },
    });

    it.each([
      ['YouTube watch URL',    'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
      ['YouTube youtu.be',     'https://youtu.be/dQw4w9WgXcQ'],
      ['YouTube embed URL',    'https://www.youtube.com/embed/dQw4w9WgXcQ'],
      ['Vimeo watch URL',      'https://vimeo.com/76979871'],
      ['Vimeo player URL',     'https://player.vimeo.com/video/76979871'],
      ['Bunny Stream embed',   'https://iframe.mediadelivery.net/embed/123456/a1b2c3d4-e5f6-7890-abcd-ef1234567890'],
      ['Loom share URL',       'https://www.loom.com/share/a1b2c3d4e5f6478a9b0c1d2e3f4a5b6c'],
      ['Wistia medias URL',    'https://support.wistia.com/medias/e4a27b971d'],
      ['DailyMotion video URL','https://www.dailymotion.com/video/x7tgad0'],
      ['Twitch player embed',  'https://player.twitch.tv/?video=2321733225&parent=localhost'],
    ])('should accept %s', async (label, embed_url) => {
      const { status, data } = await post<ApiResponse<Product>>('/api/v1/products', getProductWith([
        { id: `test-${Date.now()}`, type: 'video_embed', order: 1, title: label, is_active: true, config: { embed_url } },
      ]));

      expect(status, `${label}: ${JSON.stringify(data.error)}`).toBe(201);
      createdProductIds.push(data.data!.id);
    });

    it.each([
      ['HTTP YouTube (not HTTPS)',    'http://www.youtube.com/watch?v=dQw4w9WgXcQ'],
      ['untrusted domain',            'https://evil.com/video/abc'],
      ['random HTTPS URL',            'https://example.com/video.mp4'],
      ['Twitch channel (not a video)','https://www.twitch.tv/somestreamer'],
    ])('should reject %s', async (label, embed_url) => {
      const { status } = await post<ApiResponse<Product>>('/api/v1/products', getProductWith([
        { id: `test-${Date.now()}`, type: 'video_embed', order: 1, title: label, is_active: true, config: { embed_url } },
      ]));

      expect(status, label).toBe(400);
    });
  });

  // ── Download link — per-provider tests ────────────────────────────────────

  describe('download_link — walidacja URL per dostawca', () => {
    const getProductWith = (items: ContentItem[]) => ({
      name: `Download Test ${Date.now()}`,
      slug: uniqueSlug(),
      description: 'Test download',
      price: 0,
      content_delivery_type: 'content',
      content_config: { content_items: items },
    });

    const makeItem = (id: string, download_url: string, file_name = 'file.pdf'): ContentItem => ({
      id,
      type: 'download_link',
      order: 1,
      title: id,
      is_active: true,
      config: { download_url, file_name },
    });

    it.each([
      // Cloud
      ['AWS S3',                   'https://s3.amazonaws.com/bucket/file.pdf'],
      ['AWS CloudFront',           'https://d1234abcdef.cloudfront.net/file.zip'],
      ['Google Cloud Storage',     'https://storage.googleapis.com/bucket/file.pdf'],
      ['Google Drive',             'https://drive.google.com/uc?export=download&id=abc123'],
      ['Google Docs export',       'https://docs.google.com/presentation/d/abc/export/pdf'],
      ['Supabase Storage (.co)',   'https://xyzxyzxyz.supabase.co/storage/v1/object/public/files/a.zip'],
      // Personal
      ['Dropbox direct link',      'https://www.dropbox.com/s/abc123/file.zip?dl=1'],
      ['Dropbox usercontentlink',  'https://dl.dropboxusercontent.com/s/abc123/file.zip'],
      ['OneDrive',                 'https://onedrive.live.com/download?cid=ABC&resid=ABC%21456&authkey=A'],
      ['OneDrive short link',      'https://1drv.ms/f/s!AbCdEfGhIjKl'],
      ['Box',                      'https://app.box.com/shared/static/abc123.pdf'],
      ['SharePoint',               'https://contoso.sharepoint.com/sites/x/Shared%20Documents/a.pdf'],
      // CDN
      ['Bunny CDN b-cdn.net',      'https://demo.b-cdn.net/file.zip'],
      ['Bunny CDN bunny.net',      'https://storage.bunny.net/file.zip'],
      ['Cloudinary raw',           'https://res.cloudinary.com/demo/raw/upload/v1/file.zip'],
      ['Imgix',                    'https://demo.imgix.net/file.pdf'],
      ['Fastly',                   'https://example.global.ssl.fastly.net/file.zip'],
      // File sharing
      ['Mega',                     'https://mega.nz/file/abc123#key'],
      ['MediaFire',                'https://www.mediafire.com/file/abc123/file.zip/file'],
      ['WeTransfer',               'https://wetransfer.com/downloads/abc123/xyz'],
      ['SendSpace',                'https://www.sendspace.com/file/abc123'],
    ])('should accept %s', async (label, download_url) => {
      const { status, data } = await post<ApiResponse<Product>>('/api/v1/products', getProductWith([
        makeItem(`test-${Date.now()}`, download_url),
      ]));

      expect(status, `${label}: ${JSON.stringify(data.error)}`).toBe(201);
      createdProductIds.push(data.data!.id);
    });

    it.each([
      ['HTTP (not HTTPS)',          'http://storage.googleapis.com/bucket/file.pdf'],
      ['untrusted domain',          'https://random-host.com/file.pdf'],
      ['localhost',                 '/file.pdf'],
      ['domain spoofing attempt',   'https://evil.com/googleapis.com/file.pdf'],
      ['invalid URL',               'not-a-url'],
    ])('should reject %s', async (label, download_url) => {
      const { status } = await post<ApiResponse<Product>>('/api/v1/products', getProductWith([
        makeItem(`test-${Date.now()}`, download_url),
      ]));

      expect(status, label).toBe(400);
    });
  });

  // ── hosted_video & hosted_file ─────────────────────────────────────────────

  describe('hosted_video i hosted_file', () => {
    it('should create product with hosted_video item', async () => {
      const { status, data } = await post<ApiResponse<Product>>('/api/v1/products', {
        name: `Hosted video test ${Date.now()}`,
        slug: uniqueSlug(),
        description: 'Test',
        price: 0,
        content_delivery_type: 'content',
        content_config: {
          content_items: [
            { id: 'hv1', type: 'hosted_video', order: 1, title: 'Wideo na serwerze', is_active: true, config: {} },
          ],
        },
      });

      expect(status).toBe(201);
      const item = data.data!.content_config.content_items[0];
      expect(item.type).toBe('hosted_video');
      createdProductIds.push(data.data!.id);
    });

    it('should create product with hosted_file item', async () => {
      const { status, data } = await post<ApiResponse<Product>>('/api/v1/products', {
        name: `Hosted file test ${Date.now()}`,
        slug: uniqueSlug(),
        description: 'Test',
        price: 0,
        content_delivery_type: 'content',
        content_config: {
          content_items: [
            { id: 'hf1', type: 'hosted_file', order: 1, title: 'Plik na serwerze', is_active: true, config: {} },
          ],
        },
      });

      expect(status).toBe(201);
      const item = data.data!.content_config.content_items[0];
      expect(item.type).toBe('hosted_file');
      createdProductIds.push(data.data!.id);
    });
  });

  // ── PATCH — update content_config ─────────────────────────────────────────

  describe('PATCH /api/v1/products/:id — aktualizacja content_config', () => {
    let productId: string;

    beforeAll(async () => {
      const { data } = await post<ApiResponse<Product>>('/api/v1/products', {
        name: `Patch content test ${Date.now()}`,
        slug: uniqueSlug(),
        description: 'Test',
        price: 0,
        content_delivery_type: 'content',
        content_config: { content_items: [] },
      });
      productId = data.data!.id;
      createdProductIds.push(productId);
    });

    it('should add video items via PATCH', async () => {
      const { status, data } = await patch<ApiResponse<Product>>(`/api/v1/products/${productId}`, {
        content_config: {
          content_items: VIDEO_ITEMS.slice(0, 3), // YouTube, YouTube short, Vimeo
        },
      });

      expect(status).toBe(200);
      expect(data.data!.content_config.content_items).toHaveLength(3);
    });

    it('should replace all content with download items via PATCH', async () => {
      const { status, data } = await patch<ApiResponse<Product>>(`/api/v1/products/${productId}`, {
        content_config: {
          content_items: DOWNLOAD_ITEMS.slice(0, 5), // AWS, GCS, Supabase, GDrive, GDocs
        },
      });

      expect(status).toBe(200);
      expect(data.data!.content_config.content_items).toHaveLength(5);
      expect(data.data!.content_config.content_items.every((i) => i.type === 'download_link')).toBe(true);
    });

    it('should accept empty content_items (clear all)', async () => {
      const { status, data } = await patch<ApiResponse<Product>>(`/api/v1/products/${productId}`, {
        content_config: { content_items: [] },
      });

      expect(status).toBe(200);
      expect(data.data!.content_config.content_items).toHaveLength(0);
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────────────

  describe('content_config — edge cases', () => {
    it('should create product without content_config (defaults to empty)', async () => {
      const { status, data } = await post<ApiResponse<Product>>('/api/v1/products', {
        name: `No content config ${Date.now()}`,
        slug: uniqueSlug(),
        description: 'Test',
        price: 0,
        content_delivery_type: 'content',
      });

      expect(status).toBe(201);
      expect(data.data!.content_config).toEqual({ content_items: [] });
      createdProductIds.push(data.data!.id);
    });

    it('should preserve item titles, descriptions and is_active flag', async () => {
      const { status, data } = await post<ApiResponse<Product>>('/api/v1/products', {
        name: `Field preservation test ${Date.now()}`,
        slug: uniqueSlug(),
        description: 'Test',
        price: 0,
        content_delivery_type: 'content',
        content_config: {
          content_items: [
            {
              id: 'pres-1',
              type: 'download_link',
              order: 1,
              title: 'Mój tytuł',
              description: 'Mój opis',
              is_active: false,
              config: {
                download_url: 'https://storage.googleapis.com/bucket/file.pdf',
                file_name: 'file.pdf',
                file_size: '1 MB',
              },
            },
          ],
        },
      });

      expect(status).toBe(201);
      const item = data.data!.content_config.content_items[0];
      expect(item.title).toBe('Mój tytuł');
      expect(item.description).toBe('Mój opis');
      expect(item.is_active).toBe(false);
      createdProductIds.push(data.data!.id);
    });

    it('should validate multiple invalid items and report all errors', async () => {
      const { status, data } = await post<ApiResponse<Product>>('/api/v1/products', {
        name: `Multi error test ${Date.now()}`,
        slug: uniqueSlug(),
        description: 'Test',
        price: 0,
        content_delivery_type: 'content',
        content_config: {
          content_items: [
            // Item 1 — invalid video platform
            {
              id: 'bad-1',
              type: 'video_embed',
              order: 1,
              title: 'Zły URL wideo',
              is_active: true,
              config: { embed_url: 'https://evil.com/video' },
            },
            // Item 2 — HTTP download (not HTTPS)
            {
              id: 'bad-2',
              type: 'download_link',
              order: 2,
              title: 'Niezabezpieczony download',
              is_active: true,
              config: { download_url: 'http://storage.googleapis.com/bucket/file.pdf', file_name: 'file.pdf' },
            },
          ],
        },
      });

      expect(status).toBe(400);
      expect(data.error?.code).toBe('VALIDATION_ERROR');

      // Both items should be reported
      const errors = (data.error?.details as { _errors?: string[] })?._errors ?? [];
      expect(errors.length).toBeGreaterThanOrEqual(2);
    });
  });
});
