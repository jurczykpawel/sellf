'use client';

import { useState, cloneElement, isValidElement } from 'react';
import type { ReactNode, ReactElement } from 'react';
import {
  useFloating,
  useHover,
  useFocus,
  useClick,
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
  /**
   * Max width of the tooltip. Only applied when `className` is not provided —
   * a custom `className` is expected to own its own sizing (e.g. a fixed `w-*`).
   */
  maxWidth?: number;
  /**
   * Override the floating box's classes entirely (size/colors/padding). Falls
   * back to the shared compact tooltip look used elsewhere in the admin panel.
   * Use this when migrating a bespoke, pre-existing tooltip and the visual
   * appearance must stay pixel-identical.
   */
  className?: string;
  /** Override the arrow's fill class (defaults to matching the default box bg). */
  arrowClassName?: string;
  /** Whether to render the floating-ui arrow. Default true. */
  showArrow?: boolean;
}

const DEFAULT_BOX_CLASSNAME =
  'rounded-md bg-sf-tooltip-bg text-sf-tooltip-text px-2.5 py-1.5 text-xs leading-relaxed shadow-lg transition-opacity duration-150';
const DEFAULT_ARROW_CLASSNAME = 'fill-sf-tooltip-bg';

export function Tooltip({
  content,
  children,
  side = 'top',
  delay = 300,
  maxWidth,
  className,
  arrowClassName,
  showArrow = true,
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
  // Touch devices have no hover: a tap on the trigger must toggle the tooltip.
  // `ignoreMouse` keeps real mouse clicks from fighting with `hover` above —
  // only non-mouse pointers (touch/pen) go through this handler.
  const click = useClick(context, { ignoreMouse: true });
  // Escape key and tapping/clicking outside both close the tooltip (defaults).
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'tooltip' });

  const { getReferenceProps, getFloatingProps } = useInteractions([
    hover,
    focus,
    click,
    dismiss,
    role,
  ]);

  if (!content) return children;

  const effectiveMaxWidth = maxWidth !== undefined ? maxWidth : (className ? undefined : 240);

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
            style={{
              ...floatingStyles,
              zIndex: 9999,
              ...(effectiveMaxWidth !== undefined ? { maxWidth: effectiveMaxWidth } : {}),
            }}
            className={className ?? DEFAULT_BOX_CLASSNAME}
            {...getFloatingProps()}
          >
            {content}
            {showArrow && (
              <FloatingArrow
                ref={setArrowEl}
                context={context}
                className={arrowClassName ?? DEFAULT_ARROW_CLASSNAME}
                width={10}
                height={5}
              />
            )}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
