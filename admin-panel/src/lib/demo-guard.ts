/**
 * Demo Mode Guard
 *
 * When DEMO_MODE=true, blocks destructive admin actions while keeping
 * checkout and read-only operations working.
 *
 * Usage in API routes:
 *   if (isDemoMode()) return NextResponse.json(DEMO_MODE_API_ERROR, { status: 403 })
 *
 * Usage in server actions:
 *   Throw-pattern:  if (isDemoMode()) throw new Error(DEMO_MODE_ERROR)
 *   Return-pattern: if (isDemoMode()) return { success: false, error: DEMO_MODE_ERROR, errorCode: 'DEMO_MODE' }
 */

export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === 'true'
}

export const DEMO_MODE_ERROR = 'This action is disabled in demo mode'

/** JSON body (HTTP 403) returned by API routes when a mutation is disabled in demo mode */
export const DEMO_MODE_API_ERROR = { error: { code: 'DEMO_MODE', message: DEMO_MODE_ERROR } } as const

/** Check if an error was thrown by the demo guard */
export function isDemoError(error: unknown): boolean {
  return error instanceof Error && error.message === DEMO_MODE_ERROR
}

/** Get user-friendly error message, with demo-aware fallback */
export function getErrorMessage(error: unknown, fallback = 'An error occurred'): string {
  if (error instanceof Error && error.message === DEMO_MODE_ERROR) {
    return DEMO_MODE_ERROR
  }
  return fallback
}
