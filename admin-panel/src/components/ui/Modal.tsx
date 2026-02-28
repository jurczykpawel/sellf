'use client';

import React, { useState } from 'react';
import BaseModal from './BaseModal';

interface ModalHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  badge?: {
    text: string;
    variant: 'success' | 'warning' | 'error' | 'info' | 'neutral';
  };
}

interface ModalFooterProps {
  children: React.ReactNode;
  className?: string;
}

interface ModalBodyProps {
  children: React.ReactNode;
  className?: string;
  noPadding?: boolean;
}

interface ModalSectionProps {
  title?: string;
  children: React.ReactNode;
  className?: string;
  collapsible?: boolean;
  defaultExpanded?: boolean;
}

// Modal Header Component
export const ModalHeader: React.FC<ModalHeaderProps> = ({ 
  title, 
  subtitle, 
  icon, 
  badge 
}) => {
  const getBadgeClasses = (variant: string) => {
    const baseClasses = 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium';
    
    switch (variant) {
      case 'success':
        return `${baseClasses} bg-gf-success-soft text-gf-success`;
      case 'warning':
        return `${baseClasses} bg-gf-warning-soft text-gf-warning`;
      case 'error':
        return `${baseClasses} bg-gf-danger-soft text-gf-danger`;
      case 'info':
        return `${baseClasses} bg-gf-accent-soft text-gf-accent`;
      default:
        return `${baseClasses} bg-gf-raised text-gf-muted`;
    }
  };

  return (
    <div className="px-6 py-3 border-b border-gf-border bg-gf-raised rounded-t-2xl">
      <div className="flex items-start justify-between">
        <div className="flex items-center space-x-3">
          {icon && (
            <div className="flex-shrink-0 p-1.5 bg-gf-base rounded-lg shadow-sm">
              {icon}
            </div>
          )}
          <div>
            <div className="flex items-center space-x-3">
              <h3 className="text-lg font-semibold text-gf-heading">
                {title}
              </h3>
              {badge && (
                <span className={getBadgeClasses(badge.variant)}>
                  {badge.text}
                </span>
              )}
            </div>
            {subtitle && (
              <p className="mt-1 text-sm text-gf-muted">
                {subtitle}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// Modal Body Component
export const ModalBody: React.FC<ModalBodyProps> = ({ 
  children, 
  className = '', 
  noPadding = false 
}) => {
  return (
    <div className={`
      ${noPadding ? '' : 'px-6 py-4'} 
      ${className}
    `}>
      {children}
    </div>
  );
};

// Modal Section Component (for organizing content within body)
export const ModalSection: React.FC<ModalSectionProps> = ({
  title,
  children,
  className = '',
  collapsible = false,
  defaultExpanded = true
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <div className={`${className}`}>
      {title && (
        <button
          type="button"
          onClick={() => collapsible && setIsExpanded(!isExpanded)}
          className={`w-full flex items-center justify-between text-sm font-medium text-gf-heading border-b border-gf-border pb-2 mb-4 ${
            collapsible ? 'cursor-pointer hover:text-gf-accent transition-colors' : 'cursor-default'
          }`}
        >
          <span>{title}</span>
          {collapsible && (
            <svg
              className={`w-4 h-4 text-gf-muted transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          )}
        </button>
      )}
      <div
        className={`space-y-4 transition-all duration-200 ${
          collapsible && !isExpanded ? 'hidden' : ''
        }`}
      >
        {children}
      </div>
    </div>
  );
};

// Modal Footer Component
export const ModalFooter: React.FC<ModalFooterProps> = ({ 
  children, 
  className = '' 
}) => {
  return (
    <div className={`
      px-6 py-4 border-t border-gf-border
      bg-gf-raised rounded-b-2xl
      flex items-center justify-end space-x-3
      ${className}
    `}>
      {children}
    </div>
  );
};

// Button variants for consistent styling
interface ButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  type?: 'button' | 'submit' | 'reset';
  form?: string;
  className?: string;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  onClick,
  disabled = false,
  loading = false,
  variant = 'primary',
  size = 'md',
  type = 'button',
  form,
  className = ''
}) => {
  const getVariantClasses = () => {
    switch (variant) {
      case 'primary':
        return 'bg-gf-accent hover:bg-gf-accent-hover text-gf-inverse border-transparent focus:ring-gf-accent';
      case 'secondary':
        return 'bg-gf-raised hover:bg-gf-hover text-gf-heading border-gf-border focus:ring-gf-accent';
      case 'danger':
        return 'bg-gf-danger hover:opacity-90 text-white border-transparent focus:ring-gf-danger';
      case 'ghost':
        return 'bg-transparent hover:bg-gf-hover text-gf-body border-gf-border focus:ring-gf-accent';
      default:
        return 'bg-gf-accent hover:bg-gf-accent-hover text-gf-inverse border-transparent focus:ring-gf-accent';
    }
  };

  const getSizeClasses = () => {
    switch (size) {
      case 'sm':
        return 'px-3 py-1.5 text-xs';
      case 'md':
        return 'px-4 py-2 text-sm';
      case 'lg':
        return 'px-6 py-3 text-base';
      default:
        return 'px-4 py-2 text-sm';
    }
  };

  return (
    <button
      type={type}
      form={form}
      onClick={onClick}
      disabled={disabled || loading}
      className={`
        inline-flex items-center justify-center
        border font-medium rounded-lg
        transition-colors duration-200
        focus:outline-none focus:ring-2 focus:ring-offset-2
        disabled:opacity-50 disabled:cursor-not-allowed
        ${getVariantClasses()}
        ${getSizeClasses()}
        ${className}
      `}
    >
      {loading && (
        <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      )}
      {children}
    </button>
  );
};

// Error/Success Message Component
interface MessageProps {
  type: 'error' | 'success' | 'warning' | 'info';
  title?: string;
  message: string;
  className?: string;
}

export const Message: React.FC<MessageProps> = ({ 
  type, 
  title, 
  message, 
  className = '' 
}) => {
  const getTypeClasses = () => {
    switch (type) {
      case 'error':
        return 'bg-gf-danger-soft border-gf-danger/20 text-gf-danger';
      case 'success':
        return 'bg-gf-success-soft border-gf-success/20 text-gf-success';
      case 'warning':
        return 'bg-gf-warning-soft border-gf-warning/20 text-gf-warning';
      case 'info':
        return 'bg-gf-accent-soft border-gf-accent/20 text-gf-accent';
      default:
        return 'bg-gf-raised border-gf-border text-gf-body';
    }
  };

  const getIcon = () => {
    switch (type) {
      case 'error':
        return (
          <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
        );
      case 'success':
        return (
          <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
        );
      case 'warning':
        return (
          <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        );
      case 'info':
        return (
          <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
        );
    }
  };

  return (
    <div className={`border rounded-lg p-4 ${getTypeClasses()} ${className}`}>
      <div className="flex">
        <div className="flex-shrink-0">
          {getIcon()}
        </div>
        <div className="ml-3">
          {title && (
            <h3 className="text-sm font-medium">
              {title}
            </h3>
          )}
          <p className={title ? 'mt-1 text-sm' : 'text-sm'}>
            {message}
          </p>
        </div>
      </div>
    </div>
  );
};

// Export the base modal as well
export { BaseModal };
