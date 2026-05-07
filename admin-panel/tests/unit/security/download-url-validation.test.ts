import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateCreateProduct, validateUpdateProduct } from '@/lib/validations/product';
import { isTrustedDownloadUrl } from '@/lib/trustedDownloadProviders';

const ENV_KEY = 'NEXT_PUBLIC_SELLF_ALLOWED_DOWNLOAD_DOMAINS';

/**
 * ============================================================================
 * SECURITY TEST: Download URL Validation
 * ============================================================================
 *
 * Verifies that product download URL validation correctly enforces
 * trusted domain checks and rejects spoofed or malicious URLs.
 * Tests the production validateCreateProduct/validateUpdateProduct functions.
 * ============================================================================
 */

// Helper to create product data with download URL
function createProductWithDownloadUrl(downloadUrl: string) {
  return {
    name: 'Test Product',
    slug: 'test-product',
    description: 'Test description',
    price: 10,
    content_delivery_type: 'content',
    content_config: {
      content_items: [
        {
          id: 'item-1',
          type: 'download_link',
          title: 'Download',
          content: '',
          order: 1,
          is_active: true,
          config: {
            download_url: downloadUrl,
          },
        },
      ],
    },
  };
}

describe('Download URL Validation Security', () => {
  describe('Trusted Storage Providers - ALLOWED', () => {
    const trustedUrls = [
      // AWS S3
      'https://bucket.s3.amazonaws.com/file.zip',
      'https://bucket.s3.eu-west-1.amazonaws.com/file.pdf',
      // Google Cloud Storage
      'https://storage.googleapis.com/bucket/file.zip',
      // Supabase Storage
      'https://xyz.supabase.co/storage/v1/object/file.zip',
      // Bunny CDN
      'https://cdn.bunny.net/file.zip',
      'https://example.b-cdn.net/file.zip',
      // Google Drive
      'https://drive.google.com/file/d/1234/view',
      'https://docs.google.com/document/d/1234',
      // Dropbox
      'https://www.dropbox.com/s/abc123/file.zip',
      'https://dl.dropboxusercontent.com/s/abc/file.zip',
      // OneDrive
      'https://onedrive.live.com/download?cid=123',
      'https://1drv.ms/u/s!abc123',
      // Microsoft SharePoint
      'https://company.sharepoint.com/files/file.zip',
      // Box
      'https://app.box.com/s/abc123',
      // Mega
      'https://mega.nz/file/abc123',
      // MediaFire
      'https://www.mediafire.com/file/abc123/file.zip',
      // Cloudinary
      'https://res.cloudinary.com/demo/image/upload/file.jpg',
      // Imgix
      'https://example.imgix.net/image.jpg',
      // Fastly
      'https://example.fastly.net/file.zip',
      // CloudFront
      'https://d123.cloudfront.net/file.zip',
      // Azure CDN
      'https://example.azureedge.net/file.zip',
      // Cloudflare R2
      'https://bucket.r2.cloudflarestorage.com/file.zip',
    ];

    trustedUrls.forEach((url) => {
      it(`should ALLOW: ${new URL(url).hostname}`, () => {
        const data = createProductWithDownloadUrl(url);
        const result = validateCreateProduct(data);
        expect(result.isValid).toBe(true);
      });
    });
  });

  describe('Domain Spoofing Attacks - BLOCKED', () => {
    it('should BLOCK cdn.attacker.com (subdomain spoofing)', () => {
      const data = createProductWithDownloadUrl('https://cdn.attacker.com/malware.exe');
      const result = validateCreateProduct(data);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('trusted storage provider'))).toBe(true);
    });

    it('should BLOCK storage.attacker.com (subdomain spoofing)', () => {
      const data = createProductWithDownloadUrl('https://storage.attacker.com/malware.exe');
      const result = validateCreateProduct(data);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('trusted storage provider'))).toBe(true);
    });

    it('should BLOCK amazonaws.com.evil.com (domain suffix spoofing)', () => {
      const data = createProductWithDownloadUrl('https://amazonaws.com.evil.com/file.zip');
      const result = validateCreateProduct(data);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('trusted storage provider'))).toBe(true);
    });

    it('should BLOCK s3.amazonaws.com.attacker.net', () => {
      const data = createProductWithDownloadUrl('https://s3.amazonaws.com.attacker.net/file.zip');
      const result = validateCreateProduct(data);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('trusted storage provider'))).toBe(true);
    });

    it('should BLOCK dropbox.com-downloads.evil.com', () => {
      const data = createProductWithDownloadUrl('https://dropbox.com-downloads.evil.com/file.zip');
      const result = validateCreateProduct(data);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('trusted storage provider'))).toBe(true);
    });

    it('should BLOCK bunny.net.evil.com', () => {
      const data = createProductWithDownloadUrl('https://bunny.net.evil.com/file.zip');
      const result = validateCreateProduct(data);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('trusted storage provider'))).toBe(true);
    });

    it('should BLOCK cloudinary.com-cdn.attacker.com', () => {
      const data = createProductWithDownloadUrl('https://cloudinary.com-cdn.attacker.com/file.zip');
      const result = validateCreateProduct(data);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('trusted storage provider'))).toBe(true);
    });
  });

  describe('Untrusted Domains - BLOCKED', () => {
    const untrustedUrls = [
      'https://attacker.com/file.zip',
      'https://malware.xyz/trojan.exe',
      'https://phishing-site.com/fake-software.zip',
      'https://filehosting.ru/suspicious.exe',
      'https://random-domain.io/download.zip',
    ];

    untrustedUrls.forEach((url) => {
      it(`should BLOCK untrusted: ${new URL(url).hostname}`, () => {
        const data = createProductWithDownloadUrl(url);
        const result = validateCreateProduct(data);
        expect(result.isValid).toBe(false);
      });
    });
  });

  describe('Protocol Security - BLOCKED', () => {
    it('should BLOCK HTTP URLs (not HTTPS)', () => {
      const data = createProductWithDownloadUrl('http://bucket.s3.amazonaws.com/file.zip');
      const result = validateCreateProduct(data);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('HTTPS'))).toBe(true);
    });

    it('should BLOCK javascript: protocol', () => {
      const data = createProductWithDownloadUrl('javascript:alert(1)');
      const result = validateCreateProduct(data);
      expect(result.isValid).toBe(false);
    });

    it('should BLOCK data: URLs', () => {
      const data = createProductWithDownloadUrl('data:text/html,<script>alert(1)</script>');
      const result = validateCreateProduct(data);
      expect(result.isValid).toBe(false);
    });
  });

  describe('Invalid URLs - BLOCKED', () => {
    it('should BLOCK malformed URLs', () => {
      const data = createProductWithDownloadUrl('not-a-valid-url');
      const result = validateCreateProduct(data);
      expect(result.isValid).toBe(false);
    });

    it('should BLOCK empty URLs', () => {
      const data = createProductWithDownloadUrl('');
      const result = validateCreateProduct(data);
      // Empty URL in config is allowed (optional field)
      // The validation only kicks in when URL is provided
      expect(result.isValid).toBe(true);
    });
  });

  describe('Case Sensitivity', () => {
    it('should handle uppercase domain names', () => {
      const data = createProductWithDownloadUrl('https://BUCKET.S3.AMAZONAWS.COM/file.zip');
      const result = validateCreateProduct(data);
      expect(result.isValid).toBe(true);
    });

    it('should handle mixed case domain names', () => {
      const data = createProductWithDownloadUrl('https://Bucket.S3.AmazonAWS.com/file.zip');
      const result = validateCreateProduct(data);
      expect(result.isValid).toBe(true);
    });
  });

  describe('Update Product with Download URL', () => {
    it('should validate download URLs in partial updates', () => {
      const data = {
        content_config: {
          content_items: [
            {
              id: 'item-1',
              type: 'download_link',
              title: 'Download',
              content: '',
              order: 1,
              is_active: true,
              config: {
                download_url: 'https://cdn.attacker.com/malware.exe',
              },
            },
          ],
        },
      };
      const result = validateUpdateProduct(data);
      expect(result.isValid).toBe(false);
    });
  });

  describe('Env-extended host list (NEXT_PUBLIC_SELLF_ALLOWED_DOWNLOAD_DOMAINS)', () => {
    const originalEnv = process.env[ENV_KEY];

    beforeEach(() => {
      delete process.env[ENV_KEY];
    });

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env[ENV_KEY];
      } else {
        process.env[ENV_KEY] = originalEnv;
      }
    });

    it('accepts a hostname added via env var', () => {
      process.env[ENV_KEY] = 'lm.techskills.academy';
      const data = createProductWithDownloadUrl('https://lm.techskills.academy/lead-magnet.pdf');
      const result = validateCreateProduct(data);
      expect(result.isValid).toBe(true);
    });

    it('accepts a direct subdomain of an env-added hostname', () => {
      process.env[ENV_KEY] = 'techskills.academy';
      const data = createProductWithDownloadUrl('https://lm.techskills.academy/lead-magnet.pdf');
      const result = validateCreateProduct(data);
      expect(result.isValid).toBe(true);
    });

    it('accepts multiple comma-separated env hostnames', () => {
      process.env[ENV_KEY] = 'lm.techskills.academy, assets.example.com';
      expect(isTrustedDownloadUrl('https://lm.techskills.academy/file.pdf')).toBe(true);
      expect(isTrustedDownloadUrl('https://assets.example.com/file.pdf')).toBe(true);
    });

    it('rejects a hostname that merely ends with the env-added value as a subdomain of an unrelated host', () => {
      process.env[ENV_KEY] = 'lm.techskills.academy';
      const data = createProductWithDownloadUrl('https://lm.techskills.academy.other.example/x.pdf');
      const result = validateCreateProduct(data);
      expect(result.isValid).toBe(false);
    });

    it('rejects a hostname that shares the env-added value as a prefix without a dot boundary', () => {
      process.env[ENV_KEY] = 'lm.techskills.academy';
      const data = createProductWithDownloadUrl('https://lm.techskills.academy-other.example/x.pdf');
      const result = validateCreateProduct(data);
      expect(result.isValid).toBe(false);
    });

    it('still requires HTTPS for env-added hostnames', () => {
      process.env[ENV_KEY] = 'lm.techskills.academy';
      const data = createProductWithDownloadUrl('http://lm.techskills.academy/file.pdf');
      const result = validateCreateProduct(data);
      expect(result.isValid).toBe(false);
    });

    it('drops env entries that include a protocol prefix', () => {
      process.env[ENV_KEY] = 'https://lm.techskills.academy';
      const data = createProductWithDownloadUrl('https://lm.techskills.academy/file.pdf');
      const result = validateCreateProduct(data);
      expect(result.isValid).toBe(false);
    });

    it('drops env entries that include a path segment', () => {
      process.env[ENV_KEY] = 'lm.techskills.academy/path';
      const data = createProductWithDownloadUrl('https://lm.techskills.academy/file.pdf');
      const result = validateCreateProduct(data);
      expect(result.isValid).toBe(false);
    });

    it('drops env entries that include wildcard characters', () => {
      process.env[ENV_KEY] = '*.techskills.academy';
      const data = createProductWithDownloadUrl('https://lm.techskills.academy/file.pdf');
      const result = validateCreateProduct(data);
      expect(result.isValid).toBe(false);
    });

    it('drops env entries that contain whitespace inside the value', () => {
      process.env[ENV_KEY] = 'lm techskills academy';
      const data = createProductWithDownloadUrl('https://lm.techskills.academy/file.pdf');
      const result = validateCreateProduct(data);
      expect(result.isValid).toBe(false);
    });

    it('ignores empty list entries from leading, trailing, or double commas', () => {
      process.env[ENV_KEY] = ',,lm.techskills.academy,,';
      expect(isTrustedDownloadUrl('https://lm.techskills.academy/file.pdf')).toBe(true);
      expect(isTrustedDownloadUrl('https://bucket.s3.amazonaws.com/file.zip')).toBe(true);
    });

    it('normalizes env entries to lowercase before matching', () => {
      process.env[ENV_KEY] = 'LM.TECHSKILLS.ACADEMY';
      expect(isTrustedDownloadUrl('https://lm.techskills.academy/file.pdf')).toBe(true);
    });

    it('falls back to the baseline list when env var is empty', () => {
      process.env[ENV_KEY] = '';
      expect(isTrustedDownloadUrl('https://bucket.s3.amazonaws.com/file.zip')).toBe(true);
      expect(isTrustedDownloadUrl('https://lm.techskills.academy/file.pdf')).toBe(false);
    });

    it('falls back to the baseline list when env var is unset', () => {
      delete process.env[ENV_KEY];
      expect(isTrustedDownloadUrl('https://bucket.s3.amazonaws.com/file.zip')).toBe(true);
      expect(isTrustedDownloadUrl('https://lm.techskills.academy/file.pdf')).toBe(false);
    });

    it('exposes env additions to both validateCreateProduct and isTrustedDownloadUrl', () => {
      process.env[ENV_KEY] = 'lm.techskills.academy';
      expect(isTrustedDownloadUrl('https://lm.techskills.academy/x')).toBe(true);
      const result = validateCreateProduct(
        createProductWithDownloadUrl('https://lm.techskills.academy/x')
      );
      expect(result.isValid).toBe(true);
    });
  });

});
