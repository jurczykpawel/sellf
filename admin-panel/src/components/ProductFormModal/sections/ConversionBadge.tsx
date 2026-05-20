'use client';

import React from 'react';

interface ConversionBadgeProps {
  label: string;
}

export function ConversionBadge({ label }: ConversionBadgeProps) {
  return (
    <span
      data-testid="conversion-badge"
      className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium bg-sf-success-soft text-sf-success rounded-full whitespace-nowrap"
    >
      🎯 {label}
    </span>
  );
}
