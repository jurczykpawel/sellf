import { test, expect } from '@playwright/test';

test.describe('API Validation Logic', () => {

  test('should accept a valid, non-disposable email', async ({ request }) => {
    const res = await request.post('/api/validate-email', {
      data: { email: 'test@gmail.com' }
    });
    expect(res.ok()).toBeTruthy();
    expect(res.status()).toBe(200);
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data.isValid).toBe(true);
    expect(json.data.isDisposable).toBe(false);
    expect(json.data.domain).toBe('gmail.com');

    // Verify meta field is present and well-formed
    expect(json.meta).toBeDefined();
    expect(json.meta.timestamp).toBeDefined();
    expect(typeof json.meta.processingTime).toBe('number');
    expect(json.meta.processingTime).toBeGreaterThanOrEqual(0);
    expect(typeof json.meta.domainsLoaded).toBe('number');
  });

  test('should reject disposable email addresses from a list of known providers', async ({ request }) => {
    const disposableDomains = [
      'temp-mail.org',
      'mailinator.com',
      '10minutemail.com',
      'guerrillamail.com',
      'throwawaymail.com'
    ];

    for (const domain of disposableDomains) {
      const res = await request.post('/api/validate-email', {
        data: { email: `test@${domain}` }
      });

      expect(res.status()).toBe(200);
      const json = await res.json();

      expect(json.success).toBe(true);
      expect(json.data.isValid).toBe(false);
      expect(json.data.isDisposable).toBe(true);
      expect(json.data.domain).toBe(domain);
    }
  });

  test('should reject an email with an invalid format', async ({ request }) => {
    const res = await request.post('/api/validate-email', {
      data: { email: 'invalid-email' }
    });

    expect(res.status()).toBe(400);
    const json = await res.json();

    expect(json.success).toBe(false);
    expect(json.error).toBeDefined();
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(json.error.message).toBeDefined();
  });

  test('should return 400 when email field is missing', async ({ request }) => {
    const res = await request.post('/api/validate-email', {
      data: { notEmail: 'test@gmail.com' }
    });

    expect(res.status()).toBe(400);
    const json = await res.json();

    expect(json.success).toBe(false);
    expect(json.error).toBeDefined();
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  test('should return 400 when email is not a string', async ({ request }) => {
    const res = await request.post('/api/validate-email', {
      data: { email: 12345 }
    });

    expect(res.status()).toBe(400);
    const json = await res.json();

    expect(json.success).toBe(false);
    expect(json.error).toBeDefined();
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  test('should return 400 when request body is empty', async ({ request }) => {
    const res = await request.post('/api/validate-email', {
      data: {}
    });

    expect(res.status()).toBe(400);
    const json = await res.json();

    expect(json.success).toBe(false);
    expect(json.error).toBeDefined();
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  test('should return 405 for GET requests', async ({ request }) => {
    const res = await request.get('/api/validate-email');

    expect(res.status()).toBe(405);
    const json = await res.json();

    expect(json.success).toBe(false);
    expect(json.error).toBeDefined();
    expect(json.error.code).toBe('METHOD_NOT_ALLOWED');
  });

  test('should reject multiple invalid email formats', async ({ request }) => {
    const invalidEmails = [
      'plaintext',
      '@no-local-part.com',
      'missing-domain@',
      'double@@at.com',
      ' spaces@domain.com',
    ];

    for (const email of invalidEmails) {
      const res = await request.post('/api/validate-email', {
        data: { email }
      });

      const json = await res.json();

      expect(res.status()).toBe(400);
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('VALIDATION_ERROR');
    }
  });

  test('should accept valid emails from various providers', async ({ request }) => {
    const validEmails = [
      'user@outlook.com',
      'name@company.co.uk',
      'test.user@domain.org',
    ];

    for (const email of validEmails) {
      const res = await request.post('/api/validate-email', {
        data: { email }
      });

      expect(res.status()).toBe(200);
      const json = await res.json();

      expect(json.success).toBe(true);
      expect(json.data.isValid).toBe(true);
      expect(json.data.isDisposable).toBe(false);
    }
  });
});
