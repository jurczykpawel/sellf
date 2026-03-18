/**
 * Strip control characters and newlines from user-supplied values before logging.
 * Prevents log injection / log forging attacks via crafted emails, headers, etc.
 */
export function sanitizeForLog(value: string): string {
  return value.replace(/[\x00-\x1f\x7f]/g, '');
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
