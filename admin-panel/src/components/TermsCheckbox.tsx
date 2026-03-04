'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
type TermsCheckboxVariant = 'default' | 'prominent' | 'hidden';

interface TermsCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  required?: boolean;
  className?: string;
  termsUrl?: string;
  privacyUrl?: string;
  variant?: TermsCheckboxVariant;
}

export default function TermsCheckbox({
  checked,
  onChange,
  required = true,
  className = '',
  termsUrl = '/terms',
  privacyUrl = '/privacy',
  variant = 'default',
}: TermsCheckboxProps) {
  const [isFocused, setIsFocused] = useState(false)
  const t = useTranslations('compliance')

  if (variant === 'hidden') {
    return null;
  }

  if (variant === 'prominent') {
    return (
      <div className={`bg-sf-warning-soft border-2 border-sf-warning/30 rounded-xl p-6 ${className}`}>
        <div className="flex items-start space-x-4">
          <div className="flex-shrink-0 mt-1">
            <input
              id="terms-checkbox"
              type="checkbox"
              checked={checked}
              onChange={(e) => onChange(e.target.checked)}
              required={required}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              className={`w-5 h-5 text-sf-accent bg-transparent border-2 border-sf-warning/50 rounded focus:ring-sf-accent focus:ring-2 focus:ring-offset-2 transition-all ${
                isFocused ? 'ring-2 ring-sf-accent' : ''
              }`}
              aria-describedby="terms-checkbox-description"
            />
          </div>
          <div className="flex-1">
            <label htmlFor="terms-checkbox" className="block cursor-pointer">
              <div className="text-sf-warning font-semibold text-lg mb-2">
                ⚠️ {t('termsRequired')}
              </div>
              <div className="text-sf-body text-sm leading-relaxed" id="terms-checkbox-description">
                {t('iAgreeWith')}{' '}
                <Link
                  href={termsUrl}
                  className="text-sf-accent hover:text-sf-accent-hover underline font-medium transition-colors"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t('termsOfService')}
                </Link>
                {' '}{t('and')}{' '}
                <Link
                  href={privacyUrl}
                  className="text-sf-accent hover:text-sf-accent-hover underline font-medium transition-colors"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t('privacyPolicy')}
                </Link>
                {required && <span className="text-sf-danger ml-1">*</span>}
              </div>
            </label>
          </div>
        </div>
      </div>
    );
  }

  // Default variant
  return (
    <div className={className}>
      <label htmlFor="terms-checkbox" className="flex items-center cursor-pointer group">
        {/* Custom Checkbox */}
        <div className="relative flex-shrink-0 mr-1">
          <input
            id="terms-checkbox"
            type="checkbox"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            required={required}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            className="sr-only"
            aria-describedby="terms-checkbox-description"
          />
          <div
            className={`w-5 h-5 border-2 rounded transition-all duration-200 flex items-center justify-center ${
              checked
                ? 'bg-sf-accent-bg border-sf-accent shadow-lg shadow-sf-accent-glow'
                : 'bg-transparent border-sf-accent/60 hover:border-sf-accent group-hover:bg-sf-accent-soft group-hover:border-sf-accent'
            } ${
              isFocused ? 'ring-2 ring-sf-accent/50 ring-offset-1' : ''
            }`}
          >
            {checked && (
              <svg
                className="w-3 h-3 text-sf-inverse font-bold"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
            )}
          </div>
        </div>

        <span className="text-sf-body text-sm leading-relaxed flex-1 group-hover:text-sf-heading transition-colors" id="terms-checkbox-description">
          {t('iAgreeWith')}{' '}
          <Link
            href={termsUrl}
            className="text-sf-accent hover:text-sf-accent-hover underline font-medium transition-colors"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('termsOfService')}
          </Link>
          {' '}{t('and')}{' '}
          <Link
            href={privacyUrl}
            className="text-sf-accent hover:text-sf-accent-hover underline font-medium transition-colors"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('privacyPolicy')}
          </Link>
          {required && <span className="text-sf-danger ml-1">*</span>}
        </span>
      </label>
    </div>
  );
}
