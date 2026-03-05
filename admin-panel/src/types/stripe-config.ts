/**
 * TypeScript types for Stripe Restricted API Keys (RAK) configuration
 */

/**
 * Stripe operating mode
 */
export type StripeMode = 'test' | 'live';

/**
 * Valid Stripe API key prefixes
 */
export type StripeKeyPrefix = 'rk_test_' | 'rk_live_' | 'sk_test_' | 'sk_live_';

/**
 * Database row from stripe_configurations table
 */
export interface StripeConfiguration {
  id: string;
  mode: StripeMode;

  // Encrypted storage
  encrypted_key: string;
  encryption_iv: string;
  encryption_tag: string;

  // Metadata
  key_last_4: string;
  key_prefix: StripeKeyPrefix;

  // Validation status
  permissions_verified: boolean;
  last_validated_at: string | null;
  account_id: string | null;

  // Rotation management
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  rotation_reminder_sent: boolean;

  // Webhook registration
  webhook_endpoint_id: string | null;
  webhook_signing_secret_enc: string | null;
  webhook_signing_iv: string | null;
  webhook_signing_tag: string | null;

  // Status
  is_active: boolean;
}

export type WebhookRegistrationStatus = 'registered' | 'not_registered';

export interface WebhookRegistrationInfo {
  status: WebhookRegistrationStatus;
  endpointId: string | null;
}

export type RegisterWebhookResponse = ActionResponse<WebhookRegistrationInfo>;

/**
 * Input for creating a new Stripe configuration
 */
export interface CreateStripeConfigInput {
  mode: StripeMode;
  apiKey: string; // Plain text key (will be encrypted before storage)
}

/**
 * Input for updating Stripe configuration (e.g., key rotation)
 */
export interface UpdateStripeConfigInput {
  id: string;
  apiKey: string; // New plain text key
}

/**
 * Result of API key format validation
 */
export interface KeyFormatValidationResult {
  isValid: boolean;
  errors: string[];
  detectedMode?: StripeMode;
  detectedPrefix?: StripeKeyPrefix;
}

/**
 * Result of API connection test
 */
export interface ConnectionTestResult {
  success: boolean;
  accountId?: string;
  accountName?: string;
  error?: string;
  errorCode?: string;
}

/**
 * Individual Stripe API permission status
 */
export interface PermissionStatus {
  resource: string; // e.g., "charges", "customers", "checkout.sessions"
  operation: 'read' | 'write';
  required: boolean;
  verified: boolean;
  errorMessage?: string;
}

/**
 * Result of permission verification
 */
export interface PermissionVerificationResult {
  allGranted: boolean;
  permissions: PermissionStatus[];
  missingPermissions: PermissionStatus[];
}

/**
 * Complete validation result (format + connection + permissions)
 */
export interface ValidationResult {
  isValid: boolean;
  formatValidation: KeyFormatValidationResult;
  connectionTest?: ConnectionTestResult;
  permissionVerification?: PermissionVerificationResult;
}

/**
 * Wizard step identifier
 */
export type WizardStep = 1 | 2 | 3 | 4 | 5;

/**
 * Wizard state for multi-step configuration flow
 */
export interface WizardState {
  currentStep: WizardStep;
  mode: StripeMode | null;
  apiKey: string;
  validationStatus: 'idle' | 'validating' | 'success' | 'error';
  validationResult: ValidationResult | null;
  isDirty: boolean;
}

/**
 * Required permissions for Sellf Stripe integration
 */
export const REQUIRED_PERMISSIONS: readonly PermissionStatus[] = [
  {
    resource: 'charges',
    operation: 'write',
    required: true,
    verified: false,
  },
  {
    resource: 'customers',
    operation: 'write',
    required: true,
    verified: false,
  },
  {
    resource: 'checkout.sessions',
    operation: 'write',
    required: true,
    verified: false,
  },
  {
    resource: 'payment_intents',
    operation: 'read',
    required: true,
    verified: false,
  },
  {
    resource: 'webhooks',
    operation: 'read',
    required: true,
    verified: false,
  },
  {
    resource: 'products',
    operation: 'read',
    required: false,
    verified: false,
  },
  {
    resource: 'prices',
    operation: 'read',
    required: false,
    verified: false,
  },
] as const;

/**
 * Configuration display info (safe to show in UI)
 */
export interface StripeConfigDisplay {
  id: string;
  mode: StripeMode;
  keyPrefix: StripeKeyPrefix;
  keyLast4: string;
  maskedKey: string; // e.g., "rk_live_****ABC"
  accountId: string | null;
  isActive: boolean;
  createdAt: string;
  expiresAt: string | null;
  daysUntilExpiration: number | null;
  needsRotation: boolean;
  permissionsVerified: boolean;
  lastValidatedAt: string | null;
}

/**
 * Server action response wrapper
 */
export interface ActionResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  errorCode?: string;
}

/**
 * Response for getting active configuration
 */
export type GetActiveConfigResponse = ActionResponse<StripeConfiguration | null>;

/**
 * Response for saving configuration
 */
export type SaveConfigResponse = ActionResponse<{
  id: string;
  mode: StripeMode;
}>;

/**
 * Response for deleting configuration
 */
export type DeleteConfigResponse = ActionResponse<void>;

/**
 * Response for validating key
 */
export type ValidateKeyResponse = ActionResponse<ValidationResult>;

/**
 * Response for testing connection
 */
export type TestConnectionResponse = ActionResponse<ConnectionTestResult>;

/**
 * Response for verifying permissions
 */
export type VerifyPermissionsResponse = ActionResponse<PermissionVerificationResult>;
