export type PaymentStatus = 
  | 'processing' 
  | 'completed' 
  | 'failed' 
  | 'expired' 
  | 'guest_purchase' 
  | 'magic_link_sent'
  | 'email_validation_failed';

export interface Product {
  id: string;
  name: string;
  slug: string;
  description: string;
  icon: string;
  price: number;
  currency: string;
}

export interface StatusInfo {
  emoji: string;
  title: string;
  color: string;
  bgColor: string;
}

export interface PaymentStatusViewProps {
  product: Product;
  accessGranted: boolean;
  errorMessage: string;
  paymentStatus: PaymentStatus;
  customerEmail?: string;
  sessionId?: string;
  paymentIntentId?: string;
  redirectUrl?: string;
}

export interface AuthStatus {
  isAuthenticated: boolean | null;
  isChecking: boolean;
}

export interface MagicLinkState {
  sent: boolean;
  sending: boolean;
  showSpinnerForMinTime: boolean;
}

export interface CaptchaState {
  token: string | null;
  error: string | null;
  timeout: boolean;
  showInteractiveWarning: boolean;
}

export interface ValidationState {
  termsAccepted: boolean;
  needsTurnstile: boolean;
  showValidationBlock: boolean;
}

export interface WindowDimensions {
  width: number;
  height: number;
}

export interface StatusInfo {
  emoji: string;
  title: string;
  color: string;
  bgColor: string;
}
