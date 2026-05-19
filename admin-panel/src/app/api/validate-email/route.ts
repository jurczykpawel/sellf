import { NextRequest, NextResponse } from 'next/server';
import { DisposableEmailService } from '@/lib/services/disposable-email';
import { checkRateLimit, checkRateLimitForIdentifier } from '@/lib/rate-limiting';

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

function validateEmailFormat(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
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
    const body = await request.json().catch(() => null);
    
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

    if (!validateEmailFormat(email)) {
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
    // IPs/fingerprints, a single address can only be probed a few
    // times per hour.
    const normalizedEmail = email.trim().toLowerCase();
    const perEmailOk = await checkRateLimitForIdentifier(
      'validate_email_per_address',
      5,
      60,
      `email:${normalizedEmail}`,
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
