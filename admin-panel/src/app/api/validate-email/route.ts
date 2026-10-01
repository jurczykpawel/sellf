import { NextRequest, NextResponse } from 'next/server';
import { DisposableEmailService } from '@/lib/services/disposable-email';
import { checkRateLimit, checkRateLimitForIdentifier } from '@/lib/rate-limiting';
import { canonicalizeEmailForBucket } from '@/lib/security/email-canonical';
import { isValidEmailFormat } from '@/lib/validations/email-format';
import { readJsonBody, ApiPayloadTooLargeError } from '@/lib/api/body-limit';

/**
 * Email Validation API Endpoint
 *
 * Validates email addresses and checks for disposable domains
 * using server-side caching for optimal performance.
 *
 * @route POST /api/validate-email
 */

// Response type definition
interface EmailValidationResponse {
  success: boolean;
  data?: {
    isValid: boolean;
    isDisposable: boolean;
    domain: string;
    error?: string;
  };
  error?: {
    message: string;
    code: string;
  };
  meta: {
    timestamp: string;
    processingTime: number;
    domainsLoaded: number;
  };
}

export async function POST(request: NextRequest): Promise<NextResponse<EmailValidationResponse>> {
  const startTime = Date.now();
  
  try {
    // Rate limiting: 30 requests per minute per IP
    const rateLimitOk = await checkRateLimit('validate_email', 30, 1);
    if (!rateLimitOk) {
      return NextResponse.json({
        success: false,
        error: {
          message: 'Rate limit exceeded. Please try again later.',
          code: 'RATE_LIMIT_EXCEEDED'
        },
        meta: {
          timestamp: new Date().toISOString(),
          processingTime: Date.now() - startTime,
          domainsLoaded: 0
        }
      }, { status: 429 });
    }

    // Parse and validate request body
    let body: any = null;
    try {
      body = await readJsonBody(request);
    } catch (err) {
      if (err instanceof ApiPayloadTooLargeError) {
        return NextResponse.json({
          success: false,
          error: {
            message: 'Request body too large',
            code: 'PAYLOAD_TOO_LARGE'
          },
          meta: {
            timestamp: new Date().toISOString(),
            processingTime: Date.now() - startTime,
            domainsLoaded: 0
          }
        }, { status: 413 });
      }
      body = null;
    }

    if (!body) {
      return NextResponse.json({
        success: false,
        error: {
          message: 'Invalid JSON body',
          code: 'INVALID_JSON'
        },
        meta: {
          timestamp: new Date().toISOString(),
          processingTime: Date.now() - startTime,
          domainsLoaded: 0
        }
      }, { status: 400 });
    }

    // Validate email field
    const { email, allowDisposable = false } = body;
    
    if (!email || typeof email !== 'string') {
      return NextResponse.json({
        success: false,
        error: {
          message: 'Email is required and must be a string',
          code: 'VALIDATION_ERROR'
        },
        meta: {
          timestamp: new Date().toISOString(),
          processingTime: Date.now() - startTime,
          domainsLoaded: 0
        }
      }, { status: 400 });
    }

    if (!isValidEmailFormat(email)) {
      return NextResponse.json({
        success: false,
        error: {
          message: 'Invalid email format',
          code: 'VALIDATION_ERROR'
        },
        meta: {
          timestamp: new Date().toISOString(),
          processingTime: Date.now() - startTime,
          domainsLoaded: 0
        }
      }, { status: 400 });
    }

    // Per-email rate limit prevents enumeration: even with rotating
    // IPs/fingerprints, a single mailbox can only be probed a few
    // times per hour. The bucket key is canonicalized so that
    // dot/plus-tag variants of the same mailbox share one bucket.
    const normalizedEmail = email.trim().toLowerCase();
    const bucketKey = canonicalizeEmailForBucket(email);
    const perEmailOk = await checkRateLimitForIdentifier(
      'validate_email_per_address',
      5,
      60,
      `email:${bucketKey}`,
    );
    if (!perEmailOk) {
      return NextResponse.json({
        success: false,
        error: {
          message: 'Rate limit exceeded. Please try again later.',
          code: 'RATE_LIMIT_EXCEEDED'
        },
        meta: {
          timestamp: new Date().toISOString(),
          processingTime: Date.now() - startTime,
          domainsLoaded: 0
        }
      }, { status: 429 });
    }

    // Extract domain for response
    const domain = normalizedEmail.split('@')[1];

    // Validate email using the disposable email service
    const result = await DisposableEmailService.validateEmail(email, allowDisposable);
    
    const response: EmailValidationResponse = {
      success: true,
      data: {
        isValid: result.isValid,
        isDisposable: result.isDisposable,
        domain,
        ...(result.error && { error: result.error })
      },
      meta: {
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime,
        domainsLoaded: DisposableEmailService.getDomainCount()
      }
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Email validation API error:', error);
    
    return NextResponse.json({
      success: false,
      error: {
        message: 'Internal server error',
        code: 'INTERNAL_ERROR'
      },
      meta: {
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime,
        domainsLoaded: 0
      }
    }, { status: 500 });
  }
}

/**
 * Handle unsupported HTTP methods
 */
export async function GET() {
  return NextResponse.json({
    success: false,
    error: {
      message: 'Method not allowed. Use POST instead.',
      code: 'METHOD_NOT_ALLOWED'
    },
    meta: {
      timestamp: new Date().toISOString(),
      processingTime: 0,
      domainsLoaded: 0
    }
  }, { status: 405 });
}
