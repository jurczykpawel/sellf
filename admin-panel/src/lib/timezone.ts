/**
 * Timezone utility functions
 * Handles conversion between local time and UTC for database storage
 */

/**
 * Convert local datetime-local string to UTC ISO string for database storage
 * @param localDatetimeString - String in format "YYYY-MM-DDTHH:MM" (from datetime-local input)
 * @returns ISO string in UTC or empty string if invalid
 */
export function convertLocalToUTC(localDatetimeString: string): string {
  if (!localDatetimeString) return '';
  
  try {
    // Create date treating the input as local time
    const localDate = new Date(localDatetimeString);
    
    // Check if date is valid
    if (isNaN(localDate.getTime())) {
      return '';
    }
    
    // Return as UTC ISO string
    return localDate.toISOString();
  } catch {
    return '';
  }
}

/**
 * Convert UTC ISO string from database to local datetime-local string for input
 * @param utcIsoString - ISO string in UTC from database
 * @returns String in format "YYYY-MM-DDTHH:MM" for datetime-local input
 */
export function convertUTCToLocal(utcIsoString: string): string {
  if (!utcIsoString) return '';
  
  try {
    const utcDate = new Date(utcIsoString);
    
    // Check if date is valid
    if (isNaN(utcDate.getTime())) {
      return '';
    }
    
    // Get local timezone offset
    const timezoneOffset = utcDate.getTimezoneOffset() * 60000;
    
    // Create local date by adjusting for timezone
    const localDate = new Date(utcDate.getTime() - timezoneOffset);
    
    // Return in datetime-local format
    return localDate.toISOString().slice(0, 16);
  } catch {
    return '';
  }
}

/**
 * Format UTC timestamp for display in user's local timezone
 * @param utcIsoString - ISO string in UTC from database
 * @param options - Intl.DateTimeFormatOptions
 * @returns Formatted string in user's local timezone
 */
export function formatUTCForDisplay(
  utcIsoString: string,
  options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  },
  locale?: string
): string {
  if (!utcIsoString) return '';
  
  try {
    const utcDate = new Date(utcIsoString);
    
    // Check if date is valid
    if (isNaN(utcDate.getTime())) {
      return '';
    }
    
    // Format in user's local timezone
    return utcDate.toLocaleString(locale, options);
  } catch {
    return '';
  }
}

/**
 * Get current user's timezone
 * @returns Timezone string (e.g., "Europe/Warsaw")
 */
export function getUserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

/**
 * Check if a date is in the future (in user's local timezone)
 * @param utcIsoString - ISO string in UTC from database
 * @returns Boolean indicating if date is in the future
 */
export function isDateInFuture(utcIsoString: string): boolean {
  if (!utcIsoString) return false;
  
  try {
    const utcDate = new Date(utcIsoString);
    const now = new Date();
    
    return utcDate > now;
  } catch {
    return false;
  }
}

/**
 * Check if current time is within availability window
 * @param availableFrom - UTC ISO string or null
 * @param availableUntil - UTC ISO string or null
 * @returns Boolean indicating if currently available
 */
export function isCurrentlyAvailable(
  availableFrom: string | null,
  availableUntil: string | null
): boolean {
  const now = new Date();
  
  try {
    // Check if available from constraint is satisfied
    if (availableFrom) {
      const fromDate = new Date(availableFrom);
      if (isNaN(fromDate.getTime()) || fromDate > now) {
        return false;
      }
    }
    
    // Check if available until constraint is satisfied
    if (availableUntil) {
      const untilDate = new Date(availableUntil);
      if (isNaN(untilDate.getTime()) || untilDate <= now) {
        return false;
      }
    }
    
    return true;
  } catch {
    return false;
  }
}

/**
 * Add timezone info to display text
 * @param baseText - Base text to enhance
 * @returns Text with timezone information
 */
export function addTimezoneInfo(baseText: string): string {
  const timezone = getUserTimezone();
  return `${baseText} (${timezone})`;
}

export function formatAdminDate(
  value: string | null | undefined,
  locale: string,
  includeTime = true,
  emptyLabel = '—',
): string {
  return formatUTCForDisplay(value ?? '', {
    year: 'numeric', month: 'short', day: 'numeric',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit', hour12: false } as const : {}),
  }, locale) || emptyLabel;
}
