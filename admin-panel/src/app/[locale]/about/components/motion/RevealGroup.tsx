'use client';

import { useEffect, useRef, Children, type ReactNode, type CSSProperties } from 'react';
import { observeReveal, unobserveReveal } from './reveal-observer';

type RevealAnimation = 'fade-up' | 'fade-down' | 'fade-left' | 'fade-right' | 'scale';

interface RevealGroupProps {
  children: ReactNode;
  className?: string;
  animation?: RevealAnimation;
  stagger?: number;
}

export function RevealGroup({
  children,
  className = '',
  animation = 'fade-up',
  stagger = 80,
}: RevealGroupProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    observeReveal(container);
    return () => unobserveReveal(container);
  }, []);

  return (
    <div ref={containerRef} className={`reveal-group reveal-group-${animation} ${className}`}>
      {Children.map(children, (child, i) => (
        <div
          className="reveal-group-item"
          style={{ '--stagger-index': i, '--stagger-delay': `${stagger}ms` } as CSSProperties}
        >
          {child}
        </div>
      ))}
    </div>
  );
}
