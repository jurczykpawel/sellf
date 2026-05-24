'use client';

import { useCallback, useState, type ReactNode, type KeyboardEvent } from 'react';
import styles from './SnippetFlipCard.module.css';

interface SnippetFlipCardProps {
  front: ReactNode;
  snippet: string;
  snippetLabel: string;
  className?: string;
}

export function SnippetFlipCard({
  front,
  snippet,
  snippetLabel,
  className = '',
}: SnippetFlipCardProps) {
  const [flipped, setFlipped] = useState(false);

  const toggle = useCallback(() => setFlipped((value) => !value), []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'Escape' && flipped) {
        event.preventDefault();
        setFlipped(false);
      }
    },
    [flipped],
  );

  return (
    <button
      type="button"
      onClick={toggle}
      onKeyDown={onKeyDown}
      aria-expanded={flipped}
      data-flipped={flipped}
      className={`${styles.card} ${className}`}
    >
      <span className={styles.inner} data-flipped={flipped}>
        <span className={styles.face} aria-hidden={flipped}>
          {front}
        </span>
        <span className={styles.faceBack} aria-hidden={!flipped}>
          <span className={styles.snippetLabel}>{snippetLabel}</span>
          <code className={styles.snippet}>{snippet}</code>
        </span>
      </span>
    </button>
  );
}
