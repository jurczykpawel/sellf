/**
 * Strip control characters and newlines from user-supplied values before logging.
 * Prevents log injection / log forging attacks via crafted emails, headers, etc.
 */
export function sanitizeForLog(value: string): string {
  return value.replace(/[\x00-\x1f\x7f]/g, '');
}

/**
 * Redact a buyer email for logs: keep the first local-part character + the domain, mask the
 * rest. Reduces PII exposure in retained/shipped logs (OWASP A09) while keeping enough for
 * support correlation — the session / payment-intent id is logged alongside and joins back to
 * the full email in the DB. Output is also control-char stripped (log-injection safe).
 * `john@example.com` → `j***@example.com`; empty / non-email → `***`.
 */
export function redactEmail(email: string | null | undefined): string {
  if (!email) return '***';
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return sanitizeForLog(`${email[0]}***${email.slice(at)}`);
}

// Type for log data
type LogData = Record<string, unknown> | string | number | boolean | null | undefined;

// Format log entry as structured JSON
const formatLogEntry = (level: string, message: string, data?: LogData) => {
  return {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(data !== undefined && { data }),
  };
};

export const logger = {
  info: (message: string, data?: LogData) => {
    console.log(JSON.stringify(formatLogEntry('INFO', message, data)));
  },

  error: (message: string, data?: LogData) => {
    console.error(JSON.stringify(formatLogEntry('ERROR', message, data)));
  },

  warn: (message: string, data?: LogData) => {
    console.warn(JSON.stringify(formatLogEntry('WARN', message, data)));
  },

  debug: (message: string, data?: LogData) => {
    if (process.env.NODE_ENV === 'development') {
      console.debug(JSON.stringify(formatLogEntry('DEBUG', message, data)));
    }
  },

  security: (message: string, data?: LogData) => {
    console.error(JSON.stringify(formatLogEntry('SECURITY', message, data)));
  }
};
