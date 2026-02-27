# Security Policy

## Supported Versions

We release patches for security vulnerabilities in the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

We take the security of Sellf seriously. If you believe you have found a security vulnerability, please report it to us as described below.

**Please do not report security vulnerabilities through public GitHub issues.**

### How to Report

Please report security vulnerabilities using [GitHub Security Advisories](https://github.com/jurczykpawel/sellf/security/advisories/new).

Include the following information:
- Type of vulnerability (e.g., XSS, SQL injection, authentication bypass)
- Full paths of source file(s) related to the vulnerability
- Location of the affected source code (tag/branch/commit or direct URL)
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue, including how an attacker might exploit it

### What to Expect

- **Acknowledgment**: We will acknowledge receipt of your vulnerability report within 48 hours
- **Assessment**: We will assess the vulnerability and determine its severity
- **Fix Timeline**: Critical vulnerabilities will be addressed within 7 days; high-priority within 30 days
- **Disclosure**: We will coordinate with you on the disclosure timeline
- **Credit**: We will credit you in our release notes (if you wish)

## Security Features

Sellf implements comprehensive security measures:

- **Authentication**: Supabase Auth with magic link and OAuth support
- **Authorization**: Row Level Security (RLS) policies on all database tables
- **Rate Limiting**: Multi-layer rate limiting with anti-spoofing (server-side IP only)
- **Input Validation**: Zod schemas for all API inputs
- **SQL Injection Prevention**: Parameterized queries throughout
- **XSS Protection**: Content sanitization and CSP headers
- **CSRF Protection**: Custom header requirements for API calls
- **Encryption**: AES-256-GCM for API keys and sensitive data
- **Audit Logging**: Comprehensive logging of admin actions
- **Payment Security**: PCI-compliant Stripe integration

## Security Updates

Security updates are released as patch versions (e.g., 1.0.1, 1.0.2). Subscribe to our releases to stay informed:
- Watch this repository for new releases
- Check our [BACKLOG.md](./BACKLOG.md) for security-related items

## Security Best Practices

When deploying Sellf:

1. **Environment Variables**: Never commit secrets to version control
2. **Database**: Use strong passwords and restrict network access
3. **API Keys**: Rotate keys regularly and use minimal scopes
4. **Updates**: Keep dependencies up to date
5. **HTTPS**: Always use HTTPS in production
6. **Backups**: Maintain regular database backups
7. **Monitoring**: Set up logging and alerting

## Past Security Issues

All identified security vulnerabilities have been addressed. For the security posture of the current version, see our test suite (981+ tests with 100% pass rate).

## Scope

This security policy applies to:
- Sellf Admin Panel (`admin-panel/`)
- MCP Server (`mcp-server/`)
- Database migrations (`supabase/migrations/`)
- Gatekeeper SDK (`gatekeeper.js`)

---

**Last Updated**: 2026-02-13
