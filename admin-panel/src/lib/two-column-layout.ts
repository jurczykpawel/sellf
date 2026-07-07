/**
 * Shared Tailwind classes for the "product info | action panel" two-column
 * layout used across product/checkout pages (waitlist form, free/paid
 * checkout forms). Centralized so the mobile breakpoint can't drift out of
 * sync between the pages that copy this pattern.
 */

export const TWO_COLUMN_ROW_CLASSNAME = 'flex flex-col lg:flex-row';

/** Left/info column: full width on mobile, half width with a divider on desktop. */
export const PANEL_START_CLASSNAME = 'w-full lg:w-1/2 lg:pr-8 lg:border-r border-sf-border mb-8 lg:mb-0';

/** Right/action column: full width on mobile, half width on desktop. */
export const PANEL_END_CLASSNAME = 'w-full lg:w-1/2 lg:pl-8';
