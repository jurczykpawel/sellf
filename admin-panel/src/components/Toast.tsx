'use client';

import React, { useEffect, useState, useRef } from 'react';
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
  const [phase, setPhase] = useState<'enter' | 'visible' | 'exit'>('enter');
  const [progress, setProgress] = useState(100);
  const toastRef = useRef<HTMLDivElement>(null);

  const persistent = !duration || duration <= 0;

  // Enter animation
  useEffect(() => {
    const raf = requestAnimationFrame(() => setPhase('visible'));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Auto-dismiss timer + progress bar
  useEffect(() => {
    if (persistent || phase === 'exit') return;

    const timer = setTimeout(() => {
      setPhase('exit');
      setTimeout(onClose, 400);
    }, duration);

    const interval = setInterval(() => {
      setProgress((prev) => {
        const step = 100 / (duration / 50);
        return Math.max(0, prev - step);
      });
    }, 50);

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [duration, persistent, phase, onClose]);

  const handleClose = () => {
    setPhase('exit');
    setTimeout(onClose, 400);
  };

  const getToastStyles = () => {
    switch (type) {
      case 'success':
        return {
          bg: 'bg-gf-success-soft',
          border: 'border-gf-success/20',
          text: 'text-gf-success',
          glow: 'shadow-[0_0_20px_-4px] shadow-gf-success/20',
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
          glow: 'shadow-[0_0_20px_-4px] shadow-gf-danger/20',
          icon: (
            <svg className="w-5 h-5 text-gf-danger" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
          ),
          progressBar: 'bg-gf-danger-bg'
        };
      case 'warning':
        return {
          bg: 'bg-gf-warning-soft',
          border: 'border-gf-warning/20',
          text: 'text-gf-warning',
          glow: 'shadow-[0_0_20px_-4px] shadow-gf-warning/20',
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
          glow: 'shadow-[0_0_20px_-4px] shadow-gf-accent/20',
          icon: (
            <svg className="w-5 h-5 text-gf-accent" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          ),
          progressBar: 'bg-gf-accent-bg'
        };
    }
  };

  const styles = getToastStyles();

  const animationClasses = {
    enter: 'translate-x-[120%] opacity-0 scale-95',
    visible: 'translate-x-0 opacity-100 scale-100',
    exit: 'translate-x-[120%] opacity-0 scale-95',
  };

  return (
    <div
      ref={toastRef}
      className={`
        relative flex items-center p-4 border rounded-lg backdrop-blur-sm
        transition-all duration-400 ease-[cubic-bezier(0.16,1,0.3,1)]
        ${animationClasses[phase]}
        ${styles.bg} ${styles.border} ${styles.glow}
      `}
      style={{ minWidth: '320px', maxWidth: '420px' }}
      role="alert"
    >
      <div className="flex-shrink-0">
        {styles.icon}
      </div>
      <div className={`ml-3 mr-6 text-sm font-medium ${styles.text}`}>
        {message}
      </div>
      <button
        onClick={handleClose}
        className="ml-auto flex-shrink-0 p-1.5 rounded-md text-gf-muted hover:text-gf-heading hover:bg-gf-raised/50 transition-colors duration-150"
      >
        <span className="sr-only">{t('close')}</span>
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Progress bar (hidden for persistent toasts) */}
      {!persistent && (
        <div className="absolute bottom-0 left-0 w-full h-0.5 bg-gf-raised/50 rounded-b-lg overflow-hidden">
          <div
            className={`h-full ${styles.progressBar} transition-[width] duration-75 ease-linear`}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
};

export default Toast;
