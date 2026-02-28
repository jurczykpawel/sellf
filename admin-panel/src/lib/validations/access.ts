/**
 * Access validation utilities with strict security checks
 * SECURITY: All input data MUST be validated before database operations
 * No external dependencies - pure TypeScript validation
 */

// Validation result type
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

// Access input types
export interface GrantAccessInput {
  product_id: string;
  access_duration_days?: number;
  access_expires_at?: string;
}

export interface UserActionInput {
  userId: string;
  productId: string;
  action: 'grant' | 'revoke';
}

export interface AccessCheckInput {
  productSlug?: string;
  productSlugs?: string[];
}

// Validation functions
function validateUUID(uuid: string): ValidationResult {
  const errors: string[] = [];
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  
  if (!uuid || typeof uuid !== 'string') {
    errors.push('UUID is required');
  } else if (!uuidRegex.test(uuid)) {
    errors.push('Invalid UUID format');
  }
  
  return { isValid: errors.length === 0, errors };
}

function validateSlug(slug: string): ValidationResult {
  const errors: string[] = [];
  
  if (!slug || typeof slug !== 'string') {
    errors.push('Slug is required');
  } else {
    const trimmedSlug = slug.trim();
    
    if (trimmedSlug.length === 0) {
      errors.push('Slug cannot be empty');
    } else if (trimmedSlug.length > 100) {
      errors.push('Slug must be less than 100 characters');
    } else if (!/^[a-z0-9-]+$/.test(trimmedSlug)) {
      errors.push('Slug can only contain lowercase letters, numbers, and hyphens');
    } else if (trimmedSlug.startsWith('-') || trimmedSlug.endsWith('-')) {
      errors.push('Slug cannot start or end with hyphens');
    } else if (trimmedSlug.includes('--')) {
      errors.push('Slug cannot contain consecutive hyphens');
    }
  }
  
  return { isValid: errors.length === 0, errors };
}

function validateDate(date: string): ValidationResult {
  const errors: string[] = [];
  
  if (!date || typeof date !== 'string') {
    errors.push('Date is required');
  } else if (isNaN(Date.parse(date))) {
    errors.push('Invalid date format');
  } else {
    const parsedDate = new Date(date);
    const now = new Date();
    const maxFutureDate = new Date(now.getFullYear() + 10, now.getMonth(), now.getDate());
    
    if (parsedDate <= now) {
      errors.push('Date must be in the future');
    } else if (parsedDate > maxFutureDate) {
      errors.push('Date cannot be more than 10 years in the future');
    }
  }
  
  return { isValid: errors.length === 0, errors };
}

function validateDuration(duration: number): ValidationResult {
  const errors: string[] = [];
  
  if (typeof duration !== 'number') {
    errors.push('Duration must be a number');
  } else if (!Number.isInteger(duration)) {
    errors.push('Duration must be an integer');
  } else if (duration < 1) {
    errors.push('Duration must be at least 1 day');
  } else if (duration > 3650) {
    errors.push('Duration cannot exceed 10 years');
  }
  
  return { isValid: errors.length === 0, errors };
}

function validateAction(action: string): ValidationResult {
  const errors: string[] = [];
  const validActions = ['grant', 'revoke'];
  
  if (!action || typeof action !== 'string') {
    errors.push('Action is required');
  } else if (!validActions.includes(action)) {
    errors.push('Action must be either "grant" or "revoke"');
  }
  
  return { isValid: errors.length === 0, errors };
}

// Main validation functions
export function validateGrantAccess(data: unknown): ValidationResult {
  const errors: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const input = data as any;
  
  // Validate required fields
  const productIdResult = validateUUID(input.product_id);
  errors.push(...productIdResult.errors);
  
  // Validate optional fields ONLY if they are provided
  if (input.access_duration_days !== undefined && input.access_duration_days !== null) {
    const durationResult = validateDuration(input.access_duration_days);
    errors.push(...durationResult.errors);
  }
  
  if (input.access_expires_at !== undefined && input.access_expires_at !== null && input.access_expires_at !== '') {
    const dateResult = validateDate(input.access_expires_at);
    errors.push(...dateResult.errors);
  }
  
  // Note: Either duration or expiration can be provided, but both are optional
  // If neither is provided, access will be permanent (handled by database logic)
  
  return { isValid: errors.length === 0, errors };
}

export function validateUserAction(data: unknown): ValidationResult {
  const errors: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const input = data as any;
  
  // Validate required fields
  const userIdResult = validateUUID(input.userId);
  const productIdResult = validateUUID(input.productId);
  const actionResult = validateAction(input.action);
  
  errors.push(...userIdResult.errors, ...productIdResult.errors, ...actionResult.errors);
  
  return { isValid: errors.length === 0, errors };
}

export function validateAccessCheck(data: unknown): ValidationResult {
  const errors: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const input = data as any;
  
  // Validate that either productSlug or productSlugs is provided
  if (!input.productSlug && !input.productSlugs) {
    errors.push('Either productSlug or productSlugs must be provided');
  }
  
  // Validate productSlug if provided
  if (input.productSlug) {
    const slugResult = validateSlug(input.productSlug);
    errors.push(...slugResult.errors);
  }
  
  // Validate productSlugs if provided
  if (input.productSlugs) {
    if (!Array.isArray(input.productSlugs)) {
      errors.push('productSlugs must be an array');
    } else if (input.productSlugs.length === 0) {
      errors.push('productSlugs cannot be empty');
    } else if (input.productSlugs.length > 50) {
      errors.push('productSlugs cannot contain more than 50 items');
    } else {
      // Validate each slug in the array
      input.productSlugs.forEach((slug: unknown, index: number) => {
        const slugResult = validateSlug(slug as string);
        if (!slugResult.isValid) {
          errors.push(`productSlugs[${index}]: ${slugResult.errors.join(', ')}`);
        }
      });
    }
  }
  
  return { isValid: errors.length === 0, errors };
}

// Data sanitization functions
export function sanitizeGrantAccessData(data: Record<string, unknown>): Record<string, unknown> {
  const sanitizedData = { ...data };
  
  // Remove dangerous fields
  delete sanitizedData.id;
  delete sanitizedData.user_id;
  delete sanitizedData.created_at;
  delete sanitizedData.updated_at;
  
  // Sanitize product_id
  if (sanitizedData.product_id && typeof sanitizedData.product_id === 'string') {
    sanitizedData.product_id = sanitizedData.product_id.trim().toLowerCase();
  }
  
  // Convert empty strings to null
  if (sanitizedData.access_expires_at === '') {
    sanitizedData.access_expires_at = null;
  }
  
  return sanitizedData;
}

export function sanitizeUserActionData(data: Record<string, unknown>): Record<string, unknown> {
  const sanitizedData = { ...data };
  
  // Sanitize UUIDs
  if (sanitizedData.userId && typeof sanitizedData.userId === 'string') {
    sanitizedData.userId = sanitizedData.userId.trim().toLowerCase();
  }
  
  if (sanitizedData.productId && typeof sanitizedData.productId === 'string') {
    sanitizedData.productId = sanitizedData.productId.trim().toLowerCase();
  }
  
  // Sanitize action
  if (sanitizedData.action && typeof sanitizedData.action === 'string') {
    sanitizedData.action = sanitizedData.action.trim().toLowerCase();
  }
  
  return sanitizedData;
}

export function sanitizeAccessCheckData(data: Record<string, unknown>): Record<string, unknown> {
  const sanitizedData = { ...data };
  
  // Sanitize productSlug
  if (sanitizedData.productSlug && typeof sanitizedData.productSlug === 'string') {
    sanitizedData.productSlug = sanitizedData.productSlug.trim().toLowerCase();
  }
  
  // Sanitize productSlugs array
  if (sanitizedData.productSlugs && Array.isArray(sanitizedData.productSlugs)) {
    sanitizedData.productSlugs = sanitizedData.productSlugs
      .filter(slug => slug && typeof slug === 'string')
      .map(slug => (slug as string).trim().toLowerCase());
  }
  
  return sanitizedData;
}
