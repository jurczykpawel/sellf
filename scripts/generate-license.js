#!/usr/bin/env node
/**
 * Sellf License Generator
 *
 * Generates ECDSA-signed license keys for Sellf installations.
 *
 * License format: SF-{domain}-{tier}-{expiry}-{signature}
 * Signed data:    {domain}-{tier}-{expiry}
 *
 * Usage:
 *   node generate-license.js <domain> [tier] [expiry]
 *
 * Examples:
 *   node generate-license.js example.com PRO 20271231      # Pro until Dec 31, 2027
 *   node generate-license.js example.com PRO UNLIMITED     # Pro, never expires
 *   node generate-license.js example.com BIZ UNLIMITED     # Business, never expires
 *   node generate-license.js "*.example.com" PRO UNLIMITED # Wildcard domain
 *
 * Tiers:
 *   REG  - Registered Free: CSV export, audit log UI.
 *   PRO  - Watermark removal, themes, marketplace, webhook retry, API key scopes, etc.
 *   BIZ  - All PRO features + RBAC, SSO, advanced analytics, backup/restore, etc.
 *
 * Environment:
 *   SELLF_PRIVATE_KEY - ECDSA private key (PEM format)
 *   or
 *   SELLF_PRIVATE_KEY_FILE - Path to private key file
 *
 * First-time setup (generate key pair):
 *   node generate-license.js --generate-keys
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// =============================================================================
// KEY MANAGEMENT
// =============================================================================

function generateKeyPair() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
        namedCurve: 'P-256',
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    return { publicKey, privateKey };
}

function getPrivateKey() {
    // Try environment variable first
    if (process.env.SELLF_PRIVATE_KEY) {
        return process.env.SELLF_PRIVATE_KEY;
    }

    // Try file path from env
    if (process.env.SELLF_PRIVATE_KEY_FILE) {
        return fs.readFileSync(process.env.SELLF_PRIVATE_KEY_FILE, 'utf8');
    }

    // Try default location
    const defaultPath = path.join(__dirname, '.sellf-private-key.pem');
    if (fs.existsSync(defaultPath)) {
        return fs.readFileSync(defaultPath, 'utf8');
    }

    return null;
}

// =============================================================================
// LICENSE GENERATION
// =============================================================================

const VALID_TIERS = ['REG', 'PRO', 'BIZ', 'MKT'];

function generateLicense(domain, tier, expiry, privateKeyPem) {
    // Validate domain
    if (!domain || typeof domain !== 'string') {
        throw new Error('Invalid domain');
    }

    // Validate tier
    if (!VALID_TIERS.includes(tier)) {
        throw new Error(`Tier must be one of: ${VALID_TIERS.join(', ')}`);
    }

    // Validate expiry
    if (expiry !== 'UNLIMITED' && !/^\d{8}$/.test(expiry)) {
        throw new Error('Expiry must be YYYYMMDD format or "UNLIMITED"');
    }

    // Data to sign: domain-tier-expiry
    const dataToSign = `${domain}-${tier}-${expiry}`;

    // Create signature
    const sign = crypto.createSign('SHA256');
    sign.update(dataToSign);
    sign.end();

    const signature = sign.sign(privateKeyPem);

    // Convert to base64url (URL-safe base64)
    const signatureBase64url = signature
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');

    // Build license key: SF-{domain}-{tier}-{expiry}-{signature}
    return `SF-${domain}-${tier}-${expiry}-${signatureBase64url}`;
}

function verifyLicense(licenseKey, publicKeyPem) {
    const parts = licenseKey.split('-');
    if (parts.length < 4 || parts[0] !== 'SF') {
        return { valid: false, reason: 'invalid_format' };
    }

    let domain, tier, expiry, signedData, signatureBase64url;

    // Current format: SF-{domain}-{TIER}-{expiry}-{signature}
    if (parts.length >= 5 && VALID_TIERS.includes(parts[2])) {
        domain = parts[1];
        tier = parts[2];
        expiry = parts[3];
        signedData = `${domain}-${tier}-${expiry}`;
        signatureBase64url = parts.slice(4).join('-');
    } else {
        // Legacy format: SF-{domain}-{expiry}-{signature} (no tier = PRO)
        domain = parts[1];
        tier = 'PRO';
        expiry = parts[2];
        signedData = `${domain}-${expiry}`;
        signatureBase64url = parts.slice(3).join('-');
    }

    // Convert base64url back to base64
    let signatureBase64 = signatureBase64url.replace(/-/g, '+').replace(/_/g, '/');
    while (signatureBase64.length % 4) signatureBase64 += '=';
    const signature = Buffer.from(signatureBase64, 'base64');

    // Verify signature
    const verify = crypto.createVerify('SHA256');
    verify.update(signedData);
    verify.end();

    const isValid = verify.verify(publicKeyPem, signature);

    return {
        valid: isValid,
        domain,
        tier,
        expiry,
        expiryDate: expiry === 'UNLIMITED' ? null : parseExpiryDate(expiry)
    };
}

function parseExpiryDate(expiry) {
    const year = parseInt(expiry.slice(0, 4));
    const month = parseInt(expiry.slice(4, 6)) - 1;
    const day = parseInt(expiry.slice(6, 8));
    return new Date(year, month, day);
}

// =============================================================================
// CLI
// =============================================================================

function printUsage() {
    console.log(`
Sellf License Generator

Usage:
  node generate-license.js <domain> <tier> [expiry]
  node generate-license.js --generate-keys
  node generate-license.js --verify <license-key>

Arguments:
  domain    Domain the license is valid for (e.g., example.com, *.example.com)
  tier      License tier: PRO or BIZ (Business)
  expiry    Expiry date in YYYYMMDD format, or "UNLIMITED" (default: UNLIMITED)

Tiers:
  REG   Registered Free: CSV export, audit log UI.
  PRO   Watermark removal, themes, marketplace, API key scopes, etc.
  BIZ   All PRO features + RBAC, SSO, unlimited API keys, etc.

Options:
  --generate-keys    Generate a new ECDSA key pair
  --verify <key>     Verify an existing license key

Environment Variables:
  SELLF_PRIVATE_KEY       Private key (PEM format)
  SELLF_PRIVATE_KEY_FILE  Path to private key file

Examples:
  node generate-license.js example.com PRO 20271231
  node generate-license.js example.com PRO UNLIMITED
  node generate-license.js example.com BIZ UNLIMITED
  node generate-license.js "*.example.com" PRO UNLIMITED
`);
}

function main() {
    const args = process.argv.slice(2);

    // Generate keys
    if (args[0] === '--generate-keys') {
        console.log('Generating ECDSA P-256 key pair...\n');
        const { publicKey, privateKey } = generateKeyPair();

        const privateKeyPath = path.join(__dirname, '.sellf-private-key.pem');
        const publicKeyPath = path.join(__dirname, 'sellf-public-key.pem');

        fs.writeFileSync(privateKeyPath, privateKey);
        fs.writeFileSync(publicKeyPath, publicKey);

        console.log('=== PRIVATE KEY (keep secret!) ===');
        console.log(`Saved to: ${privateKeyPath}`);
        console.log('');
        console.log('=== PUBLIC KEY (embed in sellf.js) ===');
        console.log(publicKey);
        console.log(`Saved to: ${publicKeyPath}`);
        console.log('');
        console.log('IMPORTANT: Add .sellf-private-key.pem to .gitignore!');
        return;
    }

    // Verify license
    if (args[0] === '--verify') {
        const licenseKey = args[1];
        if (!licenseKey) {
            console.error('Error: License key required for verification');
            process.exit(1);
        }

        // Try to find public key
        const publicKeyPath = path.join(__dirname, 'sellf-public-key.pem');
        if (!fs.existsSync(publicKeyPath)) {
            console.error('Error: Public key not found. Run --generate-keys first.');
            process.exit(1);
        }

        const publicKey = fs.readFileSync(publicKeyPath, 'utf8');
        const result = verifyLicense(licenseKey, publicKey);

        console.log('\nLicense Verification Result:');
        console.log('============================');
        console.log(`Valid: ${result.valid ? 'YES' : 'NO'}`);
        if (result.valid) {
            console.log(`Domain: ${result.domain}`);
            console.log(`Tier: ${result.tier}`);
            console.log(`Expiry: ${result.expiry}${result.expiryDate ? ` (${result.expiryDate.toDateString()})` : ''}`);
        } else {
            console.log(`Reason: ${result.reason || 'Invalid signature'}`);
        }
        return;
    }

    // Generate license
    if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
        printUsage();
        return;
    }

    const domain = args[0];
    const tier = args[1];
    const expiry = args[2] || 'UNLIMITED';

    if (!tier || !VALID_TIERS.includes(tier)) {
        console.error(`Error: Tier is required. Must be one of: ${VALID_TIERS.join(', ')}`);
        console.error('');
        console.error('Usage: node generate-license.js <domain> <tier> [expiry]');
        process.exit(1);
    }

    // Get private key
    const privateKey = getPrivateKey();
    if (!privateKey) {
        console.error('Error: Private key not found.');
        console.error('');
        console.error('Either:');
        console.error('  1. Run: node generate-license.js --generate-keys');
        console.error('  2. Set SELLF_PRIVATE_KEY environment variable');
        console.error('  3. Set SELLF_PRIVATE_KEY_FILE environment variable');
        process.exit(1);
    }

    try {
        const license = generateLicense(domain, tier, expiry, privateKey);
        const tierLabel = tier === 'BIZ' ? 'Business' : 'Pro';

        console.log('\n=== Generated License ===\n');
        console.log(license);
        console.log('\n=== License Details ===');
        console.log(`Domain: ${domain}`);
        console.log(`Tier: ${tierLabel} (${tier})`);
        console.log(`Expiry: ${expiry}${expiry !== 'UNLIMITED' ? ` (${parseExpiryDate(expiry).toDateString()})` : ''}`);
        console.log('\n=== Usage ===');
        console.log('Set SELLF_LICENSE_KEY environment variable or add to admin panel settings.');
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
}

main();
