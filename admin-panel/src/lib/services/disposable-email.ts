/**
 * Disposable Email Domain Validation Service
 * 
 * This service provides functionality to detect and block disposable/temporary
 * email addresses commonly used for spam and fake registrations.
 * 
 * Data source: https://github.com/unkn0w/disposable-email-domain-list
 * License: MIT
 */

import { getDisposableEmailConfig } from './disposable-email-config';

export class DisposableEmailService {
  private static domains: Set<string> | null = null;
  private static lastFetch: number = 0;
  private static config = getDisposableEmailConfig();
  private static readonly RAW_URL = 'https://raw.githubusercontent.com/unkn0w/disposable-email-domain-list/main/domains.json';

  /**
   * Initialize the service with disposable domain list
   */
  private static async initialize(): Promise<void> {
    const now = Date.now();
    const config = getDisposableEmailConfig();
    
    // Skip if memory cache is still fresh (configurable TTL)
    if (this.domains && (now - this.lastFetch) < config.cacheDuration) {
      return;
    }

    try {
      // Fetch from the raw GitHub URL
      const response = await fetch(this.RAW_URL, { redirect: 'error' });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch domains: ${response.status}`);
      }
      
      // Direct JSON response from raw URL
      const domains = await response.json();
      this.domains = new Set(domains);
      this.lastFetch = now;
      
    } catch (error) {
      console.error('❌ Failed to load disposable email domains:', error);
      
      // Use a basic fallback list of common disposable domains if everything fails
      if (!this.domains) {
        this.domains = new Set([
          '10minutemail.com',
          'guerrillamail.com',
          'mailinator.com',
          'tempmail.org',
          'temp-mail.org',
          'yopmail.com',
          'throwaway.email',
          'sharklasers.com',
          'getairmail.com',
          'trashmail.com'
        ]);
      }
    }
  }

  /**
   * Check if an email address uses a disposable domain
   * 
   * @param email - The email address to check
   * @returns true if the email uses a disposable domain, false otherwise
   */
  static async isDisposableEmail(email: string): Promise<boolean> {
    // Return false if filtering is disabled
    if (!this.config.enabled) {
      return false;
    }

    // Allow disposable emails in development if configured
    if (process.env.NODE_ENV === 'development' && this.config.allowInDevelopment) {
      return false;
    }

    if (!email || typeof email !== 'string') {
      return false;
    }

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return false;
    }

    // Extract domain from email
    const domain = email.toLowerCase().split('@')[1];
    if (!domain) {
      return false;
    }

    // Check whitelist first
    if (this.config.whitelistedDomains.includes(domain)) {
      return false;
    }

    // Check custom blacklist
    if (this.config.customBlockedDomains.includes(domain)) {
      return true;
    }

    // Initialize domains if needed
    await this.initialize();

    const isDisposable = this.domains!.has(domain);
    return isDisposable;
  }

  /**
   * Validate email address and check for disposable domains
   * 
   * @param email - The email address to validate
   * @param allowDisposable - Whether to allow disposable email addresses (default: false)
   * @returns object with validation result and details
   */
  static async validateEmail(email: string, allowDisposable: boolean = false): Promise<{
    isValid: boolean;
    isDisposable: boolean;
    error?: string;
  }> {
    if (!email || typeof email !== 'string') {
      return {
        isValid: false,
        isDisposable: false,
        error: 'Email is required'
      };
    }

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return {
        isValid: false,
        isDisposable: false,
        error: 'Invalid email format'
      };
    }

    // Check for disposable domain
    const isDisposable = await this.isDisposableEmail(email);
    
    if (isDisposable && !allowDisposable) {
      return {
        isValid: false,
        isDisposable: true,
        error: 'Disposable email addresses are not allowed'
      };
    }

    return {
      isValid: true,
      isDisposable,
    };
  }

  /**
   * Get the number of loaded disposable domains
   * Useful for debugging and monitoring
   */
  static getDomainCount(): number {
    return this.domains?.size || 0;
  }

  /**
   * Clear the domain cache to force refresh on next use
   */
  static clearCache(): void {
    this.domains = null;
    this.lastFetch = 0;
  }

  /**
   * Force refresh domains from GitHub (ignores cache)
   */
  static async forceRefresh(): Promise<void> {
    this.domains = null;
    this.lastFetch = 0;
    await this.initialize();
  }

  /**
   * Check if a specific domain is in the disposable list
   * 
   * @param domain - The domain to check (without @ symbol)
   * @returns true if domain is disposable, false otherwise
   */
  static async isDomainDisposable(domain: string): Promise<boolean> {
    if (!domain || typeof domain !== 'string') {
      return false;
    }

    await this.initialize();
    return this.domains!.has(domain.toLowerCase());
  }
}
