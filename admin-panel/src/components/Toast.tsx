'use client';

import React, { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastProps {
  message: string;
  type: ToastType;
  duration?: number;
  onClose: () => void;
}

const Toast: React.FC<ToastProps> = ({ 
  message, 
  type = 'info', 
  duration = 3000, 
  onClose 
}) => {
  const t = useTranslations('common');
  const [isVisible, setIsVisible] = useState(true);
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    // Start the countdown to close the toast
    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(onClose, 300); // Allow animation to complete before removing
    }, duration);

    // Start the progress bar animation
    const interval = setInterval(() => {
      setProgress((prev) => {
        const newProgress = prev - (100 / (duration / 100));
        return newProgress <= 0 ? 0 : newProgress;
      });
    }, 100);

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [duration, onClose]);

  const getToastStyles = () => {
    switch (type) {
      case 'success':
        return {
          bg: 'bg-gf-success-soft',
          border: 'border-gf-success/20',
          text: 'text-gf-success',
          icon: (
            <svg className="w-5 h-5 text-gf-success" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
          ),
          progressBar: 'bg-gf-success'
        };
      case 'error':
        return {
          bg: 'bg-gf-danger-soft',
          border: 'border-gf-danger/20',
          text: 'text-gf-danger',
          icon: (
            <svg className="w-5 h-5 text-gf-danger" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
          ),
          progressBar: 'bg-gf-danger'
        };
      case 'warning':
        return {
          bg: 'bg-gf-warning-soft',
          border: 'border-gf-warning/20',
          text: 'text-gf-warning',
          icon: (
            <svg className="w-5 h-5 text-gf-warning" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          ),
          progressBar: 'bg-gf-warning'
        };
      default:
        return {
          bg: 'bg-gf-accent-soft',
          border: 'border-gf-accent/20',
          text: 'text-gf-accent',
          icon: (
            <svg className="w-5 h-5 text-gf-accent" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          ),
          progressBar: 'bg-gf-accent'
        };
    }
  };

  const styles = getToastStyles();

  return (
    <div 
      className={`fixed bottom-4 right-4 flex items-center p-4 rounded-lg shadow-lg border z-50 transition-all duration-300 transform ${
        isVisible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
      } ${styles.bg} ${styles.border}`}
      role="alert"
    >
      <div className="flex-shrink-0 mr-3">
        {styles.icon}
      </div>
      <div className={`ml-3 mr-6 ${styles.text}`}>
        {message}
      </div>
      <button
        onClick={() => {
          setIsVisible(false);
          setTimeout(onClose, 300);
        }}
        className="ml-auto -mx-1.5 -my-1.5 rounded-lg focus:ring-2 focus:ring-gray-300 p-1.5 inline-flex h-8 w-8 text-gf-muted hover:text-gf-heading"
      >
        <span className="sr-only">{t('close')}</span>
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      
      {/* Progress bar */}
      <div className="absolute bottom-0 left-0 w-full h-1 bg-gf-raised">
        <div 
          className={`h-full ${styles.progressBar} transition-all duration-100 ease-linear`} 
          style={{ width: `${progress}%` }} 
        />
      </div>
    </div>
  );
};

export default Toast;
