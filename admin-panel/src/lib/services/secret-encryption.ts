/**
 * Secret Encryption Service — AES-256-GCM authenticated encryption for any
 * sensitive value stored in the database (Stripe API keys, webhook signing
 * secrets, GUS API keys, Currency API keys, future integrations).
 *
 * Uses APP_ENCRYPTION_KEY (falls back to STRIPE_ENCRYPTION_KEY for backwards
 * compatibility with existing installations).
 *
 * Security features:
 * - AES-256-GCM authenticated encryption
 * - Random initialization vector (IV) per encryption
 * - Authentication tag for integrity verification
 * - Base64 encoding for database storage
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

export interface EncryptionResult {
  encryptedKey: string;
  iv: string;
  tag: string;
}

export interface EncryptedConfig {
  encrypted_key: string;
  encryption_iv: string;
  encryption_tag: string;
}

function validateEncryptionKey(): Buffer {
  const encryptionKey = process.env.APP_ENCRYPTION_KEY || process.env.STRIPE_ENCRYPTION_KEY;

  if (!encryptionKey) {
    throw new Error(
      'APP_ENCRYPTION_KEY is not configured. Generate one with: openssl rand -base64 32'
    );
  }

  try {
    const keyBuffer = Buffer.from(encryptionKey, 'base64');

    if (keyBuffer.length !== 32) {
      throw new Error(
        `APP_ENCRYPTION_KEY must be 32 bytes (256 bits). Current length: ${keyBuffer.length} bytes. ` +
        'Generate a new key with: openssl rand -base64 32'
      );
    }

    return keyBuffer;
  } catch (error) {
    if (error instanceof Error && error.message.includes('must be 32 bytes')) {
      throw error;
    }
    throw new Error(
      'APP_ENCRYPTION_KEY is not valid base64. Generate one with: openssl rand -base64 32'
    );
  }
}

export async function encryptSecret(plaintext: string): Promise<EncryptionResult> {
  if (!plaintext || plaintext.trim().length === 0) {
    throw new Error('Cannot encrypt empty value');
  }

  try {
    const key = validateEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    const tag = cipher.getAuthTag();

    return {
      encryptedKey: encrypted,
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Encryption failed: ${error.message}`);
    }
    throw new Error('Encryption failed: Unknown error');
  }
}

export async function decryptSecret(config: EncryptedConfig): Promise<string> {
  if (!config.encrypted_key || !config.encryption_iv || !config.encryption_tag) {
    throw new Error('Missing required encryption parameters');
  }

  try {
    const key = validateEncryptionKey();
    const iv = Buffer.from(config.encryption_iv, 'base64');
    const tag = Buffer.from(config.encryption_tag, 'base64');

    if (iv.length !== IV_LENGTH) {
      throw new Error(`Invalid IV length: ${iv.length} bytes (expected ${IV_LENGTH})`);
    }
    if (tag.length !== TAG_LENGTH) {
      throw new Error(`Invalid tag length: ${tag.length} bytes (expected ${TAG_LENGTH})`);
    }

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(config.encrypted_key, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('Unsupported state or unable to authenticate data')) {
        throw new Error(
          'Decryption failed: Authentication tag verification failed. ' +
          'Data may be corrupted or tampered with.'
        );
      }
      throw new Error(`Decryption failed: ${error.message}`);
    }
    throw new Error('Decryption failed: Unknown error');
  }
}
