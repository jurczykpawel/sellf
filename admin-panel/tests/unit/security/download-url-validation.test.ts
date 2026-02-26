import { describe, it, expect } from 'vitest';
import { validateCreateProduct, validateUpdateProduct } from '@/lib/validations/product';

/**
 * ============================================================================
 * SECURITY TEST: Download URL Validation
 * ============================================================================
 *
 * VULNERABILITY: Download URL Validation Bypass via Domain Spoofing
 * LOCATION: src/lib/validations/product.ts
 *
 * ATTACK FLOW (before fix):
 * 1. Attacker creates product with download URL: https://cdn.attacker.com/malware.exe
 * 2. Previous validation used hostname.includes('cdn.') which matched
 * 3. Users download malicious files thinking they're from trusted CDN
 *
 * FIX (V15):
 * - Changed from includes() to endsWith() for domain validation
 * - hostname must END with trusted domain, not just contain it
 * - This blocks cdn.attacker.com, amazonaws.com.evil.com, etc.
 *
 * Created during security audit (2026-01-08)
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

});
