'use client';

import { useState, cloneElement, isValidElement } from 'react';
import type { ReactNode, ReactElement } from 'react';
import {
  useFloating,
  useHover,
  useFocus,
  useDismiss,
  useRole,
  useInteractions,
  offset,
  flip,
  shift,
  arrow,
  FloatingPortal,
  FloatingArrow,
} from '@floating-ui/react';
import type { Placement } from '@floating-ui/react';

interface TooltipProps {
  /** Tooltip content — string or JSX */
  content: ReactNode;
  /** Trigger element (must accept ref) */
  children: ReactElement;
  /** Preferred placement */
  side?: Placement;
  /** Delay before showing (ms) */
  delay?: number;
  /** Max width of the tooltip */
  maxWidth?: number;
}

export function Tooltip({
  content,
  children,
  side = 'top',
  delay = 300,
  maxWidth = 240,
}: TooltipProps) {
  const [isOpen, setIsOpen] = useState(false);
  // Callback-ref-as-state pattern: passing the element itself (not a ref)
  // to floating-ui middleware keeps the access out of the render body.
  const [arrowEl, setArrowEl] = useState<SVGSVGElement | null>(null);

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: side,
    middleware: [
      offset(8),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      arrow({ element: arrowEl }),
    ],
  });

  // Destructure callback refs at the top of the component so JSX doesn't
  // do property access on `refs` during render (React Compiler flags that).
  const { setReference, setFloating } = refs;

  const hover = useHover(context, { delay: { open: delay, close: 0 } });
  const focus = useFocus(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'tooltip' });

  const { getReferenceProps, getFloatingProps } = useInteractions([
    hover,
    focus,
    dismiss,
    role,
  ]);

  if (!content) return children;

  return (
    <>
      {isValidElement(children) &&
        cloneElement(children, {
          ref: setReference,
          ...getReferenceProps(),
        } as Record<string, unknown>)}
      {isOpen && (
        <FloatingPortal>
          <div
            ref={setFloating}
            style={{ ...floatingStyles, maxWidth, zIndex: 9999 }}
            className="rounded-md bg-sf-tooltip-bg text-sf-tooltip-text px-2.5 py-1.5 text-xs leading-relaxed shadow-lg transition-opacity duration-150"
            {...getFloatingProps()}
          >
            {content}
            <FloatingArrow
              ref={setArrowEl}
              context={context}
              className="fill-sf-tooltip-bg"
              width={10}
              height={5}
            />
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
