import { useState, useCallback } from 'react';

/**
 * Shared captcha state hook — replaces copy-pasted captcha state
 * in LoginForm, WaitlistForm, FreeProductForm, PaidProductForm.
 *
 * Manages: token, loading state, reset trigger.
 * Provider-agnostic — works with both Turnstile and ALTCHA.
 *
 * Usage:
 * ```tsx
 * const captcha = useCaptcha();
 * // In JSX:
 * <CaptchaWidget
 *   onVerify={captcha.onVerify}
 *   onError={captcha.onError}
 *   onTimeout={captcha.onTimeout}
 *   resetTrigger={captcha.resetTrigger}
 * />
 * // In submit handler:
 * if (!captcha.token) return;
 * // After error:
 * captcha.reset();
 * ```
 */
export interface UseCaptchaReturn {
  /** Current verified token/payload (null until verified) */
  token: string | null;
  /** True while widget is loading/resetting (use to disable submit buttons) */
  isLoading: boolean;
  /** Increment to trigger widget reset */
  resetTrigger: number;
  /** Call to reset captcha (clears token, triggers widget reset) */
  reset: () => void;
  /** Pass to CaptchaWidget onVerify */
  onVerify: (token: string) => void;
  /** Pass to CaptchaWidget onError */
  onError: () => void;
  /** Pass to CaptchaWidget onTimeout */
  onTimeout: () => void;
}

export function useCaptcha(): UseCaptchaReturn {
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [resetTrigger, setResetTrigger] = useState(0);

  const reset = useCallback(() => {
    setToken(null);
    setIsLoading(true);
    setResetTrigger(prev => prev + 1);
  }, []);

  const onVerify = useCallback((t: string) => {
    setToken(t);
    setIsLoading(false);
  }, []);

  const onError = useCallback(() => {
    setToken(null);
    setIsLoading(false);
  }, []);

  const onTimeout = useCallback(() => {
    setIsLoading(false);
  }, []);

  return {
    token,
    isLoading,
    resetTrigger,
    reset,
    onVerify,
    onError,
    onTimeout,
  };
}
