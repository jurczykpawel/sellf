'use client';

import { useEffect, useRef, type ReactNode, type CSSProperties } from 'react';
import { observeReveal, unobserveReveal } from './reveal-observer';

type RevealAnimation = 'fade-up' | 'fade-down' | 'fade-left' | 'fade-right' | 'scale' | 'clip-up';

interface RevealProps {
  children: ReactNode;
  className?: string;
  animation?: RevealAnimation;
  delay?: number;
  as?: 'div' | 'section' | 'span';
}

export function Reveal({
  children,
  className = '',
  animation = 'fade-up',
  delay = 0,
  as: Tag = 'div',
}: RevealProps) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    observeReveal(el);
    return () => unobserveReveal(el);
  }, []);

  const style: CSSProperties | undefined = delay
    ? { '--reveal-delay': `${delay}ms` } as CSSProperties
    : undefined;

  return (
    <Tag
      ref={ref as React.RefObject<HTMLDivElement>}
      className={`reveal reveal-${animation} ${className}`}
      style={style}
    >
      {children}
    </Tag>
  );
}
